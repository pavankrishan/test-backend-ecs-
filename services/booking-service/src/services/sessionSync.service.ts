/**
 * Session Sync Service
 * Syncs purchase_sessions to admin-service tutoring_sessions table
 * This ensures sessions created by auto-assignment are visible in the frontend
 */

import type { Pool, PoolClient } from 'pg';
import type { PurchaseSession } from '../models/purchaseSession.model';
import type { CoursePurchase } from '../models/coursePurchase.model';
import logger from '@kodingcaravan/shared/config/logger';

export interface SessionSyncResult {
	success: boolean;
	sessionsCreated: number;
	sessionsUpdated: number;
	errors: Array<{ sessionId: string; error: string }>;
}

export class SessionSyncService {
	constructor(private readonly pool: Pool) {}

	/**
	 * Sync purchase sessions to tutoring_sessions table
	 * Called when trainer is assigned via auto-assignment
	 */
	async syncPurchaseSessionsToTutoringSessions(
		purchase: CoursePurchase,
		purchaseSessions: PurchaseSession[],
		trainerId: string,
		client?: PoolClient
	): Promise<SessionSyncResult> {
		const result: SessionSyncResult = {
			success: true,
			sessionsCreated: 0,
			sessionsUpdated: 0,
			errors: [],
		};

		if (!purchaseSessions || purchaseSessions.length === 0) {
			logger.debug('No purchase sessions to sync', {
				purchaseId: purchase.id,
				service: 'booking-service',
			});
			return result;
		}

		// Get primary student (first student in the list)
		const primaryStudent = purchase.students && Array.isArray(purchase.students) && purchase.students.length > 0
			? purchase.students[0]
			: null;

		if (!primaryStudent || !primaryStudent.id) {
			const error = 'No primary student found in purchase';
			logger.error('No primary student found in purchase', {
				purchaseId: purchase.id,
				service: 'booking-service',
			});
			result.success = false;
			result.errors.push({ sessionId: 'unknown', error });
			return result;
		}

		const studentId = typeof primaryStudent.id === 'string' ? primaryStudent.id : primaryStudent.id;

		// Get student location
		// Validate student location
		const studentLocation = purchase.studentLocation;
		if (!studentLocation) {
			const error = 'Student location missing in purchase';
			logger.error('Student location missing in purchase', {
				purchaseId: purchase.id,
				studentId,
				service: 'booking-service',
			});
			result.success = false;
			result.errors.push({ sessionId: 'unknown', error });
			return result;
		}

		// Validate coordinates
		const normalizedLatitude = typeof studentLocation.latitude === 'number' ? studentLocation.latitude : parseFloat(String(studentLocation.latitude));
		const normalizedLongitude = typeof studentLocation.longitude === 'number' ? studentLocation.longitude : parseFloat(String(studentLocation.longitude));

		if (isNaN(normalizedLatitude) || isNaN(normalizedLongitude) || 
			normalizedLatitude < -90 || normalizedLatitude > 90 || 
			normalizedLongitude < -180 || normalizedLongitude > 180) {
			const error = `Invalid student coordinates: lat=${studentLocation.latitude}, lng=${studentLocation.longitude}`;
			logger.error('Invalid student coordinates', {
				latitude: studentLocation.latitude,
				longitude: studentLocation.longitude,
				purchaseId: purchase.id,
				studentId,
				service: 'booking-service',
			});
			result.success = false;
			result.errors.push({ sessionId: 'unknown', error });
			return result;
		}

		// Calculate session duration based on delivery mode
		// Sunday-only sessions are 80 minutes (2 sessions = 80 mins), regular are 40 mins
		const sessionDuration = purchase.deliveryMode === 'SUNDAY_ONLY' ? 80 : 40;

		// Create or find allocation record
		let allocationId: string | null = null;
		try {
			allocationId = await this.ensureAllocation(
				studentId,
				trainerId,
				purchase.courseId || null,
				purchase,
				client
			);
		} catch (error: any) {
			const errorMsg = `Failed to create/find allocation: ${error.message}`;
			logger.error('Failed to create/find allocation', {
				error: error?.message || String(error),
				stack: error?.stack,
				studentId,
				trainerId,
				purchaseId: purchase.id,
				service: 'booking-service',
			});
			// Don't fail completely - try to sync without allocation_id
			// Some systems might allow sessions without allocations
			logger.warn('Continuing sync without allocation_id - sessions may need manual allocation linking', {
				studentId,
				trainerId,
				purchaseId: purchase.id,
				service: 'booking-service',
			});
		}

		// If allocation creation failed, we'll sync with null allocation_id
		// This allows sessions to be created and linked later

		// Sync each session
		for (const purchaseSession of purchaseSessions) {
			try {
				// Normalize session date
				const sessionDate = purchaseSession.sessionDate instanceof Date 
					? purchaseSession.sessionDate 
					: typeof purchaseSession.sessionDate === 'string'
					? new Date(purchaseSession.sessionDate)
					: new Date(purchaseSession.sessionDate as any);

				const synced = await this.syncSingleSession(
					{
						...purchaseSession,
						sessionDate: sessionDate,
					},
					allocationId,
					studentId,
					trainerId,
					purchase.courseId || null,
					{
						latitude: normalizedLatitude,
						longitude: normalizedLongitude,
					},
					sessionDuration,
					client
				);

				if (synced.created) {
					result.sessionsCreated++;
				} else if (synced.updated) {
					result.sessionsUpdated++;
				}
			} catch (error: any) {
				const errorMsg = error.message || String(error);
				logger.error('Failed to sync session', {
					error: errorMsg,
					stack: error?.stack,
					sessionId: purchaseSession.id,
					purchaseId: purchase.id,
					studentId,
					trainerId,
					service: 'booking-service',
				});
				result.errors.push({
					sessionId: purchaseSession.id,
					error: errorMsg,
				});
				result.success = false;
			}
		}

		if (result.errors.length === 0) {
			logger.info('Successfully synced purchase sessions', {
				sessionsCreated: result.sessionsCreated,
				sessionsUpdated: result.sessionsUpdated,
				purchaseId: purchase.id,
				studentId,
				trainerId,
				service: 'booking-service',
			});
		} else {
			logger.warn('Partially synced purchase sessions', {
				sessionsCreated: result.sessionsCreated,
				sessionsUpdated: result.sessionsUpdated,
				errorsCount: result.errors.length,
				purchaseId: purchase.id,
				studentId,
				trainerId,
				service: 'booking-service',
			});
		}

		return result;
	}

	/**
	 * Ensure allocation exists in trainer_allocations table
	 */
	private async ensureAllocation(
		studentId: string,
		trainerId: string,
		courseId: string | null,
		purchase: CoursePurchase,
		client?: PoolClient
	): Promise<string> {
		const queryFn = client ? client.query.bind(client) : this.pool.query.bind(this.pool);

		// Check if allocation already exists
		const existingQuery = await queryFn(
			`
				SELECT id FROM trainer_allocations
				WHERE student_id = $1 
					AND trainer_id = $2 
					AND (course_id = $3 OR (course_id IS NULL AND $3 IS NULL))
					AND status IN ('approved', 'active')
				LIMIT 1
			`,
			[studentId, trainerId, courseId]
		);

		if (existingQuery.rows.length > 0) {
			return existingQuery.rows[0].id;
		}

		// Create new allocation
		const metadata = {
			sessionCount: purchase.totalSessions,
			isSundayOnly: purchase.deliveryMode === 'SUNDAY_ONLY',
			schedule: {
				timeSlot: purchase.preferredTimeSlot || '4:00 PM',
				date: purchase.startDate ? new Date(purchase.startDate).toISOString() : null,
			},
			purchaseId: purchase.id,
			bookingId: purchase.bookingId,
		};

		const insertQuery = await queryFn(
			`
				INSERT INTO trainer_allocations (
					id,
					student_id,
					trainer_id,
					course_id,
					status,
					metadata,
					created_at,
					updated_at
				)
				VALUES (
					gen_random_uuid(),
					$1,
					$2,
					$3,
					'approved',
					$4::jsonb,
					NOW(),
					NOW()
				)
				RETURNING id
			`,
			[studentId, trainerId, courseId, JSON.stringify(metadata)]
		);

		if (insertQuery.rows.length === 0) {
			throw new Error('Failed to create allocation');
		}

		logger.info('Created allocation for session sync', {
			allocationId: insertQuery.rows[0].id,
			studentId,
			trainerId,
			courseId: courseId || null,
			service: 'booking-service',
		});
		return insertQuery.rows[0].id;
	}

	/**
	 * Sync a single purchase session to tutoring_sessions
	 */
	private async syncSingleSession(
		purchaseSession: PurchaseSession & { sessionDate: Date },
		allocationId: string | null,
		studentId: string,
		trainerId: string,
		courseId: string | null,
		studentLocation: { latitude: number; longitude: number },
		sessionDuration: number,
		client?: PoolClient
	): Promise<{ created: boolean; updated: boolean }> {
		const queryFn = client ? client.query.bind(client) : this.pool.query.bind(this.pool);

		// Check if session already exists
		const existingQuery = await queryFn(
			`
				SELECT id FROM tutoring_sessions
				WHERE id = $1
				LIMIT 1
			`,
			[purchaseSession.id]
		);

		// Normalize student location
		const normalizedLatitude = typeof studentLocation.latitude === 'number' ? studentLocation.latitude : parseFloat(String(studentLocation.latitude));
		const normalizedLongitude = typeof studentLocation.longitude === 'number' ? studentLocation.longitude : parseFloat(String(studentLocation.longitude));

		const studentHomeLocation: { latitude: number; longitude: number; address?: string | null } = {
			latitude: normalizedLatitude,
			longitude: normalizedLongitude,
		};

		// Add address if available
		if ('address' in studentLocation && studentLocation.address) {
			studentHomeLocation.address = String(studentLocation.address);
		}

		// Preserve all metadata from purchase session, including booking flags for HYBRID sessions
		const metadata = {
			purchaseId: purchaseSession.purchaseId,
			bookingId: purchaseSession.bookingId,
			sessionNumber: purchaseSession.sessionNumber,
			sessionType: purchaseSession.sessionType,
			// Preserve booking-related metadata for HYBRID sessions
			// Online sessions: isBookable=false, isFixedTime=true, requiresBooking=false
			// Offline sessions: isBookable=true, isFixedTime=false, requiresBooking=true
			...(purchaseSession.metadata || {}),
		};

		if (existingQuery.rows.length > 0) {
			// Update existing session (only update if not already in progress/completed)
			// Note: allocation_id might be nullable, so handle it carefully
			const updateQuery = allocationId
				? `
					UPDATE tutoring_sessions
					SET
						allocation_id = COALESCE(allocation_id, $1),
						student_id = $2,
						trainer_id = $3,
						course_id = COALESCE(course_id, $4),
						scheduled_date = $5,
						scheduled_time = $6,
						duration = COALESCE(duration, $7),
						status = CASE 
							WHEN status IN ('in_progress', 'completed', 'pending_confirmation') THEN status
							ELSE $8
						END,
						student_home_location = COALESCE(student_home_location, $9::jsonb),
						metadata = COALESCE(metadata, '{}'::jsonb) || $10::jsonb,
						updated_at = NOW()
					WHERE id = $11
				`
				: `
					UPDATE tutoring_sessions
					SET
						student_id = $1,
						trainer_id = $2,
						course_id = COALESCE(course_id, $3),
						scheduled_date = $4,
						scheduled_time = $5,
						duration = COALESCE(duration, $6),
						status = CASE 
							WHEN status IN ('in_progress', 'completed', 'pending_confirmation') THEN status
							ELSE $7
						END,
						student_home_location = COALESCE(student_home_location, $8::jsonb),
						metadata = COALESCE(metadata, '{}'::jsonb) || $9::jsonb,
						updated_at = NOW()
					WHERE id = $10
				`;

			const updateParams = allocationId
				? [
						allocationId,
						studentId,
						trainerId,
						courseId,
						purchaseSession.sessionDate.toISOString().split('T')[0],
						purchaseSession.sessionTime,
						sessionDuration,
						purchaseSession.status === 'completed' ? 'completed' : 
						purchaseSession.status === 'cancelled' ? 'cancelled' : 'scheduled',
						JSON.stringify(studentHomeLocation),
						JSON.stringify(metadata),
						purchaseSession.id,
				  ]
				: [
						studentId,
						trainerId,
						courseId,
						purchaseSession.sessionDate.toISOString().split('T')[0],
						purchaseSession.sessionTime,
						sessionDuration,
						purchaseSession.status === 'completed' ? 'completed' : 
						purchaseSession.status === 'cancelled' ? 'cancelled' : 'scheduled',
						JSON.stringify(studentHomeLocation),
						JSON.stringify(metadata),
						purchaseSession.id,
				  ];

			await queryFn(updateQuery, updateParams);
			return { created: false, updated: true };
		} else {
			// Create new session
			// Handle nullable allocation_id
			const insertQuery = allocationId
				? `
					INSERT INTO tutoring_sessions (
						id,
						allocation_id,
						student_id,
						trainer_id,
						course_id,
						scheduled_date,
						scheduled_time,
						duration,
						status,
						student_home_location,
						metadata,
						created_at,
						updated_at
					)
					VALUES (
						$1,
						$2,
						$3,
						$4,
						$5,
						$6,
						$7,
						$8,
						$9,
						$10::jsonb,
						$11::jsonb,
						NOW(),
						NOW()
					)
				`
				: `
					INSERT INTO tutoring_sessions (
						id,
						student_id,
						trainer_id,
						course_id,
						scheduled_date,
						scheduled_time,
						duration,
						status,
						student_home_location,
						metadata,
						created_at,
						updated_at
					)
					VALUES (
						$1,
						$2,
						$3,
						$4,
						$5,
						$6,
						$7,
						$8,
						$9::jsonb,
						$10::jsonb,
						NOW(),
						NOW()
					)
				`;

			const insertParams = allocationId
				? [
						purchaseSession.id,
						allocationId,
						studentId,
						trainerId,
						courseId,
						purchaseSession.sessionDate.toISOString().split('T')[0],
						purchaseSession.sessionTime,
						sessionDuration,
						purchaseSession.status === 'completed' ? 'completed' : 
						purchaseSession.status === 'cancelled' ? 'cancelled' : 'scheduled',
						JSON.stringify(studentHomeLocation),
						JSON.stringify(metadata),
				  ]
				: [
						purchaseSession.id,
						studentId,
						trainerId,
						courseId,
						purchaseSession.sessionDate.toISOString().split('T')[0],
						purchaseSession.sessionTime,
						sessionDuration,
						purchaseSession.status === 'completed' ? 'completed' : 
						purchaseSession.status === 'cancelled' ? 'cancelled' : 'scheduled',
						JSON.stringify(studentHomeLocation),
						JSON.stringify(metadata),
				  ];

			await queryFn(insertQuery, insertParams);
			return { created: true, updated: false };
		}
	}

	/**
	 * Sync a single purchase session by ID
	 * Useful for background sync jobs
	 */
	async syncPurchaseSessionById(
		purchaseSessionId: string,
		client?: PoolClient
	): Promise<{ success: boolean; error?: string }> {
		try {
			const queryFn = client ? client.query.bind(client) : this.pool.query.bind(this.pool);

			// Get purchase session with purchase details
			const purchaseSessionQuery = await queryFn(
				`
					SELECT 
						ps.*,
						cp.trainer_id,
						cp.course_id,
						cp.students,
						cp.student_location,
						cp.delivery_mode,
						cp.total_sessions,
						cp.preferred_time_slot,
						cp.start_date,
						cp.booking_id
					FROM purchase_sessions ps
					JOIN course_purchases cp ON ps.purchase_id = cp.id
					WHERE ps.id = $1
				`,
				[purchaseSessionId]
			);

			if (purchaseSessionQuery.rows.length === 0) {
				return { success: false, error: 'Purchase session not found' };
			}

			const row = purchaseSessionQuery.rows[0];
			const trainerId = row.trainer_id;

			if (!trainerId) {
				return { success: false, error: 'No trainer assigned to purchase' };
			}

			const purchase: CoursePurchase = {
				id: row.purchase_id,
				bookingId: row.booking_id,
				courseId: row.course_id,
				students: row.students,
				studentLocation: row.student_location,
				deliveryMode: row.delivery_mode,
				totalSessions: row.total_sessions,
				preferredTimeSlot: row.preferred_time_slot,
				startDate: row.start_date,
			} as CoursePurchase;

			const purchaseSession: PurchaseSession = {
				id: row.id,
				purchaseId: row.purchase_id,
				bookingId: row.booking_id,
				sessionNumber: row.session_number,
				sessionDate: row.session_date instanceof Date ? row.session_date : new Date(row.session_date),
				sessionTime: row.session_time,
				sessionType: row.session_type,
				status: row.status,
				metadata: row.metadata || null,
				createdAt: row.created_at ? new Date(row.created_at) : new Date(),
				updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
			};

			const result = await this.syncPurchaseSessionsToTutoringSessions(
				purchase,
				[purchaseSession],
				trainerId,
				client
			);

			if (result.success && result.errors.length === 0) {
				return { success: true };
			}
			return {
				success: false,
				error: result.errors.length > 0 ? result.errors[0]?.error || 'Unknown error' : 'Sync failed',
			};
		} catch (error: any) {
			logger.error('Error syncing purchase session', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				purchaseSessionId,
				service: 'booking-service',
			});
			return {
				success: false,
				error: error.message || String(error),
			};
		}
	}
}

