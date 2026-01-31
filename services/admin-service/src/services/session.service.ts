import { AppError } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';
import type { CourseProgressUpdatedEvent } from '@kodingcaravan/shared/events/types';
import { getPool } from '../config/database';
import {
	SessionRepository,
	type SessionRecord,
	type CreateSessionInput,
	type StartSessionInput,
	type EndSessionInput,
	type ConfirmSessionInput,
} from '../models/session.model';
import { verifyGPSLocation, type GPSVerificationResult } from '../utils/gpsVerification';
import { verifyFace, validateImage, type FaceVerificationResult } from '../utils/faceVerification';
// PHASE 3 FIX: Replaced HTTP notification calls with event emissions
import {
	emitSessionOtpNotification,
	emitSessionConfirmationRequest,
	emitCourseCompletionNotification,
} from '@kodingcaravan/shared/utils/notificationEventEmitter';
import { validateSessionCreation, checkSessionConflict } from '../utils/sessionValidator';

export class SessionService {
	private sessionRepo: SessionRepository;
	private pool = getPool();

	constructor() {
		this.sessionRepo = new SessionRepository(this.pool);
	}

	/**
	 * Create a new tutoring session
	 */
	async createSession(input: CreateSessionInput): Promise<SessionRecord> {
		// Generate OTP for session if not provided
		const otp = input.otp || this.generateOTP();

		// Validate session creation input (production-level validation)
		try {
			validateSessionCreation({
				trainerId: input.trainerId,
				studentId: input.studentId,
				scheduledDate: input.scheduledDate,
				scheduledTime: input.scheduledTime,
				studentHomeLocation: input.studentHomeLocation,
				courseId: input.courseId,
			});
		} catch (error: any) {
			if (error instanceof AppError) {
				throw error;
			}
			throw new AppError(error.message || 'Session validation failed', 400);
		}

		// Check for session conflicts (same trainer, student, same date/time)
		// This prevents duplicate session creation
		const hasConflict = await checkSessionConflict(
			this.pool,
			input.trainerId,
			input.scheduledDate,
			input.scheduledTime
		);

		// Check if exact duplicate session already exists (same allocation, student, trainer, date, time)
		if (hasConflict && input.allocationId) {
			try {
				const dateStr = input.scheduledDate instanceof Date 
					? input.scheduledDate.toISOString().split('T')[0]
					: new Date(input.scheduledDate).toISOString().split('T')[0];
				
				const duplicateCheck = await this.pool.query(
					`
						SELECT id, allocation_id, status
						FROM tutoring_sessions
						WHERE allocation_id = $1
							AND student_id = $2
							AND trainer_id = $3
							AND scheduled_date = $4::DATE
							AND scheduled_time = $5
						LIMIT 1
					`,
					[input.allocationId, input.studentId, input.trainerId, dateStr, input.scheduledTime]
				);

				if (duplicateCheck.rows.length > 0) {
					const existingSession = duplicateCheck.rows[0];
				logger.warn('Duplicate session already exists', { 
					service: 'admin-service',
					allocationId: input.allocationId,
					existingSessionId: existingSession.id,
					studentId: input.studentId,
					trainerId: input.trainerId,
					scheduledDate: dateStr,
					scheduledTime: input.scheduledTime,
					status: existingSession.status,
				});
					// Return existing session instead of creating duplicate
					const existing = await this.sessionRepo.findById(existingSession.id);
					if (existing) {
						return existing;
					}
					// If for some reason we can't fetch it, throw error to prevent duplicate creation
					throw new AppError(`Session already exists for this allocation, date, and time but could not be retrieved. Session ID: ${existingSession.id}`, 409);
				}
			} catch (error: any) {
				console.error(`[SessionService] ❌ Error checking for duplicate session:`, error?.message || error);
				// Continue with creation if check fails
			}
		}

		if (hasConflict) {
			logger.warn('Session conflict detected', { 
				service: 'admin-service',
				trainerId: input.trainerId,
				scheduledDate: input.scheduledDate,
				scheduledTime: input.scheduledTime,
				allocationId: input.allocationId,
				studentId: input.studentId,
			});
			// Log warning but allow creation - trainer may have multiple sessions at same time for different reasons
		}

		// Ensure duration is set (default to 40 minutes)
		const duration = input.duration || 40;

		const session = await this.sessionRepo.create({
			...input,
			duration,
			otp,
		});


		return session;
	}

	/**
	 * Start session with GPS + Face verification
	 * Both must pass for session to start
	 */
	async startSession(
		sessionId: string,
		trainerId: string,
		input: StartSessionInput
	): Promise<{
		session: SessionRecord;
		gpsVerification: GPSVerificationResult;
		faceVerification: FaceVerificationResult;
		verificationPassed: boolean;
	}> {
		// 1. Get session
		const session = await this.sessionRepo.findById(sessionId);
		if (!session) {
			throw new AppError('Session not found', 404);
		}

		// 2. Verify trainer owns this session
		if (session.trainerId !== trainerId) {
			throw new AppError('Unauthorized: You do not own this session', 403);
		}

		// 3. Check session status
		if (session.status !== 'scheduled' && session.status !== 'pending_verification') {
			throw new AppError(`Cannot start session with status: ${session.status}`, 400);
		}

		// 4. Validate image format
		const imageValidation = validateImage(input.faceVerificationImage);
		if (!imageValidation.valid) {
			throw new AppError(imageValidation.reason || 'Invalid image format', 400);
		}

		// 5. Get trainer's reference image (from trainer profile)
		const referenceImage = await this.getTrainerReferenceImage(trainerId);
		if (!referenceImage) {
			throw new AppError('Trainer reference image not found. Please complete profile setup.', 400);
		}

		// 6. Perform GPS verification
		if (!session.studentHomeLocation) {
			throw new AppError('Student home location not set', 400);
		}

		const gpsVerification = verifyGPSLocation(
			session.studentHomeLocation,
			input.trainerLocation,
			100 // Default 100m radius
		);

		// 7. Perform Face verification
		const faceVerification = await verifyFace(
			trainerId,
			input.faceVerificationImage,
			referenceImage,
			{ minConfidence: 80 }
		);

		// 8. Both verifications must pass
		const verificationPassed = gpsVerification.passed && faceVerification.passed;

		// 9. Update session with verification results
		const updatedSession = await this.sessionRepo.updateVerification(sessionId, {
			trainerStartLocation: {
				...input.trainerLocation,
				timestamp: new Date(),
			},
			gpsVerificationPassed: gpsVerification.passed,
			gpsVerificationDistance: gpsVerification.distance,
			trainerFaceVerificationImage: input.faceVerificationImage,
			faceVerificationPassed: faceVerification.passed,
			faceVerificationConfidence: faceVerification.confidence,
			faceVerificationMethod: input.faceVerificationMethod || 'selfie',
			verificationPassed,
			verificationFailedReason: verificationPassed
				? null
				: this.getVerificationFailedReason(gpsVerification, faceVerification),
			startedAt: undefined, // Don't start yet - wait for student OTP
		});

		if (!updatedSession) {
			throw new AppError('Failed to update session', 500);
		}

		// 10. If verification passed, generate student OTP and send notification
		if (verificationPassed) {
			const studentOtp = this.generateOTP();
			const now = new Date();

			// Update session with student OTP
			await this.sessionRepo.updateStudentOtp(sessionId, {
				studentOtp,
				studentOtpGeneratedAt: now,
				studentOtpVerified: false,
				studentOtpVerifiedAt: null,
			});

			// Get trainer name for notification
			const trainerName = await this.getTrainerName(trainerId);

			// PHASE 3 FIX: Emit notification event (replaces HTTP call)
			await emitSessionOtpNotification(
				session.studentId,
				studentOtp,
				trainerName || 'Your trainer',
				sessionId // correlationId
			);

			// Update status to pending_otp (waiting for student OTP)
			await this.sessionRepo.updateStatus(sessionId, 'pending_verification');
			updatedSession.status = 'pending_verification';
			updatedSession.studentOtp = studentOtp;
			updatedSession.studentOtpGeneratedAt = now;
		} else {
			await this.sessionRepo.updateStatus(sessionId, 'pending_verification');
			updatedSession.status = 'pending_verification';
		}

		return {
			session: updatedSession,
			gpsVerification,
			faceVerification,
			verificationPassed,
		};
	}

	/**
	 * End session
	 * Trainer marks session as completed
	 */
	async endSession(
		sessionId: string,
		trainerId: string,
		input: EndSessionInput
	): Promise<SessionRecord> {
		// 1. Get session
		const session = await this.sessionRepo.findById(sessionId);
		if (!session) {
			throw new AppError('Session not found', 404);
		}

		// 2. Verify trainer owns this session
		if (session.trainerId !== trainerId) {
			throw new AppError('Unauthorized: You do not own this session', 403);
		}

		// 3. Check session status
		if (session.status !== 'in_progress') {
			throw new AppError(`Cannot end session with status: ${session.status}`, 400);
		}

		// 4. Verify session was started
		if (!session.startedAt) {
			throw new AppError('Session was not started. Please start session first.', 400);
		}

		// 5. Calculate actual duration
		const startTime = session.startedAt.getTime();
		const endTime = new Date().getTime();
		const actualDuration = Math.round((endTime - startTime) / (1000 * 60)); // minutes

		// 6. Update session
		const updatedSession = await this.sessionRepo.updateEndSession(sessionId, {
			trainerEndLocation: {
				...input.trainerLocation,
				timestamp: new Date(),
			},
			endedAt: new Date(),
			actualDuration,
			notes: input.notes,
		});

		if (!updatedSession) {
			throw new AppError('Failed to update session', 500);
		}

		// 7. Auto-stop location tracking for both trainer and student
		try {
			const { getActiveTrackingSessionForUser, stopLocationTrackingSession } = await import('./locationTracking.service');
			
			// Stop trainer tracking
			const trainerTrackingSession = await getActiveTrackingSessionForUser(session.trainerId);
			if (trainerTrackingSession && 
				trainerTrackingSession.metadata && 
				typeof trainerTrackingSession.metadata === 'object' &&
				(trainerTrackingSession.metadata as Record<string, unknown>).tutoringSessionId === session.id) {
				await stopLocationTrackingSession(trainerTrackingSession.id).catch((err) => {
					console.error('[Session Service] Failed to stop location tracking for trainer:', err);
				});
			}
			
			// Stop student tracking
			const studentTrackingSession = await getActiveTrackingSessionForUser(session.studentId);
			if (studentTrackingSession && 
				studentTrackingSession.metadata && 
				typeof studentTrackingSession.metadata === 'object' &&
				(studentTrackingSession.metadata as Record<string, unknown>).tutoringSessionId === session.id) {
				await stopLocationTrackingSession(studentTrackingSession.id).catch((err) => {
					logger.error('Failed to stop location tracking for student', { 
						service: 'admin-service',
						error: err.message
					});
				});
			}

		} catch (error) {
			logger.error('Error stopping location tracking', { 
				service: 'admin-service',
				error: error instanceof Error ? error.message : String(error)
			});
			// Don't throw - location tracking failure shouldn't break session end
		}

		// 8. PHASE 3 FIX: Emit notification event (replaces HTTP call)
		await emitSessionConfirmationRequest(session.studentId, sessionId, sessionId);

		// Emit SESSION_COMPLETED event
		try {
			const { getEventBus } = await import('@kodingcaravan/shared/events/eventBus');
			const eventBus = getEventBus();
			
			await eventBus.emit({
				type: 'SESSION_COMPLETED',
				timestamp: Date.now(),
				userId: trainerId,
				role: 'trainer',
				sessionId: updatedSession.id,
				trainerId: updatedSession.trainerId || '',
				studentId: updatedSession.studentId,
				courseId: updatedSession.courseId || undefined, // Include courseId for progress-worker
				completedAt: updatedSession.endedAt?.toISOString() || new Date().toISOString(),
				duration: updatedSession.actualDuration || 60,
			});
		} catch (error: any) {
			logger.error('Failed to emit SESSION_COMPLETED event (non-critical)', { 
				service: 'admin-service',
				error: error?.message
			});
		}

		return updatedSession;
	}

	/**
	 * Student/Parent confirms session completion
	 */
	async confirmSession(
		sessionId: string,
		studentId: string,
		input: ConfirmSessionInput
	): Promise<SessionRecord> {
		// 1. Get session
		const session = await this.sessionRepo.findById(sessionId);
		if (!session) {
			throw new AppError('Session not found', 404);
		}

		// 2. Verify student owns this session
		if (session.studentId !== studentId) {
			throw new AppError('Unauthorized: You do not own this session', 403);
		}

		// 3. Check session status
		if (session.status !== 'pending_confirmation') {
			throw new AppError(`Cannot confirm session with status: ${session.status}`, 400);
		}

		// 4. Update confirmation
		const updatedSession = await this.sessionRepo.updateConfirmation(sessionId, {
			studentConfirmed: input.confirmed,
			studentConfirmedAt: new Date(),
			studentConfirmationNotes: input.notes,
		});

		if (!updatedSession) {
			throw new AppError('Failed to update session confirmation', 500);
		}

		// 5. If session is confirmed, emit SESSION_COMPLETED event for progress-worker
		// PHASE 2 FIX: Progress calculation moved to async worker (replaces DB trigger)
		if (input.confirmed && session.courseId) {
			try {
				// PHASE 2 FIX: Emit SESSION_COMPLETED event for progress-worker
				// Progress calculation will be handled asynchronously by progress-worker
				const { getEventBus } = await import('@kodingcaravan/shared/events/eventBus');
				const eventBus = getEventBus();
				
				// Calculate duration in minutes
				const duration = updatedSession.endedAt && updatedSession.startedAt
					? Math.round((updatedSession.endedAt.getTime() - updatedSession.startedAt.getTime()) / 60000)
					: 60; // Default 60 minutes if not available
				
				await eventBus.emit({
					type: 'SESSION_COMPLETED',
					timestamp: Date.now(),
					userId: session.studentId,
					role: 'student',
					sessionId: updatedSession.id,
					trainerId: updatedSession.trainerId || '',
					studentId: updatedSession.studentId,
					courseId: updatedSession.courseId || '',
					completedAt: (updatedSession.endedAt || new Date()).toISOString(),
					duration,
				});
				
				logger.info('SESSION_COMPLETED event emitted (for progress-worker)', {
					service: 'admin-service',
					sessionId: updatedSession.id,
					studentId: session.studentId,
					courseId: session.courseId,
					duration,
				});
				
				// Also check if course is completed and emit progress update event (for WebSocket clients)
				await this.checkAndNotifyCourseCompletion(session.studentId, session.courseId);
				
				// Note: Progress calculation will be handled by progress-worker
				// The progress-worker will emit PROGRESS_UPDATED event after calculation
			} catch (error) {
				logger.error('Failed to emit SESSION_COMPLETED event or check course completion', { 
					service: 'admin-service',
					error: error instanceof Error ? error.message : String(error)
				});
				// Don't throw - event emission failure shouldn't break session confirmation
			}
		}

		return updatedSession;
	}

	/**
	 * Get session by ID
	 */
	async getSession(sessionId: string): Promise<SessionRecord | null> {
		return this.sessionRepo.findById(sessionId);
	}

	/**
	 * Get session with trainer and course details enriched
	 */
	async getSessionWithDetails(sessionId: string): Promise<any | null> {
		try {
			const session = await this.getSession(sessionId);
			if (!session) {
				console.log('[SessionService] Session not found:', sessionId);
				return null;
			}

			console.log('[SessionService] Fetching session details:', {
				sessionId,
				allocationId: session.allocationId,
				trainerId: session.trainerId,
			});

			// Fetch trainer details - query trainer_profiles directly first (most reliable)
			let trainerName: string | null = null;
			let trainerPhoto: string | null = null;
			
			// PRIMARY: Query trainer_profiles directly using trainerId (using same pattern as getStudentSessionsWithDetails)
			if (session.trainerId) {
				try {
					console.log('[SessionService] PRIMARY: Querying trainer_profiles for trainerId:', session.trainerId);
					const trainerResult = await this.pool.query<{
						trainer_id: string;
						full_name: string | null;
						username: string | null;
						avatar_url: string | null;
						extra: any;
					}>(
						`
							SELECT 
								COALESCE(tp.trainer_id, t.id) as trainer_id,
								tp.full_name,
								t.username,
								COALESCE(
									tp.extra->>'avatarUrl', 
									tp.extra->>'avatar_url', 
									t.extra->>'avatarUrl', 
									t.extra->>'avatar_url'
								) as avatar_url,
								tp.extra
							FROM trainers t
							LEFT JOIN trainer_profiles tp ON tp.trainer_id = t.id
							WHERE t.id = $1
						`,
						[session.trainerId]
					);
					
					console.log('[SessionService] PRIMARY trainer query result:', {
						rowCount: trainerResult.rows.length,
						trainerId: session.trainerId,
						rows: trainerResult.rows,
					});

					if (trainerResult.rows.length > 0) {
						const row = trainerResult.rows[0];
						console.log('[SessionService] PRIMARY row data:', {
							trainer_id: row.trainer_id,
							full_name: row.full_name,
							username: row.username,
							avatar_url: row.avatar_url,
							has_extra: !!row.extra,
							extra_keys: row.extra ? Object.keys(row.extra) : [],
							allRowKeys: Object.keys(row),
							rowData: JSON.stringify(row),
						});
						
						// Use same logic as getStudentSessionsWithDetails (line 1025)
						trainerName = row.full_name || row.username || null;
						
						if (row.avatar_url) {
							trainerPhoto = row.avatar_url;
						} else if (row.extra && typeof row.extra === 'object') {
							const trainerExtra = row.extra as Record<string, unknown>;
							trainerPhoto = (trainerExtra.avatarUrl || trainerExtra.avatar_url) as string | null;
						}
						
						console.log('[SessionService] ✅ PRIMARY: Trainer found:', {
							trainerId: session.trainerId,
							full_name: row.full_name,
							username: row.username,
							trainerName,
							trainerPhoto: trainerPhoto ? 'has photo' : 'no photo',
						});
					} else {
						console.warn('[SessionService] ⚠️ PRIMARY: No trainer found for trainerId:', session.trainerId);
					}
				} catch (error: any) {
					console.error('[SessionService] ❌ PRIMARY: Error fetching trainer:', {
						trainerId: session.trainerId,
						error: error.message,
						stack: error.stack,
					});
				}
			}
			
			// FALLBACK: Try allocation query if trainerName still not found
			if (!trainerName && session.allocationId) {
				try {
					console.log('[SessionService] Querying allocation for trainer:', session.allocationId);
					
					// Try a more robust query that handles different column name variations
					const allocationResult = await this.pool.query<{
						trainer_id: string | null;
						trainer_full_name: string | null;
						full_name: string | null;
						trainer_username: string | null;
						username: string | null;
						trainer_avatar_url: string | null;
						avatar_url: string | null;
						trainer_extra: any;
						extra: any;
					}>(
						`
							SELECT 
								ta.trainer_id,
								COALESCE(tp.full_name, t.username) as trainer_full_name,
								tp.full_name,
								t.username as trainer_username,
								t.username,
								COALESCE(
									tp.extra->>'avatarUrl', 
									tp.extra->>'avatar_url', 
									t.extra->>'avatarUrl', 
									t.extra->>'avatar_url'
								) as trainer_avatar_url,
								COALESCE(
									tp.extra->>'avatarUrl', 
									tp.extra->>'avatar_url', 
									t.extra->>'avatarUrl', 
									t.extra->>'avatar_url'
								) as avatar_url,
								tp.extra as trainer_extra,
								tp.extra as extra
							FROM trainer_allocations ta
							LEFT JOIN trainers t ON t.id = ta.trainer_id
							LEFT JOIN trainer_profiles tp ON tp.trainer_id = t.id
							WHERE ta.id = $1
						`,
						[session.allocationId]
					);
					
					console.log('[SessionService] Allocation query result:', {
						rowCount: allocationResult.rows.length,
						allocationId: session.allocationId,
						rows: allocationResult.rows,
					});

					if (allocationResult.rows.length > 0) {
						const row = allocationResult.rows[0];
						console.log('[SessionService] Raw row data from allocation query:', {
							trainer_id: row.trainer_id,
							trainer_full_name: row.trainer_full_name,
							full_name: row.full_name,
							trainer_username: row.trainer_username,
							username: row.username,
							trainer_avatar_url: row.trainer_avatar_url,
							avatar_url: row.avatar_url,
							has_trainer_extra: !!row.trainer_extra,
							has_extra: !!row.extra,
							allKeys: Object.keys(row),
							allRowData: row,
						});
						
						// Try multiple possible column names
						trainerName = row.trainer_full_name 
							|| row.full_name 
							|| row.trainer_username 
							|| row.username 
							|| null;
						
						// Extract avatar from multiple sources
						trainerPhoto = row.trainer_avatar_url 
							|| row.avatar_url 
							|| (row.trainer_extra && typeof row.trainer_extra === 'object' 
								? ((row.trainer_extra as Record<string, unknown>).avatarUrl || (row.trainer_extra as Record<string, unknown>).avatar_url) as string | null
								: null)
							|| (row.extra && typeof row.extra === 'object' 
								? ((row.extra as Record<string, unknown>).avatarUrl || (row.extra as Record<string, unknown>).avatar_url) as string | null
								: null)
							|| null;
						
						console.log('[SessionService] ✅ Trainer extracted from allocation:', {
							allocationId: session.allocationId,
							trainerId: row.trainer_id,
							trainerName,
							trainerPhoto: trainerPhoto ? 'has photo' : 'no photo',
						});
					} else {
						console.warn('[SessionService] ⚠️ No allocation found for allocationId:', session.allocationId);
					}
				} catch (error: any) {
					console.error('[SessionService] ❌ Error fetching trainer details from allocation:', {
						allocationId: session.allocationId,
						error: error.message,
						stack: error.stack,
					});
				}
			}

			// FINAL CHECK: Log if trainer name is still missing
			if (!trainerName) {
				console.error('[SessionService] ⚠️⚠️⚠️ CRITICAL: No trainer name found after all queries!', {
					sessionId,
					trainerId: session.trainerId,
					allocationId: session.allocationId,
				});
				
				// LAST RESORT: Try a simple direct query without JOIN
				if (session.trainerId) {
					try {
						console.log('[SessionService] LAST RESORT: Direct query to trainer_profiles:', session.trainerId);
						
						// Try multiple query variations
						const queries = [
							{ name: 'Simple SELECT', sql: `SELECT full_name FROM trainer_profiles WHERE trainer_id = $1` },
							{ name: 'With COALESCE', sql: `SELECT COALESCE(full_name, '') as full_name FROM trainer_profiles WHERE trainer_id = $1` },
							{ name: 'Check if exists', sql: `SELECT EXISTS(SELECT 1 FROM trainer_profiles WHERE trainer_id = $1) as exists, (SELECT full_name FROM trainer_profiles WHERE trainer_id = $1) as full_name` },
						];
						
						for (const query of queries) {
							try {
								console.log(`[SessionService] LAST RESORT: Trying ${query.name}`);
								const result = await this.pool.query<{ full_name: string | null; exists?: boolean }>(query.sql, [session.trainerId]);
								
								console.log(`[SessionService] LAST RESORT ${query.name} result:`, {
									rowCount: result.rows.length,
									rows: result.rows,
									firstRow: result.rows[0],
								});
								
								if (result.rows.length > 0) {
									const row = result.rows[0];
									const name = row.full_name || (row as any).full_name;
									if (name && name.trim() !== '') {
										trainerName = name;
										console.log(`[SessionService] ✅ LAST RESORT ${query.name} SUCCESS: Found trainer name:`, trainerName);
										break;
									}
								}
							} catch (err: any) {
								console.error(`[SessionService] ❌ LAST RESORT ${query.name} ERROR:`, err.message);
							}
						}
						
						if (!trainerName) {
							console.error('[SessionService] ❌ ALL LAST RESORT QUERIES FAILED for trainer_id:', session.trainerId);
						}
					} catch (error: any) {
						console.error('[SessionService] ❌ LAST RESORT ERROR:', error.message, error.stack);
					}
				}
			} else {
				console.log('[SessionService] ✅✅✅ SUCCESS: Trainer name found:', trainerName);
			}

			// Fetch course details
			let courseName: string | null = null;
			if (session.courseId) {
				try {
					const courseResult = await this.pool.query<{
						title: string | null;
					}>(
						`SELECT title FROM courses WHERE id = $1`,
						[session.courseId]
					);

					if (courseResult.rows.length > 0) {
						courseName = courseResult.rows[0].title;
					}
				} catch (error: any) {
					console.warn('[SessionService] Error fetching course details:', error.message);
				}
			}

			// Format scheduledDate as string to avoid timezone issues
			const formattedScheduledDate = session.scheduledDate instanceof Date
				? `${session.scheduledDate.getFullYear()}-${String(session.scheduledDate.getMonth() + 1).padStart(2, '0')}-${String(session.scheduledDate.getDate()).padStart(2, '0')}`
				: session.scheduledDate;

			// Create enriched session - use explicit assignment to ensure fields are set
			const enrichedSession: any = Object.assign({}, session, {
				scheduledDate: formattedScheduledDate,
			});
			
			// Explicitly set these fields using direct assignment
			enrichedSession.trainerName = trainerName;
			enrichedSession.trainerPhoto = trainerPhoto;
			enrichedSession.courseName = courseName;
			
			console.log('[SessionService] Returning enriched session:', {
				sessionId,
				allocationId: session.allocationId,
				trainerId: session.trainerId,
				trainerName: enrichedSession.trainerName,
				trainerPhoto: enrichedSession.trainerPhoto ? 'has photo' : 'no photo',
				courseName: enrichedSession.courseName,
				rawTrainerName: trainerName,
				rawTrainerPhoto: trainerPhoto,
				rawCourseName: courseName,
				enrichedSessionKeys: Object.keys(enrichedSession),
				hasTrainerName: 'trainerName' in enrichedSession,
				hasTrainerPhoto: 'trainerPhoto' in enrichedSession,
				hasCourseName: 'courseName' in enrichedSession,
				trainerNameValue: enrichedSession.trainerName,
				trainerPhotoValue: enrichedSession.trainerPhoto,
				courseNameValue: enrichedSession.courseName,
			});
			
			// Final verification - ensure fields exist
			if (!enrichedSession.hasOwnProperty('trainerName')) {
				enrichedSession.trainerName = trainerName;
				console.log('[SessionService] ⚠️ trainerName was missing, forced set');
			}
			if (!enrichedSession.hasOwnProperty('trainerPhoto')) {
				enrichedSession.trainerPhoto = trainerPhoto;
				console.log('[SessionService] ⚠️ trainerPhoto was missing, forced set');
			}
			if (!enrichedSession.hasOwnProperty('courseName')) {
				enrichedSession.courseName = courseName;
				console.log('[SessionService] ⚠️ courseName was missing, forced set');
			}
			
			// CRITICAL: Create a new plain object with explicit fields to ensure they're not lost
			// Convert to JSON and back to ensure it's a plain object (removes any class instances)
			const sessionJson = JSON.parse(JSON.stringify(enrichedSession));
			const finalSession = {
				...sessionJson,
				trainerName: trainerName || null,
				trainerPhoto: trainerPhoto || null,
				courseName: courseName || null,
			};
			
			// Force set again as final safeguard
			finalSession.trainerName = trainerName || null;
			finalSession.trainerPhoto = trainerPhoto || null;
			finalSession.courseName = courseName || null;
			
			console.log('[SessionService] ✅ FINAL session being returned:', {
				keys: Object.keys(finalSession),
				trainerName: finalSession.trainerName,
				trainerPhoto: finalSession.trainerPhoto,
				courseName: finalSession.courseName,
				trainerNameType: typeof finalSession.trainerName,
				trainerNameIsNull: finalSession.trainerName === null,
				trainerNameIsUndefined: finalSession.trainerName === undefined,
				rawTrainerName: trainerName,
				rawTrainerNameType: typeof trainerName,
			});
			
			// Double-check: ensure trainerName is actually set
			if (finalSession.trainerName === null || finalSession.trainerName === undefined) {
				console.error('[SessionService] ❌❌❌ CRITICAL ERROR: trainerName is null/undefined in final session!', {
					trainerNameValue: trainerName,
					trainerNameType: typeof trainerName,
					finalSessionTrainerName: finalSession.trainerName,
					sessionId,
					trainerId: session.trainerId,
				});
			}
			
			return finalSession;
		} catch (error: any) {
			console.error('[SessionService] Error fetching session with details:', error.message);
			throw error;
		}
	}

	/**
	 * Get sessions for student
	 */
	async getStudentSessions(
		studentId: string,
		filters?: {
			status?: string;
			limit?: number;
			offset?: number;
		}
	): Promise<SessionRecord[]> {
		return this.sessionRepo.findByStudentId(studentId, {
			status: filters?.status as any,
			limit: filters?.limit,
			offset: filters?.offset,
		});
	}

	/**
	 * Get student sessions with trainer and course details enriched
	 */
	async getStudentSessionsWithDetails(
		studentId: string,
		filters?: {
			status?: string;
			limit?: number;
			offset?: number;
		}
	): Promise<any[]> {
		try {
			const sessions = await this.getStudentSessions(studentId, filters);
			
			// Log initial query results for debugging
			console.log('[SessionService] Initial query results:', {
				studentId,
				sessionCount: sessions.length,
				filters,
			});
			
			if (sessions.length === 0) {
				logger.info('No sessions found for student', { 
					service: 'admin-service',
					studentId
				});
				return [];
			}

			// Validate that all sessions actually exist in the database
			// This prevents data consistency issues where sessions appear in lists but don't exist when queried individually
			// Use batch query for efficiency
			const sessionIds = sessions.map(s => s.id);
			let validSessions: SessionRecord[] = [];
			const invalidSessionIds: string[] = [];

			if (sessionIds.length > 0) {
				try {
					// Batch verify all sessions exist in a single query
					// Try without explicit casting first, as the IDs should already be UUIDs
					let verificationResult;
					try {
						verificationResult = await this.pool.query<{ id: string }>(
							`SELECT id::text FROM tutoring_sessions WHERE id = ANY($1::uuid[])`,
							[sessionIds]
						);
					} catch (castError: any) {
						// If UUID casting fails, try without explicit casting
						logger.warn('UUID casting failed, trying without cast', { 
							service: 'admin-service',
							error: castError.message
						});
						verificationResult = await this.pool.query<{ id: string }>(
							`SELECT id::text FROM tutoring_sessions WHERE id = ANY($1)`,
							[sessionIds]
						);
					}

					const validSessionIds = new Set(verificationResult.rows.map(row => row.id));
					
					// Filter sessions to only include those that exist
					validSessions = sessions.filter(session => {
						if (validSessionIds.has(session.id)) {
							return true;
						} else {
							invalidSessionIds.push(session.id);
							logger.warn('Session found in list but not in database', { 
								service: 'admin-service',
								sessionId: session.id,
								studentId,
								status: session.status,
							});
							return false;
						}
					});

					// Log validation results for debugging
					if (invalidSessionIds.length > 0) {
						logger.debug('Session validation results', { 
							service: 'admin-service',
							total: sessions.length,
							valid: validSessions.length,
							invalid: invalidSessionIds.length,
							invalidIds: invalidSessionIds.slice(0, 5), // Only log first 5 to avoid spam
						});
					}
				} catch (error: any) {
					// Log the error but don't fail completely - validation is a safety check
					// If validation fails, return all sessions with a warning rather than blocking everything
					logger.error('Error verifying sessions (returning all sessions with warning)', { 
						service: 'admin-service',
						error: error.message,
						sessionCount: sessions.length,
						studentId,
					});
					
					// Return all sessions if validation fails - better to show sessions than show nothing
					// The frontend will handle invalid sessions gracefully
					validSessions = sessions;
				}
			} else {
				// No sessions to validate
				validSessions = [];
			}

			// Log data consistency issues
			if (invalidSessionIds.length > 0) {
				logger.error('Data consistency issue detected', { 
					service: 'admin-service',
					studentId,
					totalSessions: sessions.length,
					invalidSessions: invalidSessionIds.length,
					invalidSessionIds,
				});
			}

			// If all sessions are invalid, check if validation actually ran
			// If validation failed and returned all sessions, but we still have 0, 
			// it means there really are no sessions (initial query returned 0)
			if (validSessions.length === 0 && sessions.length > 0) {
				// This means validation filtered out all sessions
				// Log warning but still return empty (they were all invalid)
				logger.warn('All sessions were filtered out as invalid', { 
					service: 'admin-service',
					studentId,
					totalSessions: sessions.length,
					invalidSessionIds,
				});
			}
			
			// If no valid sessions, return empty array
			if (validSessions.length === 0) {
				return [];
			}

			// Get unique trainer IDs and course IDs from valid sessions only
			const trainerIds = [...new Set(validSessions.map(s => s.trainerId).filter(Boolean))];
			const courseIds = [...new Set(validSessions.map(s => s.courseId).filter(Boolean))];

			// Batch fetch trainer profiles with fallback to trainers table
			const trainerProfilesMap = new Map();
			if (trainerIds.length > 0) {
				try {
					const trainerProfilesResult = await this.pool.query<{
						trainer_id: string;
						full_name: string | null;
						username: string | null;
					}>(
						`
							SELECT 
								COALESCE(tp.trainer_id, t.id) as trainer_id,
								tp.full_name,
								t.username
							FROM trainers t
							LEFT JOIN trainer_profiles tp ON tp.trainer_id = t.id
							WHERE t.id = ANY($1::uuid[])
						`,
						[trainerIds]
					);

					trainerProfilesResult.rows.forEach(profile => {
						// Use full_name from trainer_profiles, fallback to username from trainers table
						const trainerName = profile.full_name || profile.username || null;
						trainerProfilesMap.set(profile.trainer_id, {
							fullName: trainerName,
						});
					});
				} catch (error: any) {
					logger.warn('Error fetching trainer profiles', { 
						service: 'admin-service',
						error: error.message
					});
				}
			}

			// Batch fetch course details
			const coursesMap = new Map();
			if (courseIds.length > 0) {
				try {
					const coursesResult = await this.pool.query<{
						id: string;
						title: string;
					}>(
						`
							SELECT 
								id,
								title
							FROM courses
							WHERE id = ANY($1::uuid[])
						`,
						[courseIds]
					);

					coursesResult.rows.forEach(course => {
						coursesMap.set(course.id, {
							title: course.title,
						});
					});
				} catch (error: any) {
					console.warn('[SessionService] Error fetching courses:', error.message);
				}
			}

			// Log final results before returning
			logger.debug('Returning enriched sessions', { 
				service: 'admin-service',
				studentId,
				totalSessions: sessions.length,
				validSessions: validSessions.length,
				invalidSessions: invalidSessionIds.length,
			});

			// Enrich valid sessions with trainer and course details
			return validSessions.map(session => {
				const trainer = trainerProfilesMap.get(session.trainerId);
				const course = session.courseId ? coursesMap.get(session.courseId) : null;

				// CRITICAL: Format scheduledDate as YYYY-MM-DD string to avoid timezone issues in JSON serialization
				// Date objects get serialized to ISO strings in UTC, which can shift dates
				const formattedScheduledDate = session.scheduledDate instanceof Date
					? `${session.scheduledDate.getFullYear()}-${String(session.scheduledDate.getMonth() + 1).padStart(2, '0')}-${String(session.scheduledDate.getDate()).padStart(2, '0')}`
					: session.scheduledDate;

				return {
					...session,
					scheduledDate: formattedScheduledDate, // Send as string to avoid timezone conversion
					trainerName: trainer?.fullName || null,
					trainerPhoto: null, // Trainer profiles don't have avatar_url column
					courseName: course?.title || null,
				};
			});
		} catch (error: any) {
			console.error('[SessionService] Error fetching student sessions with details:', {
				studentId,
				error: error.message,
			});
			throw error;
		}
	}

	/**
	 * Get sessions for trainer
	 */
	async getTrainerSessions(
		trainerId: string,
		filters?: {
			status?: string;
			limit?: number;
			offset?: number;
		}
	): Promise<SessionRecord[]> {
		try {
			console.log('[SessionService] Fetching sessions for trainer:', {
				trainerId,
				filters,
			});
			
			const sessions = await this.sessionRepo.findByTrainerId(trainerId, {
				status: filters?.status as any,
				limit: filters?.limit,
				offset: filters?.offset,
			});
			
			// CONSISTENCY ASSERTION: Verify aggregation completeness
			// For bootstrap queries (no status filter, no offset), verify we got all sessions
			if (!filters?.status && !filters?.offset) {
				try {
					// Count total sessions in DB for this trainer (via allocation - source of truth)
					const dbTotalCountResult = await this.sessionRepo['pool'].query<{ count: string }>(
						`
							SELECT COUNT(*) as count
							FROM tutoring_sessions ts
							INNER JOIN trainer_allocations ta ON ts.allocation_id = ta.id
							WHERE ta.trainer_id = $1
						`,
						[trainerId]
					);
					const dbTotalCount = parseInt(dbTotalCountResult.rows[0]?.count || '0', 10);
					
					// Count total completed sessions in DB for this trainer
					const dbCompletedCountResult = await this.sessionRepo['pool'].query<{ count: string }>(
						`
							SELECT COUNT(*) as count
							FROM tutoring_sessions ts
							INNER JOIN trainer_allocations ta ON ts.allocation_id = ta.id
							WHERE ta.trainer_id = $1 AND ts.status = 'completed'
						`,
						[trainerId]
					);
					const dbCompletedCount = parseInt(dbCompletedCountResult.rows[0]?.count || '0', 10);
					
					// Count sessions in returned results
					const returnedTotalCount = sessions.length;
					const returnedCompletedCount = sessions.filter(s => s.status === 'completed').length;
					const limit = filters?.limit || 200;
					
					// Log consistency check
					console.log('[SessionService] Consistency check (bootstrap query):', {
						trainerId,
						dbTotalCount,
						returnedTotalCount,
						dbCompletedCount,
						returnedCompletedCount,
						limit,
						consistent: returnedTotalCount === Math.min(limit, dbTotalCount) && returnedCompletedCount === Math.min(limit, dbCompletedCount),
					});
					
					// ERROR: Log if mismatch detected (but don't fail - return what we have)
					// Check total count first (most critical)
					if (returnedTotalCount < Math.min(limit, dbTotalCount)) {
						console.error(`[SessionService] ⚠️ CONSISTENCY ERROR (TOTAL): DB has ${dbTotalCount} total sessions, but aggregation returned ${returnedTotalCount}`);
						console.error(`[SessionService] Expected: ${Math.min(limit, dbTotalCount)}, Got: ${returnedTotalCount}, Limit: ${limit}`);
						console.error(`[SessionService] This indicates query bug or data integrity issue. Trainer: ${trainerId}`);
					}
					
					// Check completed count (critical for progress calculations)
					if (returnedCompletedCount < Math.min(limit, dbCompletedCount)) {
						console.error(`[SessionService] ⚠️ CONSISTENCY ERROR (COMPLETED): DB has ${dbCompletedCount} completed sessions, but aggregation returned ${returnedCompletedCount}`);
						console.error(`[SessionService] Expected: ${Math.min(limit, dbCompletedCount)}, Got: ${returnedCompletedCount}, Limit: ${limit}`);
						console.error(`[SessionService] This indicates missing completed sessions. Trainer: ${trainerId}`);
					}
				} catch (consistencyError: any) {
					// Don't fail the request if consistency check fails
					console.warn('[SessionService] Failed to run consistency check:', consistencyError.message);
				}
			}
			
			console.log('[SessionService] Sessions fetched:', {
				trainerId,
				count: sessions.length,
				statusFilter: filters?.status,
			});
			
			return sessions;
		} catch (error: any) {
			// Log the error for debugging
			console.error('[SessionService] Error fetching trainer sessions:', {
				trainerId,
				error: error.message,
				code: error.code,
				stack: error.stack,
			});
			
			// If it's a column doesn't exist error, return empty array
			// The migration should have added it, but handle gracefully
			if (error.code === '42703' || error.message?.includes('does not exist')) {
				console.warn('[SessionService] Column missing, returning empty array. Migration may need to run.');
				return [];
			}
			
			// Re-throw other errors
			throw error;
		}
	}

	/**
	 * Get trainer sessions with student and course details enriched
	 */
	async getTrainerSessionsWithDetails(
		trainerId: string,
		filters?: {
			status?: string;
			limit?: number;
			offset?: number;
		}
	): Promise<any[]> {
		try {
			const sessions = await this.getTrainerSessions(trainerId, filters);
			
			if (sessions.length === 0) {
				return [];
			}

			// Get unique student IDs and course IDs
			const studentIds = [...new Set(sessions.map(s => s.studentId).filter(Boolean))];
			const courseIds = [...new Set(sessions.map(s => s.courseId).filter(Boolean))];

			// Batch fetch student profiles (using student_id, not id)
			const studentProfilesMap = new Map();
			if (studentIds.length > 0) {
				try {
					const studentProfilesResult = await this.pool.query<{
						student_id: string;
						full_name: string | null;
						avatar_url: string | null;
						address: string | null;
					}>(
						`
							SELECT 
								student_id,
								full_name,
								avatar_url,
								address
							FROM student_profiles
							WHERE student_id = ANY($1::uuid[])
						`,
						[studentIds]
					);

					studentProfilesResult.rows.forEach(profile => {
						studentProfilesMap.set(profile.student_id, {
							fullName: profile.full_name, // Use full_name from student_profiles (original name, not username)
							avatarUrl: profile.avatar_url,
							address: profile.address,
						});
					});
				} catch (error: any) {
					console.warn('[SessionService] Error fetching student profiles:', error.message);
				}
			}

			// Batch fetch course details
			const coursesMap = new Map();
			if (courseIds.length > 0) {
				try {
					const coursesResult = await this.pool.query<{
						id: string;
						title: string;
					}>(
						`
							SELECT 
								id,
								title
							FROM courses
							WHERE id = ANY($1::uuid[])
						`,
						[courseIds]
					);

					coursesResult.rows.forEach(course => {
						coursesMap.set(course.id, {
							title: course.title,
						});
					});
				} catch (error: any) {
					console.warn('[SessionService] Error fetching courses:', error.message);
				}
			}

			// Enrich sessions with student and course details
			return sessions.map(session => {
				const student = studentProfilesMap.get(session.studentId);
				const course = session.courseId ? coursesMap.get(session.courseId) : null;

				// CRITICAL: Format scheduledDate as YYYY-MM-DD string to avoid timezone issues in JSON serialization
				// Date objects get serialized to ISO strings in UTC, which can shift dates
				const formattedScheduledDate = session.scheduledDate instanceof Date
					? `${session.scheduledDate.getFullYear()}-${String(session.scheduledDate.getMonth() + 1).padStart(2, '0')}-${String(session.scheduledDate.getDate()).padStart(2, '0')}`
					: session.scheduledDate;

				return {
					...session,
					scheduledDate: formattedScheduledDate, // Send as string to avoid timezone conversion
					studentName: student?.fullName || null,
					studentPhoto: student?.avatarUrl || null,
					studentAddress: student?.address || null,
					courseName: course?.title || null,
				};
			});
		} catch (error: any) {
			console.error('[SessionService] Error fetching trainer sessions with details:', {
				trainerId,
				error: error.message,
			});
			throw error;
		}
	}

	/**
	 * Get trainer's reference image for face verification
	 * TODO: Implement actual retrieval from trainer service or profile
	 */
	private async getTrainerReferenceImage(trainerId: string): Promise<string | null> {
		try {
			// Try to fetch from trainer_profiles table
			// This table is in trainer-auth-service, so we'd need to call that service
			// For now, we'll query directly if using the same database
			const result = await this.pool.query<{ face_verification_image: string | null; avatar_url: string | null }>(
				`
					SELECT 
						face_verification_image,
						avatar_url
					FROM trainer_profiles
					WHERE trainer_id = $1
				`,
				[trainerId]
			);

			if (result.rows.length > 0) {
				const profile = result.rows[0];
				// Prefer face_verification_image, fallback to avatar_url
				return profile.face_verification_image || profile.avatar_url || null;
			}

			// If not found, try querying from trainers table (from trainer-auth-service)
			// This might be in a different database, so you'd need to call the service
			console.warn('[Session Service] Trainer profile not found in trainer_profiles table');
			return null;
		} catch (error: any) {
			console.error('[Session Service] Error fetching trainer reference image:', error);
			return null;
		}
	}

	/**
	 * Verify student OTP and start session
	 */
	async verifyStudentOtp(
		sessionId: string,
		trainerId: string,
		otp: string
	): Promise<SessionRecord> {
		// 1. Get session
		const session = await this.sessionRepo.findById(sessionId);
		if (!session) {
			throw new AppError('Session not found', 404);
		}

		// 2. Verify trainer owns this session
		if (session.trainerId !== trainerId) {
			throw new AppError('Unauthorized: You do not own this session', 403);
		}

		// 3. Check session status
		if (session.status !== 'pending_verification') {
			throw new AppError(`Cannot verify OTP for session with status: ${session.status}`, 400);
		}

		// 4. Check if GPS and Face verification passed
		if (!session.verificationPassed) {
			throw new AppError('GPS and Face verification must pass before OTP verification', 400);
		}

		// 5. Verify OTP matches
		if (!session.studentOtp || session.studentOtp !== otp) {
			throw new AppError('Invalid OTP. Please check the OTP shared by the student.', 400);
		}

		// 6. Check if OTP is already verified
		if (session.studentOtpVerified) {
			throw new AppError('OTP already verified. Session may have already started.', 400);
		}

		// 7. Verify OTP and start session
		const now = new Date();
		const updatedSession = await this.sessionRepo.updateStudentOtp(sessionId, {
			studentOtpVerified: true,
			studentOtpVerifiedAt: now,
		});

		if (!updatedSession) {
			throw new AppError('Failed to verify OTP', 500);
		}

		// 8. Start the session
		await this.sessionRepo.updateVerification(sessionId, {
			startedAt: now,
		});

		await this.sessionRepo.updateStatus(sessionId, 'in_progress');
		updatedSession.status = 'in_progress';
		updatedSession.startedAt = now;

		// 9. Auto-start location tracking for both trainer and student
		try {
			const { startLocationTrackingSession } = await import('./locationTracking.service');
			
			// Start tracking for trainer
			await startLocationTrackingSession({
				userId: session.trainerId,
				userRole: 'trainer',
				metadata: {
					tutoringSessionId: session.id,
					allocationId: session.allocationId,
					courseId: session.courseId || null,
					sessionType: 'tutoring',
					autoStarted: true,
					startedAt: now.toISOString(),
				},
			}).catch((err) => {
				console.error('[Session Service] Failed to start location tracking for trainer:', err);
			});
			
			// Start tracking for student
			await startLocationTrackingSession({
				userId: session.studentId,
				userRole: 'student',
				metadata: {
					tutoringSessionId: session.id,
					allocationId: session.allocationId,
					courseId: session.courseId || null,
					sessionType: 'tutoring',
					autoStarted: true,
					startedAt: now.toISOString(),
				},
			}).catch((err) => {
				console.error('[Session Service] Failed to start location tracking for student:', err);
			});

		} catch (error) {
			console.error('[Session Service] Error starting location tracking:', error);
			// Don't throw - location tracking failure shouldn't break session start
		}

		return updatedSession;
	}

	/**
	 * Generate 6-digit OTP
	 */
	private generateOTP(): string {
		return Math.floor(100000 + Math.random() * 900000).toString();
	}

	/**
	 * Get trainer name for notifications
	 */
	private async getTrainerName(trainerId: string): Promise<string | null> {
		try {
			const result = await this.pool.query<{ full_name: string | null }>(
				`
					SELECT full_name
					FROM trainer_profiles
					WHERE trainer_id = $1
				`,
				[trainerId]
			);

			if (result.rows.length > 0 && result.rows[0].full_name) {
				return result.rows[0].full_name;
			}

			return null;
		} catch (error: any) {
			console.error('[Session Service] Error fetching trainer name:', error);
			return null;
		}
	}

	/**
	 * Get verification failed reason message
	 */
	private getVerificationFailedReason(
		gpsVerification: GPSVerificationResult,
		faceVerification: FaceVerificationResult
	): string {
		const reasons: string[] = [];

		if (!gpsVerification.passed) {
			reasons.push(`GPS verification failed: ${gpsVerification.reason || 'Trainer not at student home location'}`);
		}

		if (!faceVerification.passed) {
			reasons.push(`Face verification failed: ${faceVerification.reason || 'Face does not match trainer profile'}`);
		}

		return reasons.join('; ');
	}

	/**
	 * @deprecated This method is deprecated. Progress is now automatically updated via database triggers
	 * when tutoring_sessions status changes to 'completed'. No manual progress updates are needed.
	 */
	private async updateCourseProgressAfterSession(session: SessionRecord): Promise<void> {
		// Progress is now handled automatically by database triggers
		// No action needed - triggers update student_course_progress when session is completed
		console.log('[Session Service] Progress update skipped - handled automatically by database triggers');
	}

	/**
	 * Check if course is completed and send notification
	 */
	private async checkAndNotifyCourseCompletion(studentId: string, courseId: string): Promise<void> {
		try {
			const courseServiceUrl = process.env.COURSE_SERVICE_URL || 
				`http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.COURSE_SERVICE_PORT || 3005}`;

			const axios = (await import('axios')).default;

			// Get course progress
			const progressResponse = await axios.get(
				`${courseServiceUrl}/api/v1/students/${studentId}/courses/${courseId}/progress`
			);

			if (progressResponse.data?.data) {
				const progress = progressResponse.data.data;
				
				// Check if all levels are completed
				const allLevelsCompleted = progress.levels?.every((level: any) => level.completed === true);

				if (allLevelsCompleted) {
					// Get course name
					const courseResponse = await axios.get(`${courseServiceUrl}/api/courses/${courseId}`, {
						timeout: 5000, // 5 seconds for internal service call
					});
					const courseName = courseResponse.data?.data?.title || courseResponse.data?.title || 'your course';

					// PHASE 3 FIX: Emit notification event (replaces HTTP call)
					await emitCourseCompletionNotification(studentId, courseName, courseId);

				}
			}
		} catch (error: any) {
			console.error('[Session Service] Error checking course completion:', {
				error: error.message,
				studentId,
				courseId,
			});
			// Don't throw - this is a background operation
		}
	}
}

