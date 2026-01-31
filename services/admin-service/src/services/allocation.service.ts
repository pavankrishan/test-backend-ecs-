import { AppError } from '@kodingcaravan/shared';
import { shouldSkipDateForSessions } from '@kodingcaravan/shared/src/utils/dateUtils';
import type { SessionsGeneratedEvent } from '@kodingcaravan/shared/events/types';
import logger from '@kodingcaravan/shared/config/logger';
import { getPool } from '../config/database';
// PHASE 3 FIX: Replaced HTTP notification calls with event emissions
import {
	emitTrainerAssignmentNotification,
	emitTrainerAssignedNotification,
	emitTrainerAllocationCapacityNotification,
	emitSessionScheduledNotification,
	emitTrainerSessionScheduledNotification,
	emitNotificationRequested,
} from '@kodingcaravan/shared/utils/notificationEventEmitter';
import {
	TrainerAllocationRepository,
	type TrainerAllocationRecord,
	type CreateAllocationInput,
	type UpdateAllocationInput,
	type AllocationStatus,
} from '../models/trainerAllocation.model';
import { SessionService } from './session.service';
import type { CreateSessionInput } from '../models/session.model';
import { PayrollAllocationSyncService } from './payrollAllocationSync.service';
import { DemandTrackingService } from './demandTracking.service';

export class AllocationService {
	private allocationRepo: TrainerAllocationRepository;
	private pool = getPool();
	private sessionService: SessionService;
	private payrollSyncService: PayrollAllocationSyncService;
	private demandTrackingService: DemandTrackingService;

	constructor() {
		this.allocationRepo = new TrainerAllocationRepository(this.pool);
		this.sessionService = new SessionService();
		this.payrollSyncService = new PayrollAllocationSyncService();
		this.demandTrackingService = new DemandTrackingService();
	}

	/**
	 * Derive display schedule type from allocation metadata (for learnings card: Class Format + Schedule).
	 */
	private getScheduleTypeFromMetadata(metadata: Record<string, unknown> | null | undefined): string | null {
		if (!metadata || typeof metadata !== 'object') return null;
		const isSundayOnly = metadata.isSundayOnly === true;
		const schedule = metadata.schedule && typeof metadata.schedule === 'object' ? metadata.schedule as Record<string, unknown> : null;
		const mode = (schedule?.mode as string) || (metadata.scheduleType as string) || (metadata.schedule_mode as string) || (metadata.scheduleMode as string);
		if (isSundayOnly || (mode && String(mode).toLowerCase().includes('sunday'))) return 'Sunday Only';
		if (mode && String(mode).toLowerCase() === 'everyday') return 'Everyday';
		if (mode && typeof mode === 'string') return mode.charAt(0).toUpperCase() + mode.slice(1).toLowerCase();
		return null;
	}

	/**
	 * Get trainer's max allocation count (4-8) based on their rating
	 * This is the MAXIMUM number of students a trainer can be allocated to
	 * Higher rated trainers can handle more students (up to 8), lower rated trainers have lower limits (min 4)
	 * Note: Rating also determines PRIORITY for allocation (higher rating = higher priority)
	 * But this function only returns the LIMIT, not the priority
	 */
	private async getTrainerMaxAllocationCount(trainerId: string): Promise<number> {
		try {
			// Get trainer's rating from trainer_profiles
			const ratingResult = await this.pool.query<{ rating_average: number | null }>(
				`SELECT rating_average FROM trainer_profiles WHERE trainer_id = $1`,
				[trainerId]
			);

			const rating = ratingResult.rows[0]?.rating_average;
			
			// If no rating, default to minimum (4)
			if (!rating || rating === null) {
				logger.info('Trainer has no rating, using default min allocation', {
					trainerId,
					defaultAllocation: 4,
					service: 'allocation-service',
				});
				return 4;
			}

			// Map rating to allocation tier (4-8)
			// Rating scale: 0-5 stars
			// Higher rating = more allocations
			// Rating 0-2.0: 4 allocations (min)
			// Rating 2.1-3.0: 4 allocations
			// Rating 3.1-3.5: 5 allocations
			// Rating 3.6-4.0: 6 allocations
			// Rating 4.1-4.5: 7 allocations
			// Rating 4.6-5.0: 8 allocations (max)
			let maxAllocation = 4; // Default minimum
			
			if (rating >= 4.6) {
				maxAllocation = 8;
			} else if (rating >= 4.1) {
				maxAllocation = 7;
			} else if (rating >= 3.6) {
				maxAllocation = 6;
			} else if (rating >= 3.1) {
				maxAllocation = 5;
			} else if (rating >= 2.1) {
				maxAllocation = 4;
			} else {
				maxAllocation = 4;
			}

			logger.info('Trainer rating and max allocation determined', {
				trainerId,
				rating,
				maxAllocation,
				service: 'allocation-service',
			});
			return maxAllocation;
		} catch (error: any) {
			logger.error('Error getting trainer max allocation', {
				trainerId,
				error: error?.message || String(error),
				stack: error?.stack,
				service: 'allocation-service',
			});
			// Default to minimum on error
			return 4;
		}
	}

	/**
	 * Get trainer's current allocation count (active + approved allocations)
	 */
	private async getTrainerCurrentAllocationCount(trainerId: string): Promise<number> {
		try {
			const result = await this.pool.query<{ count: string }>(
				`SELECT COUNT(*) as count 
				FROM trainer_allocations 
				WHERE trainer_id = $1 
					AND status IN ('approved', 'active')`,
				[trainerId]
			);

			const count = parseInt(result.rows[0]?.count || '0', 10);
			return count;
		} catch (error: any) {
			logger.error('Error getting trainer current allocation count', {
				trainerId,
				error: error?.message || String(error),
				stack: error?.stack,
				service: 'allocation-service',
			});
			return 0;
		}
	}

	/**
	 * Manually create sessions for existing allocations that failed due to missing GPS coordinates
	 * This is useful when students update their addresses after purchase
	 */
	async createSessionsForExistingAllocation(allocationId: string): Promise<{ success: boolean; message: string; sessionsCreated?: number }> {
		try {
			// Get the allocation
			const allocation = await this.allocationRepo.findById(allocationId);
			if (!allocation) {
				throw new AppError('Allocation not found', 404);
			}

			// Check if allocation is approved/active
			if (allocation.status !== 'approved' && allocation.status !== 'active') {
				return {
					success: false,
					message: `Allocation status is ${allocation.status}. Sessions can only be created for approved or active allocations.`,
				};
			}

			// Check if sessions already exist for this allocation
			const existingSessions = await this.pool.query(
				'SELECT COUNT(*) as count FROM tutoring_sessions WHERE allocation_id = $1',
				[allocationId]
			);

			if (parseInt(existingSessions.rows[0].count) > 0) {
				return {
					success: false,
					message: `Sessions already exist for this allocation (${existingSessions.rows[0].count} sessions found)`,
				};
			}

			// Try to create initial session
			await this.createInitialSession(allocation);

			// Verify sessions were created
			const newSessions = await this.pool.query(
				'SELECT COUNT(*) as count FROM tutoring_sessions WHERE allocation_id = $1',
				[allocationId]
			);

			const sessionsCreated = parseInt(newSessions.rows[0].count);

			return {
				success: true,
				message: `Successfully created ${sessionsCreated} sessions for allocation`,
				sessionsCreated,
			};

		} catch (error) {
			logger.error('Failed to create sessions for allocation', {
				allocationId,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				service: 'allocation-service',
			});
			return {
				success: false,
				message: error instanceof Error ? error.message : 'Unknown error occurred',
			};
		}
	}

	/**
	 * Create sessions for all approved allocations that don't have sessions yet
	 * Useful for bulk processing after geocoding fixes
	 */
	async createSessionsForPendingAllocations(): Promise<{ processed: number; successful: number; failed: number; results: any[] }> {
		try {
			// Get all approved/active allocations without sessions
			const allocations = await this.pool.query<TrainerAllocationRecord>(
				`
					SELECT a.* FROM trainer_allocations a
					LEFT JOIN tutoring_sessions s ON a.id = s.allocation_id
					WHERE a.status IN ('approved', 'active')
					AND s.id IS NULL
					ORDER BY a.created_at DESC
				`
			);

			logger.info('Found allocations without sessions', {
				count: allocations.rows.length,
				service: 'allocation-service',
			});

			let successful = 0;
			let failed = 0;
			const results = [];

			for (const allocation of allocations.rows) {
				try {
					logger.info('Creating sessions for allocation', {
						allocationId: allocation.id,
						studentId: allocation.studentId,
						service: 'allocation-service',
					});

					const result = await this.createSessionsForExistingAllocation(allocation.id);
					results.push({
						allocationId: allocation.id,
						studentId: allocation.studentId,
						...result,
					});

					if (result.success) {
						successful++;
					} else {
						failed++;
					}

				} catch (error) {
					logger.error('Failed to create sessions for allocation', {
						allocationId: allocation.id,
						studentId: allocation.studentId,
						error: error instanceof Error ? error.message : String(error),
						stack: error instanceof Error ? error.stack : undefined,
						service: 'allocation-service',
					});
					results.push({
						allocationId: allocation.id,
						studentId: allocation.studentId,
						success: false,
						message: error instanceof Error ? error.message : 'Unknown error',
					});
					failed++;
				}
			}

			logger.info('Bulk session creation completed', {
				successful,
				failed,
				total: allocations.rows.length,
				service: 'allocation-service',
			});

			return {
				processed: allocations.rows.length,
				successful,
				failed,
				results,
			};

		} catch (error) {
			logger.error('Failed to create sessions for pending allocations', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				service: 'allocation-service',
			});
			throw new AppError('Failed to create sessions for pending allocations', 500);
		}
	}

	/**
	 * Create a new trainer allocation request
	 * Prevents duplicate allocations for the same student-trainer-course combination
	 */
	async createAllocation(input: CreateAllocationInput): Promise<TrainerAllocationRecord> {
		// Check for existing approved allocation for same student-trainer-course
		if (input.trainerId && input.studentId) {
			// Query directly to check for duplicates with courseId
			const existingQuery = input.courseId
				? await this.pool.query(
						`
							SELECT id FROM trainer_allocations
							WHERE student_id = $1 AND trainer_id = $2 AND course_id = $3 AND status = $4
							LIMIT 1
						`,
						[input.studentId, input.trainerId, input.courseId, 'approved']
				  )
				: await this.pool.query(
						`
							SELECT id FROM trainer_allocations
							WHERE student_id = $1 AND trainer_id = $2 AND course_id IS NULL AND status = $3
							LIMIT 1
						`,
						[input.studentId, input.trainerId, 'approved']
				  );

			if (existingQuery.rows.length > 0) {
				throw new AppError(
					`An approved allocation already exists for this student-trainer${input.courseId ? '-course' : ''} combination`,
					409
				);
			}

			// Also check for pending allocations
			const pendingQuery = input.courseId
				? await this.pool.query(
						`
							SELECT id FROM trainer_allocations
							WHERE student_id = $1 AND trainer_id = $2 AND course_id = $3 AND status = $4
							LIMIT 1
						`,
						[input.studentId, input.trainerId, input.courseId, 'pending']
				  )
				: await this.pool.query(
						`
							SELECT id FROM trainer_allocations
							WHERE student_id = $1 AND trainer_id = $2 AND course_id IS NULL AND status = $3
							LIMIT 1
						`,
						[input.studentId, input.trainerId, 'pending']
				  );

			if (pendingQuery.rows.length > 0) {
				throw new AppError(
					`A pending allocation already exists for this student-trainer${input.courseId ? '-course' : ''} combination`,
					409
				);
			}
		}

		const allocation = await this.allocationRepo.create(input);

		return allocation;
	}

	/**
	 * Approve allocation and allocate trainer to student
	 */
	async approveAllocation(
		allocationId: string,
		adminId: string,
		trainerId?: string
	): Promise<TrainerAllocationRecord> {
		const allocation = await this.allocationRepo.findById(allocationId);
		if (!allocation) {
			throw new AppError('Allocation not found', 404);
		}

		if (allocation.status !== 'pending') {
			throw new AppError(`Cannot approve allocation with status: ${allocation.status}`, 400);
		}

		// If trainerId is provided, use it; otherwise keep existing trainerId
		const finalTrainerId = trainerId || allocation.trainerId;
		if (!finalTrainerId) {
			throw new AppError('Trainer ID is required to approve allocation', 400);
		}

		const updated = await this.allocationRepo.update(
			allocationId,
			{
				trainerId: finalTrainerId,
				status: 'approved',
			},
			adminId
		);

		if (!updated) {
			throw new AppError('Failed to approve allocation', 500);
		}

		// PHASE 3 FIX: Send notifications via events (replaces HTTP calls)
		try {
			// Get trainer name
			let trainerName = 'your trainer';
			if (finalTrainerId) {
				const trainerResult = await this.pool.query(
					`SELECT full_name FROM trainer_profiles WHERE trainer_id = $1`,
					[finalTrainerId]
				);
				if (trainerResult.rows[0]?.full_name) {
					trainerName = trainerResult.rows[0].full_name;
				}
			}
			
			// Get student name
			let studentName = 'a student';
			if (allocation.studentId) {
				const studentResult = await this.pool.query(
					`SELECT full_name FROM student_profiles WHERE student_id = $1`,
					[allocation.studentId]
				);
				if (studentResult.rows[0]?.full_name) {
					studentName = studentResult.rows[0].full_name;
				}
			}
			
			// Get course name if available
			let courseName: string | undefined;
			if (allocation.courseId) {
				const courseServiceUrl = process.env.COURSE_SERVICE_URL || 
					`http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.COURSE_SERVICE_PORT || 3005}`;
				try {
					const axios = (await import('axios')).default;
					const courseResponse = await axios.get(`${courseServiceUrl}/api/courses/${allocation.courseId}`, {
						timeout: 5000, // 5 seconds for internal service call
					});
					courseName = courseResponse.data?.data?.title || courseResponse.data?.title;
				} catch (e) {
					// Course name fetch failed, continue without it
				}
			}
			
			// PHASE 3 FIX: Emit notification events (non-blocking)
			if (allocation.studentId) {
				await emitTrainerAssignmentNotification(
					allocation.studentId,
					trainerName,
					courseName,
					allocation.id // correlationId
				);
			}
			
			if (finalTrainerId) {
				await emitTrainerAssignedNotification(
					finalTrainerId,
					studentName,
					courseName,
					allocation.id // correlationId
				);

				// Check if trainer reached 6 allocations and send capacity notification
				try {
					const currentAllocationCount = await this.getTrainerCurrentAllocationCount(finalTrainerId);
					const maxAllocationCount = await this.getTrainerMaxAllocationCount(finalTrainerId);
					
					// Get trainer rating for notification
					const ratingResult = await this.pool.query<{ rating_average: number | null }>(
						`SELECT rating_average FROM trainer_profiles WHERE trainer_id = $1`,
						[finalTrainerId]
					);
					const rating = ratingResult.rows[0]?.rating_average || 0;

					// Send notification when trainer reaches exactly 6 allocations
					if (currentAllocationCount === 6) {
						logger.info('Trainer reached 6 allocations, sending capacity notification', {
							trainerId: finalTrainerId,
							currentAllocations: currentAllocationCount,
							service: 'allocation-service',
						});
						await emitTrainerAllocationCapacityNotification(
							finalTrainerId,
							currentAllocationCount,
							maxAllocationCount,
							rating,
							allocation.id // correlationId
						);
					}
				} catch (error) {
					logger.error('Failed to check allocation capacity', {
						error: error instanceof Error ? error.message : String(error),
						trainerId: finalTrainerId,
						service: 'allocation-service',
					});
					// Don't throw - capacity check failure shouldn't break allocation
				}
			}
		} catch (error) {
			logger.error('Failed to send assignment notifications', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				allocationId: allocation.id,
				service: 'allocation-service',
			});
			// Don't throw - notification failure shouldn't break allocation
		}

		// Create initial session automatically after allocation approval
		try {
			await this.createInitialSession(updated);
		} catch (error: any) {
			const errorMessage = error?.message || String(error);
			const errorStack = error?.stack || '';
			logger.error('Failed to create initial sessions', {
				error: errorMessage,
				allocationId: updated.id,
				studentId: updated.studentId,
				trainerId: updated.trainerId,
				stack: errorStack,
				service: 'allocation-service',
			});
			// Don't throw - session creation failure shouldn't break allocation
			// Session can be created manually later, but log the error prominently
		}

		return updated;
	}

	/**
	 * Create all sessions after allocation approval
	 * Creates sessions based on purchase_tier (sessionCount) and purchase type:
	 * - Regular purchases: Creates sessions for consecutive days (including Sundays)
	 * - Sunday-only purchases: Creates sessions only on Sundays (weekly, skipping weekdays)
	 * 
	 * Session duration:
	 * - Regular sessions: 40 minutes (default)
	 * - Sunday-only sessions: 80 minutes (2 sessions = 80 mins, because 1 session = 40 mins)
	 * 
	 * Uses preferred time slot and date from allocation metadata, or defaults
	 * 
	 * Examples:
	 * - Regular: If student purchased 20 sessions, creates 20 sessions for 20 consecutive days
	 * - Sunday-only: If student purchased 10 Sunday sessions, creates 10 sessions on 10 consecutive Sundays
	 */
	private async createInitialSession(allocation: TrainerAllocationRecord): Promise<void> {
		// Get student home location from student profile
		const studentProfileResult = await this.pool.query<{
			address: string | null;
			latitude: number | null;
			longitude: number | null;
		}>(
			`
				SELECT 
					address,
					latitude,
					longitude
				FROM student_profiles
				WHERE student_id = $1
			`,
			[allocation.studentId]
		);

		if (studentProfileResult.rows.length === 0) {
			logger.error('Student profile not found, cannot create sessions', {
				studentId: allocation.studentId,
				allocationId: allocation.id,
				service: 'allocation-service',
			});
			throw new Error(`Student profile not found for student ${allocation.studentId}`);
		}

		const studentProfile = studentProfileResult.rows[0];
		
		// Check if student has valid location coordinates
		const hasValidLocation = studentProfile?.latitude != null && 
			studentProfile?.longitude != null && 
			typeof studentProfile.latitude === 'number' && 
			typeof studentProfile.longitude === 'number' &&
			!isNaN(studentProfile.latitude) && 
			!isNaN(studentProfile.longitude) &&
			studentProfile.latitude >= -90 && 
			studentProfile.latitude <= 90 &&
			studentProfile.longitude >= -180 && 
			studentProfile.longitude <= 180;

		if (!hasValidLocation) {
			logger.error('Student does not have valid GPS coordinates, cannot create sessions', {
				studentId: allocation.studentId,
				allocationId: allocation.id,
				address: studentProfile?.address || 'not set',
				hasLatitude: !!studentProfile?.latitude,
				hasLongitude: !!studentProfile?.longitude,
				service: 'allocation-service',
			});
			throw new Error(`Student ${allocation.studentId} does not have valid GPS coordinates. Please update address in profile to generate location coordinates.`);
		}

		const studentHomeLocation = {
			latitude: studentProfile.latitude!,
			longitude: studentProfile.longitude!,
			address: studentProfile.address || undefined,
		};


		// Get preferred schedule from allocation metadata or use defaults
		const metadata = allocation.metadata && typeof allocation.metadata === 'object' 
			? allocation.metadata as Record<string, unknown> 
			: {};
		const schedule: Record<string, unknown> = (metadata.schedule && typeof metadata.schedule === 'object') 
			? metadata.schedule as Record<string, unknown> 
			: {};

		// Extract preferred time slot and date
		const preferredTimeSlot = (schedule.timeSlot as string) || 
			(metadata.timeSlot as string) || 
			'4:00 PM'; // Default to 4 PM

		// CRITICAL: Extract start date from multiple possible locations
		// Priority: schedule.startDate > schedule.date > metadata.startDate > metadata.date > metadata.preferredDate
		// This ensures we get the date the user selected during purchase
		let preferredDate: string | undefined = 
			(schedule.startDate as string) ||
			(schedule.date as string) ||
			(metadata.startDate as string) ||
			(metadata.date as string) ||
			(metadata.preferredDate as string) ||
			undefined;
		
		// If still no date found, try fetching from purchase record
		if (!preferredDate && allocation.courseId) {
			try {
				const purchaseResult = await this.pool.query<{
					metadata: any;
				}>(
					`
						SELECT metadata
						FROM student_course_purchases
						WHERE student_id = $1 AND course_id = $2 AND is_active = true
						ORDER BY created_at DESC
						LIMIT 1
					`,
					[allocation.studentId, allocation.courseId]
				);

				if (purchaseResult.rows.length > 0 && purchaseResult.rows[0].metadata) {
					const purchaseMeta = purchaseResult.rows[0].metadata as Record<string, unknown>;
					const purchaseSchedule = (purchaseMeta.schedule as Record<string, unknown>) || {};
					
					preferredDate = 
						(purchaseSchedule.startDate as string) ||
						(purchaseSchedule.date as string) ||
						(purchaseMeta.startDate as string) ||
						(purchaseMeta.date as string) ||
						(purchaseMeta.preferredDate as string) ||
						undefined;
					
					if (preferredDate) {
						logger.info('Retrieved start date from purchase record', {
							preferredDate,
							allocationId: allocation.id,
							studentId: allocation.studentId,
							service: 'allocation-service',
						});
					}
				}
			} catch (error: any) {
				logger.warn('Could not fetch start date from purchase record', {
					error: error?.message || String(error),
					allocationId: allocation.id,
					studentId: allocation.studentId,
					service: 'allocation-service',
				});
			}
		}

		// Get session count from metadata, direct field, or purchase record (priority order)
		let sessionCount: number = 30; // Default to 30 sessions
		
		// Priority 1: Check allocation metadata
		if (metadata.sessionCount && typeof metadata.sessionCount === 'number') {
			sessionCount = metadata.sessionCount;
		} else if ((allocation as any).sessionCount && typeof (allocation as any).sessionCount === 'number') {
			sessionCount = (allocation as any).sessionCount;
		} else {
			// Priority 2: Fetch from purchase record if courseId is available
			if (allocation.courseId) {
				try {
					const purchaseResult = await this.pool.query<{
						purchase_tier: number;
						metadata: any;
					}>(
						`
							SELECT purchase_tier, metadata
							FROM student_course_purchases
							WHERE student_id = $1 AND course_id = $2 AND is_active = true
							ORDER BY created_at DESC
							LIMIT 1
						`,
						[allocation.studentId, allocation.courseId]
					);

					if (purchaseResult.rows.length > 0) {
						const purchase = purchaseResult.rows[0];
						// Use purchase_tier (most reliable)
						if (purchase.purchase_tier && [10, 20, 30].includes(purchase.purchase_tier)) {
							sessionCount = purchase.purchase_tier;
							logger.info('Retrieved session count from purchase record', {
								sessionCount,
								allocationId: allocation.id,
								studentId: allocation.studentId,
								service: 'allocation-service',
							});
						} else if (purchase.metadata && typeof purchase.metadata === 'object') {
							// Fallback to metadata.sessionCount
							const purchaseMeta = purchase.metadata as Record<string, unknown>;
							if (typeof purchaseMeta.sessionCount === 'number' && [10, 20, 30].includes(purchaseMeta.sessionCount)) {
								sessionCount = purchaseMeta.sessionCount;
								logger.info('Retrieved session count from purchase metadata', {
									sessionCount,
									allocationId: allocation.id,
									studentId: allocation.studentId,
									service: 'allocation-service',
								});
							}
						}
					} else {
						logger.warn('No active purchase record found, using default session count', {
							studentId: allocation.studentId,
							courseId: allocation.courseId,
							defaultSessionCount: sessionCount,
							allocationId: allocation.id,
							service: 'allocation-service',
						});
					}
				} catch (error: any) {
					logger.error('Failed to fetch purchase record for session count', {
						error: error?.message || String(error),
						studentId: allocation.studentId,
						courseId: allocation.courseId,
						allocationId: allocation.id,
						service: 'allocation-service',
					});
					// Continue with default session count
				}
			} else {
				logger.warn('No courseId in allocation, using default session count', {
					allocationId: allocation.id,
					defaultSessionCount: sessionCount,
					service: 'allocation-service',
				});
			}
		}
		
		logger.info('Session creation parameters', {
			allocationId: allocation.id,
			studentId: allocation.studentId,
			trainerId: allocation.trainerId,
			sessionCount,
			preferredTimeSlot,
			preferredDate,
			hasValidLocation,
			metadataKeys: Object.keys(metadata),
			scheduleKeys: schedule ? Object.keys(schedule) : [],
			hasScheduleStartDate: !!(schedule.startDate as string),
			hasScheduleDate: !!(schedule.date as string),
			hasMetadataStartDate: !!(metadata.startDate as string),
			hasMetadataDate: !!(metadata.date as string),
		});

		// Check if this is a Sunday-only purchase
		const isSundayOnly = (metadata.isSundayOnly as boolean) || false;
		
		// Get session duration (80 minutes for Sunday 2-session blocks, 40 for regular, 40 default)
		const sessionDuration = (metadata.sessionDuration as number) || 
			(isSundayOnly ? 80 : 40); // Sunday-only sessions are 80 mins (2 sessions), regular are 40 mins

		// Calculate start date
		// CRITICAL: Parse date correctly to avoid timezone issues
		let startDate: Date;
		if (preferredDate) {
			// Parse date string properly to avoid timezone issues
			// Handle both ISO format (2025-12-23T00:00:00Z) and date-only (2025-12-23)
			// Always extract date components to create local date (no timezone conversion)
			let dateStr: string;
			if (preferredDate.includes('T')) {
				// ISO format with time - extract just the date part (YYYY-MM-DD)
				dateStr = preferredDate.split('T')[0];
			} else {
				// Date-only format
				dateStr = preferredDate;
			}
			
			// Parse date components and create local date (no timezone conversion)
			const dateParts = dateStr.split(/[-/]/);
			if (dateParts.length === 3) {
				// Create date in local timezone (month is 0-indexed)
				startDate = new Date(
					parseInt(dateParts[0], 10), // year
					parseInt(dateParts[1], 10) - 1, // month (0-indexed)
					parseInt(dateParts[2], 10) // day
				);
			} else {
				// Fallback if parsing fails
				logger.warn('Could not parse date, using default (tomorrow)', {
					preferredDate,
					allocationId: allocation.id,
					service: 'allocation-service',
				});
				startDate = new Date();
				startDate.setDate(startDate.getDate() + 1);
			}
			
			// Validate the parsed date
			if (isNaN(startDate.getTime())) {
				logger.warn('Invalid preferred date, using default (tomorrow)', {
					preferredDate,
					allocationId: allocation.id,
					service: 'allocation-service',
				});
				startDate = new Date();
				startDate.setDate(startDate.getDate() + 1);
				} else {
					// Normalize to midnight local time
					startDate.setHours(0, 0, 0, 0);
					
					// Check if date is in the past
					const today = new Date();
					today.setHours(0, 0, 0, 0);
					
					// CRITICAL: Compare dates correctly (local dates, not UTC)
					const startDateLocal = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
					const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
					
					if (startDateLocal < todayLocal) {
						logger.warn('Preferred date is in the past, using tomorrow instead', {
							preferredDate,
							preferredDateParsed: startDateLocal.toISOString().split('T')[0],
							today: todayLocal.toISOString().split('T')[0],
							allocationId: allocation.id,
							service: 'allocation-service',
						});
						startDate = new Date();
						startDate.setDate(startDate.getDate() + 1);
						startDate.setHours(0, 0, 0, 0);
					} else {
						// Use the preferred date as-is (user selected this date)
						const formattedStartDate = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
						logger.info('Using preferred start date', {
							preferredDate,
							formattedStartDate,
							allocationId: allocation.id,
							service: 'allocation-service',
						});
						// Ensure we're using the correctly parsed date
						startDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
					}
				}
		} else {
			// Default to tomorrow (or next Sunday if Sunday-only)
			logger.warn('No preferred date found, using default (tomorrow)', {
				allocationId: allocation.id,
				service: 'allocation-service',
			});
			startDate = new Date();
			startDate.setDate(startDate.getDate() + 1);
			startDate.setHours(0, 0, 0, 0);
		}

		// If Sunday-only, find the next Sunday
		if (isSundayOnly) {
			// Find the next Sunday from startDate
			const dayOfWeek = startDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
			const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
			startDate.setDate(startDate.getDate() + daysUntilSunday);
		}

		// Reset time to start of day
		startDate.setHours(0, 0, 0, 0);
		
		// CRITICAL: Log the final start date being used
		const finalStartDateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
		logger.info('Creating sessions', {
			sessionCount,
			startDate: finalStartDateStr,
			preferredDate: preferredDate || 'not set',
			allocationId: allocation.id,
			service: 'allocation-service',
		});

		// Create all sessions
		const createdSessions = [];
		// CRITICAL: Use a fresh copy of startDate to avoid mutation issues
		// Create date using local components to avoid timezone conversion
		let currentDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
		let sessionsCreated = 0;

		// Track attempts to prevent infinite loops
		let maxAttempts = sessionCount * 2; // Allow some extra attempts for Sunday-only
		let attempts = 0;
		const failedDates: string[] = [];

		while (sessionsCreated < sessionCount && attempts < maxAttempts) {
			attempts++;

			// If Sunday-only, skip non-Sunday days
			if (isSundayOnly && currentDate.getDay() !== 0) {
				currentDate.setDate(currentDate.getDate() + 1);
				continue;
			}

			// Ensure date is not in the past
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const sessionDate = new Date(currentDate);
			sessionDate.setHours(0, 0, 0, 0);

			if (sessionDate < today) {
				logger.warn('Skipping past date, moving to next valid date', {
					date: sessionDate.toISOString().split('T')[0],
					allocationId: allocation.id,
					service: 'allocation-service',
				});
				// Move to next day
				if (isSundayOnly) {
					currentDate.setDate(currentDate.getDate() + 7);
				} else {
					currentDate.setDate(currentDate.getDate() + 1);
				}
				continue;
			}

			// BUSINESS RULE: Skip Sunday holidays (Sundays until July 31st)
			// Exception: Sunday-only courses are allowed (they're special)
			if (!isSundayOnly && shouldSkipDateForSessions(sessionDate)) {
				const dateStr = `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, '0')}-${String(sessionDate.getDate()).padStart(2, '0')}`;
				logger.debug('Skipping Sunday holiday', {
					date: dateStr,
					allocationId: allocation.id,
					service: 'allocation-service',
				});
				currentDate.setDate(currentDate.getDate() + 1);
				continue;
			}

			// Create session for current date
			// CRITICAL: Format date as YYYY-MM-DD string to avoid timezone conversion issues
			// When PostgreSQL receives a Date object, it may convert to UTC which can shift the date
			const sessionDateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
			
			// Create Date object from the formatted string to ensure correct date
			// Parse as local date to avoid UTC conversion
			const sessionScheduledDate = new Date(
				currentDate.getFullYear(),
				currentDate.getMonth(),
				currentDate.getDate(),
				12, // Set to noon local time to avoid timezone edge cases
				0,
				0,
				0
			);
			
			if (sessionsCreated === 0) {
				logger.info('First session scheduled date', {
					sessionDate: sessionDateStr,
					preferredDate: preferredDate || 'not set',
					startDate: finalStartDateStr || 'not set',
					allocationId: allocation.id,
					service: 'allocation-service',
				});
			}
			
			const sessionInput: CreateSessionInput = {
				allocationId: allocation.id,
				studentId: allocation.studentId,
				trainerId: allocation.trainerId!,
				courseId: allocation.courseId || null,
				scheduledDate: sessionScheduledDate,
				scheduledTime: preferredTimeSlot,
				duration: sessionDuration,
				studentHomeLocation: studentHomeLocation,
				notes: sessionsCreated === 0 
					? `Session ${sessionsCreated + 1} of ${sessionCount} - ${isSundayOnly ? 'Sunday-only' : 'Daily'} session - Created automatically after trainer assignment`
					: `Session ${sessionsCreated + 1} of ${sessionCount} - ${isSundayOnly ? 'Sunday-only' : 'Daily'} session`,
				metadata: {
					autoCreated: true,
					createdFromAllocation: allocation.id,
					sessionNumber: sessionsCreated + 1,
					totalSessions: sessionCount,
					isSundayOnly,
					sessionDuration,
					preferredSchedule: {
						timeSlot: preferredTimeSlot,
						date: preferredDate || startDate.toISOString(),
					},
				},
			};

			try {
				const session = await this.sessionService.createSession(sessionInput);
				createdSessions.push(session);
				sessionsCreated++;
				// Use local date for logging (not UTC) to show correct date
				const logDateStr = `${sessionScheduledDate.getFullYear()}-${String(sessionScheduledDate.getMonth() + 1).padStart(2, '0')}-${String(sessionScheduledDate.getDate()).padStart(2, '0')}`;
				logger.info('Created session', {
					sessionNumber: sessionsCreated,
					totalSessions: sessionCount,
					date: logDateStr,
					timeSlot: preferredTimeSlot,
					allocationId: allocation.id,
					service: 'allocation-service',
				});
				
			} catch (error: any) {
				const errorMessage = error?.message || String(error);
				const errorStatus = error?.status || error?.statusCode || 'unknown';
				// Use local date for error logging (not UTC)
				const dateStr = `${sessionScheduledDate.getFullYear()}-${String(sessionScheduledDate.getMonth() + 1).padStart(2, '0')}-${String(sessionScheduledDate.getDate()).padStart(2, '0')}`;
				failedDates.push(dateStr);

				// Check if it's a duplicate/conflict error - don't count as failure
				if (errorMessage.includes('already exists') || errorMessage.includes('duplicate')) {
					logger.info('Session already exists, skipping', {
						date: dateStr,
						timeSlot: preferredTimeSlot,
						allocationId: allocation.id,
						service: 'allocation-service',
					});
					sessionsCreated++; // Count as created since it already exists
					// Continue to next date
				} else {
					logger.error('Failed to create session', {
						error: errorMessage,
						status: errorStatus,
						allocationId: allocation.id,
						studentId: allocation.studentId,
						trainerId: allocation.trainerId,
						scheduledDate: dateStr,
						scheduledTime: preferredTimeSlot,
						hasValidLocation,
						sessionNumber: sessionsCreated + 1,
						totalSessions: sessionCount,
						stack: error?.stack?.split('\n').slice(0, 3).join('\n'),
						service: 'allocation-service',
					});
				}
			}

			// Move to next day (or next Sunday if Sunday-only)
			if (isSundayOnly) {
				// Move to next Sunday (7 days later)
				currentDate.setDate(currentDate.getDate() + 7);
			} else {
				// Move to next day (including Sundays - no skipping)
				currentDate.setDate(currentDate.getDate() + 1);
			}
		}

		// Log warning if we hit max attempts
		if (attempts >= maxAttempts && sessionsCreated < sessionCount) {
			logger.warn('Hit maximum attempts while creating sessions', {
				maxAttempts,
				sessionsCreated,
				sessionCount,
				allocationId: allocation.id,
				service: 'allocation-service',
			});
		}

		// Emit SESSIONS_GENERATED event if sessions were created
		// CRITICAL: Emit to both Kafka (for cache-worker) and Redis Pub/Sub (for WebSocket)
		// CRITICAL: This happens AFTER DB commit (sessions are already in DB)
		if (createdSessions.length > 0) {
			try {
				const sessionIds = createdSessions.map((s: any) => s.id).filter(Boolean);
				const firstSessionDate = createdSessions[0]?.scheduledDate;
				const startDateStr = firstSessionDate instanceof Date 
					? `${firstSessionDate.getFullYear()}-${String(firstSessionDate.getMonth() + 1).padStart(2, '0')}-${String(firstSessionDate.getDate()).padStart(2, '0')}`
					: new Date().toISOString().split('T')[0];
				
				const sessionsGeneratedEvent: SessionsGeneratedEvent = {
					type: 'SESSIONS_GENERATED',
					timestamp: Date.now(),
					userId: allocation.studentId,
					role: 'student',
					allocationId: allocation.id,
					trainerId: allocation.trainerId!,
					studentId: allocation.studentId,
					courseId: allocation.courseId || '',
					sessionCount: createdSessions.length,
					sessionIds,
					startDate: startDateStr,
				};
				
				// Emit to Kafka (for cache-worker and other Kafka consumers)
				// This ensures cache is invalidated AFTER sessions are committed to DB
				try {
					const { getKafkaEventBus } = await import('@kodingcaravan/shared/events/kafkaEventBus');
					const kafkaBus = getKafkaEventBus();
					await kafkaBus.connect();
					
					await kafkaBus.emit(sessionsGeneratedEvent, {
						eventId: `sessions-generated-${allocation.id}-${Date.now()}`,
						correlationId: allocation.id,
						source: 'admin-service',
						version: '1.0.0',
					});
					
					logger.info('SESSIONS_GENERATED event emitted to Kafka', {
						allocationId: allocation.id,
						sessionsCreated: createdSessions.length,
						sessionIds: sessionIds.length,
						service: 'allocation-service',
					});
				} catch (kafkaError: any) {
					logger.error('Failed to emit SESSIONS_GENERATED to Kafka (non-critical)', {
						error: kafkaError?.message || String(kafkaError),
						stack: kafkaError?.stack,
						allocationId: allocation.id,
						service: 'allocation-service',
					});
				}
				
				// Also emit to Redis Pub/Sub (for WebSocket/real-time updates)
				try {
					const { getEventBus } = await import('@kodingcaravan/shared/events/eventBus');
					const eventBus = getEventBus();
					await eventBus.emit(sessionsGeneratedEvent);
					
					logger.info('SESSIONS_GENERATED event emitted to Redis Pub/Sub', {
						allocationId: allocation.id,
						service: 'allocation-service',
					});
				} catch (redisError: any) {
					logger.error('Failed to emit SESSIONS_GENERATED to Redis Pub/Sub (non-critical)', {
						error: redisError?.message || String(redisError),
						allocationId: allocation.id,
						service: 'allocation-service',
					});
				}
			} catch (error: any) {
				logger.error('Failed to emit SESSIONS_GENERATED event (non-critical)', {
					error: error?.message || String(error),
					stack: error?.stack,
					allocationId: allocation.id,
					service: 'allocation-service',
				});
			}
		}

		// Final summary with production-grade logging
		if (createdSessions.length === sessionCount) {
			logger.info('Successfully created all sessions', {
				allocationId: allocation.id,
				sessionsCreated: createdSessions.length,
				sessionsExpected: sessionCount,
				successRate: '100%',
				firstSessionDate: createdSessions[0]?.scheduledDate,
				lastSessionDate: createdSessions[createdSessions.length - 1]?.scheduledDate,
				service: 'allocation-service',
			});
		} else if (createdSessions.length > 0) {
			const successRate = ((createdSessions.length / sessionCount) * 100).toFixed(1);
			logger.warn('Partial session creation', {
				allocationId: allocation.id,
				sessionsCreated: createdSessions.length,
				sessionsExpected: sessionCount,
				sessionsFailed: sessionCount - createdSessions.length,
				successRate: `${successRate}%`,
				failedDates: failedDates.length > 0 ? failedDates.slice(0, 5) : [], // Show first 5 failed dates
				requiresIntervention: (createdSessions.length / sessionCount) < 0.5, // Flag if less than 50% success
			});
		} else {
			logger.error('Failed to create any sessions', {
				allocationId: allocation.id,
				sessionsExpected: sessionCount,
				sessionsCreated: 0,
				successRate: '0%',
				failedDates: failedDates.length > 0 ? failedDates.slice(0, 10) : [],
				requiresManualIntervention: true,
				studentId: allocation.studentId,
				trainerId: allocation.trainerId,
				courseId: allocation.courseId,
			});
		}

		// Use first session for notifications
		const session = createdSessions[0];

		// PHASE 3 FIX: Send notifications via events (replaces HTTP calls)
		if (session) {
			try {
				// Get trainer name
				let trainerName = 'your trainer';
				if (allocation.trainerId) {
					const trainerResult = await this.pool.query(
						`SELECT full_name FROM trainer_profiles WHERE trainer_id = $1`,
						[allocation.trainerId]
					);
					if (trainerResult.rows[0]?.full_name) {
						trainerName = trainerResult.rows[0].full_name;
					}
				}

				// Get student name
				let studentName = 'a student';
				if (allocation.studentId) {
					const studentResult = await this.pool.query(
						`SELECT full_name FROM student_profiles WHERE student_id = $1`,
						[allocation.studentId]
					);
					if (studentResult.rows[0]?.full_name) {
						studentName = studentResult.rows[0].full_name;
					}
				}

				// PHASE 3 FIX: Emit notification events (replaces HTTP calls)
				if (allocation.studentId) {
					await emitSessionScheduledNotification(
						allocation.studentId,
						trainerName,
						session.scheduledDate,
						session.scheduledTime,
						allocation.id // correlationId
					);
				}

				if (allocation.trainerId) {
					await emitTrainerSessionScheduledNotification(
						allocation.trainerId,
						studentName,
						session.scheduledDate,
						session.scheduledTime,
						allocation.id // correlationId
					);
				}
			} catch (error) {
				logger.error('Failed to emit session notification events', {
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					allocationId: allocation.id,
					service: 'allocation-service',
				});
				// Don't throw - notification failure shouldn't break session creation
			}
		}
	}

	/**
	 * Create additional sessions for course upgrade
	 * This function adds only the additional sessions, starting from the last existing session
	 */
	async createAdditionalSessionsForUpgrade(
		allocation: TrainerAllocationRecord,
		additionalSessions: number,
		timeSlot: string,
		preferredStartDate?: string
	): Promise<void> {
		try {
			// Get student location
			const studentProfile = await this.pool.query<{
				latitude: number | null;
				longitude: number | null;
				address: string | null;
			}>(
				`SELECT latitude, longitude, address FROM student_profiles WHERE student_id = $1`,
				[allocation.studentId]
			);

			if (studentProfile.rows.length === 0) {
				throw new AppError('Student profile not found', 404);
			}

			const profile = studentProfile.rows[0];
			if (!profile.latitude || !profile.longitude) {
				throw new AppError('Student GPS coordinates are missing. Please update address in profile.', 400);
			}

			const studentHomeLocation = {
				latitude: profile.latitude!,
				longitude: profile.longitude!,
				address: profile.address || 'Address not set',
			};

			// Get metadata from allocation
			const metadata = allocation.metadata && typeof allocation.metadata === 'object' 
				? allocation.metadata as Record<string, unknown> 
				: {};
			const schedule: Record<string, unknown> = (metadata.schedule && typeof metadata.schedule === 'object') 
				? metadata.schedule as Record<string, unknown> 
				: {};

			// Extract preferred time slot
			const preferredTimeSlot = (schedule.timeSlot as string) || 
				(metadata.timeSlot as string) || 
				timeSlot ||
				'4:00 PM';

			// Get the last session date for this allocation
			const lastSessionResult = await this.pool.query<{
				scheduled_date: Date;
			}>(
				`SELECT scheduled_date 
				FROM tutoring_sessions 
				WHERE allocation_id = $1 
				ORDER BY scheduled_date DESC 
				LIMIT 1`,
				[allocation.id]
			);

			let startDate: Date;
			if (preferredStartDate) {
				// Parse provided start date correctly to avoid timezone issues
				// Extract date components to create local date (no timezone conversion)
				let dateStr: string;
				if (preferredStartDate.includes('T')) {
					// ISO format with time - extract just the date part (YYYY-MM-DD)
					dateStr = preferredStartDate.split('T')[0];
				} else {
					// Date-only format
					dateStr = preferredStartDate;
				}
				
				// Parse date components and create local date (no timezone conversion)
				const dateParts = dateStr.split(/[-/]/);
				if (dateParts.length === 3) {
					// Create date in local timezone (month is 0-indexed)
					startDate = new Date(
						parseInt(dateParts[0], 10), // year
						parseInt(dateParts[1], 10) - 1, // month (0-indexed)
						parseInt(dateParts[2], 10) // day
					);
				} else {
					// Fallback if parsing fails
					logger.warn('Could not parse preferred start date, using calculated date', {
						preferredStartDate,
						allocationId: allocation.id,
						service: 'allocation-service',
					});
					if (lastSessionResult.rows.length > 0) {
						startDate = new Date(lastSessionResult.rows[0].scheduled_date);
						startDate.setDate(startDate.getDate() + 1);
					} else {
						startDate = new Date();
						startDate.setDate(startDate.getDate() + 1);
					}
				}
				startDate.setHours(0, 0, 0, 0);
				
				// Validate it's after the last session if sessions exist
				if (lastSessionResult.rows.length > 0) {
					const lastSessionDate = new Date(lastSessionResult.rows[0].scheduled_date);
					lastSessionDate.setHours(0, 0, 0, 0);
					const minStartDate = new Date(lastSessionDate);
					minStartDate.setDate(minStartDate.getDate() + 1);
					
					if (startDate < minStartDate) {
						logger.warn('Preferred start date is before minimum, using calculated date', {
							preferredDate: startDate.toISOString().split('T')[0],
							minimumDate: minStartDate.toISOString().split('T')[0],
							allocationId: allocation.id,
							service: 'allocation-service',
						});
						startDate = minStartDate;
					}
				}
				logger.info('Upgrade: Using provided start date', {
					startDate: startDate.toISOString().split('T')[0],
					allocationId: allocation.id,
					service: 'allocation-service',
				});
			} else if (lastSessionResult.rows.length > 0) {
				// Start from the day after the last session
				startDate = new Date(lastSessionResult.rows[0].scheduled_date);
				startDate.setDate(startDate.getDate() + 1);
				logger.info('Upgrade: Starting additional sessions from day after last session', {
					startDate: startDate.toISOString().split('T')[0],
					allocationId: allocation.id,
					service: 'allocation-service',
				});
			} else {
				// No existing sessions, start from today
				startDate = new Date();
				startDate.setDate(startDate.getDate() + 1);
				logger.warn('Upgrade: No existing sessions found, starting from tomorrow', {
					allocationId: allocation.id,
					service: 'allocation-service',
				});
			}

			// Check if this is Sunday-only
			const isSundayOnly = (metadata.isSundayOnly as boolean) || false;
			const sessionDuration = (metadata.sessionDuration as number) || 
				(isSundayOnly ? 80 : 60);

			// If Sunday-only, find the next Sunday
			if (isSundayOnly) {
				const dayOfWeek = startDate.getDay();
				const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
				startDate.setDate(startDate.getDate() + daysUntilSunday);
			}

			startDate.setHours(0, 0, 0, 0);

			// Create additional sessions
			const createdSessions = [];
			let currentDate = new Date(startDate);
			let sessionsCreated = 0;
			let maxAttempts = additionalSessions * 2;
			let attempts = 0;

			while (sessionsCreated < additionalSessions && attempts < maxAttempts) {
				attempts++;

				// If Sunday-only, skip non-Sunday days
				if (isSundayOnly && currentDate.getDay() !== 0) {
					currentDate.setDate(currentDate.getDate() + 1);
					continue;
				}

				// Ensure date is not in the past
				const today = new Date();
				today.setHours(0, 0, 0, 0);
				const sessionDate = new Date(currentDate);
				sessionDate.setHours(0, 0, 0, 0);

				if (sessionDate < today) {
					if (isSundayOnly) {
						currentDate.setDate(currentDate.getDate() + 7);
					} else {
						currentDate.setDate(currentDate.getDate() + 1);
					}
					continue;
				}

				// BUSINESS RULE: Skip Sunday holidays (Sundays until July 31st)
				// Exception: Sunday-only courses are allowed (they're special)
				if (!isSundayOnly && shouldSkipDateForSessions(sessionDate)) {
					const dateStr = `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, '0')}-${String(sessionDate.getDate()).padStart(2, '0')}`;
					logger.debug('Skipping Sunday holiday for upgrade', {
						date: dateStr,
						allocationId: allocation.id,
						service: 'allocation-service',
					});
					currentDate.setDate(currentDate.getDate() + 1);
					continue;
				}

				// Get current total session count
				const totalSessionsResult = await this.pool.query(
					`SELECT COUNT(*) as count FROM tutoring_sessions WHERE allocation_id = $1`,
					[allocation.id]
				);
				const currentTotalSessions = parseInt(totalSessionsResult.rows[0].count);
				const sessionNumber = currentTotalSessions + sessionsCreated + 1;

				// Create session
				// CRITICAL: Format date as YYYY-MM-DD string to avoid timezone conversion
				// Create Date object with local date components and set to noon to avoid timezone edge cases
				const upgradeSessionScheduledDate = new Date(
					currentDate.getFullYear(),
					currentDate.getMonth(),
					currentDate.getDate(),
					12, // Set to noon local time to avoid timezone edge cases
					0,
					0,
					0
				);
				
				// Use the trainer ID from allocation (may have changed during upgrade)
				const sessionTrainerId = allocation.trainerId!;
				
				const sessionInput: CreateSessionInput = {
					allocationId: allocation.id,
					studentId: allocation.studentId,
					trainerId: sessionTrainerId,
					courseId: allocation.courseId || null,
					scheduledDate: upgradeSessionScheduledDate,
					scheduledTime: preferredTimeSlot,
					duration: sessionDuration,
					studentHomeLocation: studentHomeLocation,
					notes: `Session ${sessionNumber} (Upgrade: +${additionalSessions} sessions) - Created automatically after course upgrade`,
					metadata: {
						autoCreated: true,
						createdFromAllocation: allocation.id,
						sessionNumber,
						isUpgrade: true,
						additionalSessions,
						isSundayOnly,
						sessionDuration,
					},
				};

				try {
					const session = await this.sessionService.createSession(sessionInput);
					createdSessions.push(session);
					sessionsCreated++;
					logger.info('Created upgrade session', {
						sessionNumber: sessionsCreated,
						totalSessions: additionalSessions,
						date: sessionDate.toISOString().split('T')[0],
						timeSlot: preferredTimeSlot,
						allocationId: allocation.id,
						service: 'allocation-service',
					});
				} catch (error: any) {
					const errorMessage = error?.message || String(error);
					if (errorMessage.includes('already exists') || errorMessage.includes('duplicate')) {
						logger.info('Session already exists for upgrade, skipping', {
							date: sessionDate.toISOString().split('T')[0],
							allocationId: allocation.id,
							service: 'allocation-service',
						});
						sessionsCreated++;
					} else {
						logger.error('Failed to create upgrade session', {
							error: errorMessage,
							sessionNumber: sessionsCreated + 1,
							totalSessions: additionalSessions,
							allocationId: allocation.id,
							service: 'allocation-service',
						});
					}
				}

				// Move to next day
				if (isSundayOnly) {
					currentDate.setDate(currentDate.getDate() + 7);
				} else {
					currentDate.setDate(currentDate.getDate() + 1);
				}
			}

			logger.info('Upgrade complete', {
				sessionsCreated,
				additionalSessions,
				allocationId: allocation.id,
				service: 'allocation-service',
			});
		} catch (error: any) {
			logger.error('Failed to create additional sessions for upgrade', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				allocationId: allocation.id,
				service: 'allocation-service',
			});
			throw error;
		}
	}

	/**
	 * Reject allocation
	 */
	async rejectAllocation(
		allocationId: string,
		adminId: string,
		rejectionReason: string
	): Promise<TrainerAllocationRecord> {
		const allocation = await this.allocationRepo.findById(allocationId);
		if (!allocation) {
			throw new AppError('Allocation not found', 404);
		}

		if (allocation.status !== 'pending') {
			throw new AppError(`Cannot reject allocation with status: ${allocation.status}`, 400);
		}

		const updated = await this.allocationRepo.update(
			allocationId,
			{
				status: 'rejected',
				rejectionReason,
			},
			adminId
		);

		if (!updated) {
			throw new AppError('Failed to reject allocation', 500);
		}

		// Send notification to student about rejection
		// PHASE 3 FIX: Emit notification event (replaces HTTP call)
		try {
			if (allocation.studentId) {
				await emitNotificationRequested({
					userId: allocation.studentId,
					role: 'student',
					notificationType: 'warning',
					title: 'Trainer Assignment Update',
					body: `Your trainer assignment request was not approved. ${rejectionReason ? `Reason: ${rejectionReason}` : 'Please contact support for more information.'}`,
					data: {
						allocationId,
						rejectionReason,
						type: 'allocation_rejected',
					},
					metadata: {
						correlationId: allocationId,
					},
				}, allocationId);
			}
		} catch (error) {
			logger.error('Failed to emit rejection notification event', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				allocationId,
				service: 'allocation-service',
			});
			// Don't throw - notification failure shouldn't break rejection
		}

		return updated;
	}

	/**
	 * Allocate trainer to student (creates or updates allocation)
	 */
	async allocateTrainer(
		studentId: string,
		trainerId: string,
		adminId: string,
		options?: {
			courseId?: string | null;
			notes?: string | null;
			metadata?: Record<string, unknown> | null;
		}
	): Promise<TrainerAllocationRecord> {
		// CRITICAL: Validate trainerId is provided and not empty
		if (!trainerId || typeof trainerId !== 'string' || trainerId.trim() === '') {
			logger.error('allocateTrainer - CRITICAL: Invalid trainerId provided', {
				studentId,
				trainerId,
				trainerIdType: typeof trainerId,
				courseId: options?.courseId,
				service: 'allocation-service',
			});
			throw new AppError('Cannot create allocation: trainerId is required and must be a valid UUID', 400);
		}

		// Validate UUID format (basic check)
		const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		if (!uuidRegex.test(trainerId)) {
			logger.error('allocateTrainer - CRITICAL: trainerId is not a valid UUID', {
				studentId,
				trainerId,
				courseId: options?.courseId,
				service: 'allocation-service',
			});
			throw new AppError('Cannot create allocation: trainerId must be a valid UUID', 400);
		}
		// CRITICAL FIX: Check for existing approved/active allocations FIRST to prevent duplicates
		// This ensures only ONE active allocation per student-course combination
		// Query directly for approved or active allocations (repository doesn't support array status)
		const existingApprovedResult = await this.pool.query<{
			id: string;
			student_id: string;
			trainer_id: string | null;
			course_id: string | null;
			requested_by: string;
			requested_at: Date | null;
			status: string;
			allocated_by: string | null;
			allocated_at: Date | null;
			rejected_by: string | null;
			rejected_at: Date | null;
			rejection_reason: string | null;
			notes: string | null;
			metadata: any;
			created_at: Date;
			updated_at: Date;
		}>(
			`SELECT * FROM trainer_allocations 
			WHERE student_id = $1 
				AND (course_id = $2 OR (course_id IS NULL AND $2 IS NULL))
				AND status IN ('approved', 'active')
			ORDER BY updated_at DESC
			LIMIT 1`,
			[studentId, options?.courseId ?? null]
		);
		
		const existingApproved = existingApprovedResult.rows.map(row => ({
			id: row.id,
			studentId: row.student_id,
			trainerId: row.trainer_id,
			courseId: row.course_id,
			requestedBy: row.requested_by,
			requestedAt: row.requested_at || new Date(),
			status: row.status as AllocationStatus,
			allocatedBy: row.allocated_by,
			allocatedAt: row.allocated_at,
			rejectedBy: row.rejected_by,
			rejectedAt: row.rejected_at,
			rejectionReason: row.rejection_reason,
			notes: row.notes,
			metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		})) as TrainerAllocationRecord[];

		if (existingApproved.length > 0) {
			const existing = existingApproved[0];
			logger.info('Existing approved/active allocation found, reusing instead of creating duplicate', {
				existingAllocationId: existing.id,
				studentId,
				courseId: options?.courseId || 'null',
				service: 'allocation-service',
			});
			
			// If it's the same trainer, just update metadata and return
			if (existing.trainerId === trainerId) {
				if (options?.metadata) {
					const updatedMetadata = {
						...(existing.metadata || {}),
						...(options.metadata || {}),
					};
					const updated = await this.allocationRepo.update(
						existing.id,
						{
							metadata: updatedMetadata,
							notes: options?.notes || existing.notes,
						},
						adminId
					);
					return updated || existing;
				}
				return existing;
			}
			
			// Different trainer - this is a trainer change, which should be handled separately
			// For now, throw error to prevent accidental trainer changes
			throw new AppError(
				`Student already has an active allocation with trainer ${existing.trainerId} for this course. Cannot assign different trainer ${trainerId} without first cancelling existing allocation.`,
				400
			);
		}

		// Check if there's an existing pending allocation for the SAME course
		// This ensures each course gets a new trainer allocation
		const existingPending = await this.allocationRepo.findAll({
			studentId,
			courseId: options?.courseId ?? null,
			status: 'pending',
			limit: 1,
		});

		if (existingPending.length > 0) {
			// Update existing pending allocation only if it's for the same course
			const updated = await this.allocationRepo.update(
				existingPending[0].id,
				{
					trainerId,
					status: 'approved',
					notes: options?.notes,
					metadata: options?.metadata ? {
						...(existingPending[0].metadata || {}),
						...(options.metadata || {}),
					} : undefined,
				},
				adminId
			);

			if (!updated) {
				throw new AppError('Failed to update allocation', 500);
			}

			// Sync to payroll allocations
			try {
				await this.payrollSyncService.syncAllocationToPayroll(updated);
			} catch (error: any) {
				logger.error('Failed to sync to payroll (non-critical)', {
					error: error?.message || String(error),
					allocationId: updated.id,
					service: 'allocation-service',
				});
			}

			// Create sessions after approval
			try {
				logger.info('Creating sessions for updated allocation', {
					allocationId: updated.id,
					studentId: updated.studentId,
					trainerId: updated.trainerId,
					service: 'allocation-service',
				});
				await this.createInitialSession(updated);
				logger.info('Successfully created sessions for allocation', {
					allocationId: updated.id,
					service: 'allocation-service',
				});
			} catch (error: any) {
				logger.error('Failed to create initial sessions after allocation update', {
					error: error?.message || String(error),
					stack: error?.stack,
					allocationId: updated.id,
					studentId: updated.studentId,
					trainerId: updated.trainerId,
					service: 'allocation-service',
				});
				// Don't throw - session creation failure shouldn't break allocation
				// Admin can manually create sessions if automatic creation fails
			}

			return updated;
		}

		// Create new allocation with metadata if provided
		const allocation = await this.allocationRepo.create({
			studentId,
			trainerId,
			courseId: options?.courseId,
			requestedBy: studentId, // Admin-initiated allocation
			notes: options?.notes,
			metadata: options?.metadata || undefined,
		});

		// Production logging - verify trainerId was set
		logger.info('allocateTrainer - Allocation created', {
			allocationId: allocation.id,
			studentId: allocation.studentId,
			trainerId: allocation.trainerId,
			status: allocation.status,
			hasTrainerId: !!allocation.trainerId,
			service: 'allocation-service',
		});

		// Immediately approve it
		const approved = await this.allocationRepo.update(
			allocation.id,
			{
				status: 'approved',
			},
			adminId
		);

		if (!approved) {
			throw new AppError('Failed to approve allocation', 500);
		}

		// Production logging - verify approval and trainerId
		logger.info('allocateTrainer - Allocation approved', {
			allocationId: approved.id,
			studentId: approved.studentId,
			trainerId: approved.trainerId,
			status: approved.status,
			hasTrainerId: !!approved.trainerId,
			service: 'allocation-service',
		});

		// Sync to payroll allocations
		try {
			await this.payrollSyncService.syncAllocationToPayroll(approved);
		} catch (error: any) {
			logger.error('Failed to sync to payroll (non-critical)', {
				error: error?.message || String(error),
				allocationId: approved.id,
				service: 'allocation-service',
			});
		}

			// Create sessions after approval - THIS IS CRITICAL FOR AUTOMATIC SESSION CREATION
		try {
			logger.info('Creating sessions for allocation', {
				allocationId: approved.id,
				studentId: approved.studentId,
				trainerId: approved.trainerId,
				service: 'allocation-service',
			});
			await this.createInitialSession(approved);
			logger.info('Successfully created sessions for allocation', {
				allocationId: approved.id,
				service: 'allocation-service',
			});

			// Verify sessions were actually created
			const sessionCheck = await this.pool.query(
				'SELECT COUNT(*) as count FROM tutoring_sessions WHERE allocation_id = $1',
				[approved.id]
			);
			const sessionCount = parseInt(sessionCheck.rows[0].count);
			logger.info('Verification: sessions created for allocation', {
				sessionCount,
				allocationId: approved.id,
				service: 'allocation-service',
			});
		} catch (error: any) {
			logger.error('Failed to create initial sessions after allocation approval', {
				error: error?.message || String(error),
				stack: error?.stack,
				allocationId: approved.id,
				studentId: approved.studentId,
				trainerId: approved.trainerId,
				service: 'allocation-service',
			});

			// CRITICAL: Check if it's GPS coordinates issue
			const studentProfile = await this.pool.query(
				'SELECT latitude, longitude, address FROM student_profiles WHERE student_id = $1',
				[approved.studentId]
			);

			if (studentProfile.rows.length > 0) {
				const profile = studentProfile.rows[0];
				logger.error('Student GPS Status', {
					studentId: approved.studentId,
					hasLatitude: profile.latitude !== null,
					hasLongitude: profile.longitude !== null,
					latitude: profile.latitude,
					longitude: profile.longitude,
					address: profile.address,
				});

				if (!profile.latitude || !profile.longitude) {
					logger.error('SOLUTION: Student needs GPS coordinates! Update address in profile to generate coordinates.', {
						studentId: approved.studentId,
						allocationId: approved.id,
						service: 'allocation-service',
					});
				}
			} else {
				logger.error('SOLUTION: Student profile not found! Student must complete profile setup.', {
					studentId: approved.studentId,
					allocationId: approved.id,
					service: 'allocation-service',
				});
			}

			// Don't throw - session creation failure shouldn't break allocation
			// Admin can manually create sessions if automatic creation fails
		}

		// Emit TRAINER_ALLOCATED event
		// CRITICAL: Emit to both Kafka (for workers) and Redis Pub/Sub (for WebSocket)
		try {
			// Get session count from metadata or default
			const sessionCount = (approved.metadata as any)?.sessionCount || 0;
			const startDate = (approved.metadata as any)?.schedule?.date || 
			                  ((approved.metadata as any)?.schedule as any)?.startDate || 
			                  new Date().toISOString();
			const endDate = (approved.metadata as any)?.endDate || null;
			
			const trainerAllocatedEvent = {
				type: 'TRAINER_ALLOCATED' as const,
				timestamp: Date.now(),
				userId: adminId,
				role: 'admin' as const,
				allocationId: approved.id,
				trainerId: approved.trainerId!,
				studentId: approved.studentId,
				courseId: approved.courseId || '',
				sessionCount,
				startDate: typeof startDate === 'string' ? startDate.split('T')[0] : new Date().toISOString().split('T')[0],
				endDate: endDate ? (typeof endDate === 'string' ? endDate : new Date(endDate).toISOString()) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
				metadata: {
					allocatedBy: adminId,
					notes: options?.notes,
				},
			};
			
			// Emit to Kafka (for allocation-worker, session-worker, cache-worker)
			try {
				const { getKafkaEventBus } = await import('@kodingcaravan/shared/events/kafkaEventBus');
				const kafkaBus = getKafkaEventBus();
				await kafkaBus.connect();
				
				await kafkaBus.emit(trainerAllocatedEvent, {
					eventId: approved.id, // Use allocationId directly as eventId (it's already a UUID)
					correlationId: approved.id,
					source: 'admin-service',
					version: '1.0.0',
				});
				
				logger.info('TRAINER_ALLOCATED event emitted to Kafka', {
					allocationId: approved.id,
					service: 'allocation-service',
				});
			} catch (kafkaError: any) {
				logger.error('Failed to emit TRAINER_ALLOCATED to Kafka (non-critical)', {
					error: kafkaError?.message || String(kafkaError),
					allocationId: approved.id,
					service: 'allocation-service',
				});
			}
			
			// Also emit to Redis Pub/Sub (for WebSocket/real-time updates)
			try {
				const { getEventBus } = await import('@kodingcaravan/shared/events/eventBus');
				const eventBus = getEventBus();
				await eventBus.emit(trainerAllocatedEvent);
				
				logger.info('TRAINER_ALLOCATED event emitted to Redis Pub/Sub', {
					allocationId: approved.id,
					service: 'allocation-service',
				});
			} catch (redisError: any) {
				logger.error('Failed to emit TRAINER_ALLOCATED to Redis Pub/Sub (non-critical)', {
					error: redisError?.message || String(redisError),
					allocationId: approved.id,
					service: 'allocation-service',
				});
			}
		} catch (error: any) {
			logger.error('Failed to emit TRAINER_ALLOCATED event (non-critical)', {
				error: error?.message || String(error),
				allocationId: approved.id,
				service: 'allocation-service',
			});
		}

		// PHASE 3 FIX: Send notifications via events (replaces HTTP calls)
		try {
			// Get trainer name
			let trainerName = 'your trainer';
			if (approved.trainerId) {
				const trainerResult = await this.pool.query(
					`SELECT full_name FROM trainer_profiles WHERE trainer_id = $1`,
					[approved.trainerId]
				);
				if (trainerResult.rows[0]?.full_name) {
					trainerName = trainerResult.rows[0].full_name;
				}
			}
			
			// Get student name
			let studentName = 'a student';
			if (approved.studentId) {
				const studentResult = await this.pool.query(
					`SELECT full_name FROM student_profiles WHERE student_id = $1`,
					[approved.studentId]
				);
				if (studentResult.rows[0]?.full_name) {
					studentName = studentResult.rows[0].full_name;
				}
			}
			
			// Get course name if available
			let courseName: string | undefined;
			if (approved.courseId) {
				const courseServiceUrl = process.env.COURSE_SERVICE_URL || 
					`http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.COURSE_SERVICE_PORT || 3005}`;
				try {
					const axios = (await import('axios')).default;
					const courseResponse = await axios.get(`${courseServiceUrl}/api/courses/${approved.courseId}`, {
						timeout: 5000, // 5 seconds for internal service call
					});
					courseName = courseResponse.data?.data?.title || courseResponse.data?.title;
				} catch (e) {
					// Course name fetch failed, continue without it
				}
			}
			
			// PHASE 3 FIX: Emit notification events (non-blocking)
			if (approved.studentId) {
				await emitTrainerAssignmentNotification(
					approved.studentId,
					trainerName,
					courseName,
					allocation.id // correlationId
				);
			}
			
			if (approved.trainerId) {
				await emitTrainerAssignedNotification(
					approved.trainerId,
					studentName,
					courseName,
					allocation.id // correlationId
				);

				// Check if trainer reached 6 allocations and send capacity notification
				try {
					const currentAllocationCount = await this.getTrainerCurrentAllocationCount(approved.trainerId);
					const maxAllocationCount = await this.getTrainerMaxAllocationCount(approved.trainerId);
					
					// Get trainer rating for notification
					const ratingResult = await this.pool.query<{ rating_average: number | null }>(
						`SELECT rating_average FROM trainer_profiles WHERE trainer_id = $1`,
						[approved.trainerId]
					);
					const rating = ratingResult.rows[0]?.rating_average || 0;

					// Send notification when trainer reaches exactly 6 allocations
					if (currentAllocationCount === 6) {
						logger.info('Trainer reached 6 allocations, sending capacity notification', {
							trainerId: approved.trainerId,
							currentAllocations: currentAllocationCount,
							service: 'allocation-service',
						});
						await emitTrainerAllocationCapacityNotification(
							approved.trainerId,
							currentAllocationCount,
							maxAllocationCount,
							rating,
							allocation.id // correlationId
						);
					}
				} catch (error) {
					logger.error('Failed to check allocation capacity', {
						error: error instanceof Error ? error.message : String(error),
						trainerId: approved.trainerId,
						service: 'allocation-service',
					});
					// Don't throw - capacity check failure shouldn't break allocation
				}
			}
		} catch (error) {
			logger.error('Failed to emit assignment notification events', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				allocationId: allocation.id,
				service: 'allocation-service',
			});
			// Don't throw - notification failure shouldn't break allocation
		}

		return approved;
	}

	/**
	 * Get allocation by ID
	 */
	async getAllocation(allocationId: string): Promise<TrainerAllocationRecord | null> {
		return this.allocationRepo.findById(allocationId);
	}

	/**
	 * Get all allocations with filters
	 */
	async getAllAllocations(filters?: {
		status?: AllocationStatus;
		studentId?: string;
		trainerId?: string;
		limit?: number;
		offset?: number;
	}): Promise<any[]> {
		const allocations = await this.allocationRepo.findAll(filters);
		// Enrich allocations with trainer, course, class type, and session count
		return this.enrichAllocationsWithDetails(allocations);
	}

	/**
	 * Enrich allocations with trainer, course, student, class type, and session count details
	 */
	private async enrichAllocationsWithDetails(allocations: TrainerAllocationRecord[]): Promise<any[]> {
		if (allocations.length === 0) {
			return [];
		}

		// Initialize maps first to ensure they're always in scope
		const studentsMap = new Map<string, any>();
		const trainersMap = new Map<string, any>();
		const trainerProfilesMap = new Map<string, any>();
		const coursesMap = new Map<string, any>();

		// Extract unique IDs for batch fetching
		const trainerIds = [...new Set(allocations.map(a => a.trainerId).filter(Boolean))] as string[];
		const studentIds = [...new Set(allocations.map(a => a.studentId))];
		const courseIds = [...new Set(allocations.map(a => a.courseId).filter(Boolean))] as string[];

		// Batch fetch students
		if (studentIds.length > 0) {
			try {
				const studentsResult = await this.pool.query<{
					student_id: string;
					full_name: string | null;
					age: number | null;
					gender: string | null;
					address: string | null;
					avatar_url: string | null;
					phone: string | null;
				}>(
					`SELECT 
						sp.student_id,
						sp.full_name,
						sp.age,
						sp.gender,
						sp.address,
						sp.avatar_url,
						s.phone
					FROM student_profiles sp
					LEFT JOIN students s ON s.id = sp.student_id
					WHERE sp.student_id = ANY($1::uuid[])`,
					[studentIds]
				);
				studentsResult.rows.forEach(row => studentsMap.set(row.student_id, row));
			} catch (error: any) {
				logger.error('Error batch fetching students', {
					error: error.message,
					stack: error.stack,
					studentIds: studentIds.length,
					service: 'allocation-service',
				});
			}
		}

		// Batch fetch trainers
		if (trainerIds.length > 0) {
			try {
				// Fetch basic trainer info
				const trainersResult = await this.pool.query<{
					id: string;
					phone: string | null;
				}>(
					`SELECT id, phone FROM trainers WHERE id = ANY($1::uuid[])`,
					[trainerIds]
				);
				trainersResult.rows.forEach(row => trainersMap.set(row.id, row));

				// Fetch trainer profiles
				const profileResult = await this.pool.query<{
					trainer_id: string;
					full_name: string | null;
					bio: string | null;
					specialties: string[] | null;
					years_of_experience: number | null;
					hourly_rate: number | null;
					preferred_languages: string[] | null;
					certifications: string[] | null;
					extra: any;
				}>(
					`SELECT 
						trainer_id, 
						full_name, 
						bio, 
						specialties, 
						years_of_experience, 
						hourly_rate, 
						preferred_languages,
						certifications,
						extra
					FROM trainer_profiles WHERE trainer_id = ANY($1::uuid[])`,
					[trainerIds]
				);
				profileResult.rows.forEach(row => trainerProfilesMap.set(row.trainer_id, row));
			} catch (error: any) {
				logger.error('Error batch fetching trainers', {
					error: error.message,
					stack: error.stack,
					trainerIds: trainerIds.length,
					service: 'allocation-service',
				});
			}
		}

		// Batch fetch courses
		if (courseIds.length > 0) {
			try {
				const coursesResult = await this.pool.query<{
					id: string;
					title: string | null;
					description: string | null;
					category: string | null;
					price: number | null;
					duration: number | null;
				}>(
					`SELECT id, title, description, category, price, duration
					FROM courses WHERE id = ANY($1::uuid[])`,
					[courseIds]
				);
				coursesResult.rows.forEach(row => coursesMap.set(row.id, row));
				
				// Log warning if some courses were not found
				if (coursesResult.rows.length < courseIds.length) {
					const foundIds = new Set(coursesResult.rows.map(r => r.id));
					const missingIds = courseIds.filter(id => !foundIds.has(id));
					logger.warn('Some courses not found in database', {
						missingCount: missingIds.length,
						missingIds: missingIds.slice(0, 5),
						totalRequested: courseIds.length,
						totalFound: coursesResult.rows.length,
						service: 'allocation-service',
					});
				}
			} catch (error: any) {
				logger.error('Error batch fetching courses', {
					error: error.message,
					stack: error.stack,
					courseIds: courseIds.length,
					service: 'allocation-service',
				});
			}
		}

		// Fetch missing courses from course service in parallel (if any)
		const missingCourseIds = allocations
			.filter(a => a.courseId && !coursesMap.has(a.courseId))
			.map(a => a.courseId!)
			.filter((id, index, self) => self.indexOf(id) === index); // Unique IDs only

		if (missingCourseIds.length > 0) {
			const courseServiceUrl = process.env.COURSE_SERVICE_URL || 
				`http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.COURSE_SERVICE_PORT || 3005}`;
			const axios = (await import('axios')).default;

			// Fetch all missing courses in parallel
			const courseFetchPromises = missingCourseIds.map(async (courseId) => {
				try {
					// Try /api/courses/:id first (standard endpoint)
					let courseResponse;
					try {
						courseResponse = await axios.get(`${courseServiceUrl}/api/courses/${courseId}`, {
							timeout: 5000,
						});
					} catch (apiError) {
						// Fallback to v1 endpoint if standard fails
						try {
							courseResponse = await axios.get(`${courseServiceUrl}/api/v1/courses/${courseId}`, {
								timeout: 5000,
							});
						} catch (v1Error) {
							throw apiError; // Throw original error
						}
					}

					// Handle different response formats
					const courseData = courseResponse.data?.data || courseResponse.data?.course || courseResponse.data;
					if (courseData && courseData.id) {
					return {
						id: courseData.id,
						title: courseData.title || null,
						description: courseData.description || null,
						category: courseData.category || null,
						price: courseData.price || null,
						duration: courseData.duration || null,
					};
					}
					return null;
				} catch (fetchError: any) {
					if (process.env.NODE_ENV !== 'production') {
						logger.warn('Failed to fetch course from service', {
							courseId,
							error: fetchError.message,
						});
					}
					return null;
				}
			});

			const fetchedCourses = await Promise.all(courseFetchPromises);
			fetchedCourses.forEach((course, index) => {
				if (course) {
					coursesMap.set(missingCourseIds[index], course);
				}
			});
		}

		// Enrich allocations (now all courses should be in coursesMap)
		return allocations.map((allocation) => {
			try {
				const student = studentsMap.get(allocation.studentId) || null;
				const trainer = allocation.trainerId 
					? (trainerProfilesMap.get(allocation.trainerId) || trainersMap.get(allocation.trainerId))
					: null;
				// Get course data - should be in map now (either from DB or service)
				let course = null;
				if (allocation.courseId) {
					course = coursesMap.get(allocation.courseId);
					if (!course) {
						// Course still not found - return placeholder
						course = {
							id: allocation.courseId,
							title: null,
							description: null,
							category: null,
							price: null,
							duration: null,
						};
					}
				}

				// Extract class type, session count, and schedule type from metadata
				const metadata = allocation.metadata || {};
				const groupSize = metadata.groupSize as number | undefined;
				const learningMode = metadata.learningMode as string | undefined;
				const sessionCount = metadata.sessionCount as number | undefined;
				const scheduleType = this.getScheduleTypeFromMetadata(metadata as Record<string, unknown>) ?? undefined;

				// Format class type: "1-on-1", "1-on-2", "1-on-3" + learning mode
				let classType = 'N/A';
				if (groupSize && learningMode) {
					const groupType = groupSize === 1 ? '1-on-1' : `1-on-${groupSize}`;
					const modeDisplay = learningMode === 'home' ? 'Home' : learningMode === 'hybrid' ? 'Hybrid' : learningMode;
					classType = `${groupType} (${modeDisplay})`;
				} else if (groupSize) {
					classType = groupSize === 1 ? '1-on-1' : `1-on-${groupSize}`;
				} else if (learningMode) {
					classType = learningMode === 'home' ? 'Home' : learningMode === 'hybrid' ? 'Hybrid' : learningMode;
				}

				// Extract avatar_url from extra field if it exists
				const trainerExtra = (trainer && typeof trainer.extra === 'object' && trainer.extra !== null) ? trainer.extra : {};
				const trainerAvatarUrl = trainerExtra.avatarUrl || trainerExtra.avatar_url || null;

				return {
					...allocation,
					student: student ? {
						id: student.student_id,
						fullName: student.full_name,
						age: student.age,
						gender: student.gender,
						address: student.address,
						avatarUrl: student.avatar_url,
						phone: student.phone,
					} : null,
					trainer: trainer ? {
						id: trainer.trainer_id || trainer.id,
						fullName: trainer.full_name || null,
						bio: trainer.bio || null,
						specialties: trainer.specialties || null,
						yearsOfExperience: trainer.years_of_experience || null,
						hourlyRate: trainer.hourly_rate || null,
						avatarUrl: trainerAvatarUrl,
						phone: trainer.phone || null,
						languages: trainer.preferred_languages || null,
						certifications: trainer.certifications || null,
					} : null,
					course: course ? {
						id: course.id,
						title: course.title || null, // Will be null if course exists but title is missing in DB
						description: course.description || null,
						category: course.category || null,
						price: course.price || null,
						duration: course.duration || null,
					} : (allocation.courseId ? {
						// Fallback: Return course object with ID even if not found in DB/service
						// Frontend will show "Course" as fallback for null title
						id: allocation.courseId,
						title: null,
						description: null,
						category: null,
						price: null,
						duration: null,
					} : null),
					classType,
					scheduleType,
					sessionCount: sessionCount || null,
				};
			} catch (error: any) {
				logger.error('Error enriching allocation', {
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					allocationId: allocation.id,
					service: 'allocation-service',
				});
				return {
					...allocation,
					student: null,
					trainer: null,
					course: null,
					classType: 'N/A',
					scheduleType: undefined,
					sessionCount: null,
				};
			}
		});
	}

	/**
	 * Get allocations for a student
	 */
	async getStudentAllocations(
		studentId: string,
		filters?: {
			status?: AllocationStatus;
			limit?: number;
			offset?: number;
		}
	): Promise<TrainerAllocationRecord[]> {
		return this.allocationRepo.findByStudentId(studentId, filters);
	}

	/**
	 * Get allocations for a trainer
	 */
	async getTrainerAllocations(
		trainerId: string,
		filters?: {
			status?: AllocationStatus;
			limit?: number;
			offset?: number;
		}
	): Promise<TrainerAllocationRecord[]> {
		// Production logging
		logger.debug('getTrainerAllocations called', {
			trainerId,
			status: filters?.status,
			limit: filters?.limit,
			offset: filters?.offset,
			service: 'allocation-service',
		});

		const allocations = await this.allocationRepo.findByTrainerId(trainerId, filters);
		
		// Production logging
		logger.debug('getTrainerAllocations result', {
			trainerId,
			status: filters?.status,
			count: allocations.length,
			allocationIds: allocations.map(a => a.id),
			allocationStatuses: allocations.map(a => a.status),
			service: 'allocation-service',
		});

		// Enrich allocations with student, course, class type, and session count
		return this.enrichTrainerAllocations(allocations);
	}

	/**
	 * Enrich trainer allocations with student, course, class type, and session count
	 */
	private async enrichTrainerAllocations(allocations: TrainerAllocationRecord[]): Promise<any[]> {
		if (allocations.length === 0) {
			return [];
		}

		// Extract unique IDs for batch fetching
		const studentIds = [...new Set(allocations.map(a => a.studentId))];
		const courseIds = [...new Set(allocations.map(a => a.courseId).filter(Boolean))];

		// Batch fetch students
		const studentsMap = new Map<string, any>();
		if (studentIds.length > 0) {
			try {
				const studentsResult = await this.pool.query<{
					student_id: string;
					full_name: string | null;
					age: number | null;
					gender: string | null;
					address: string | null;
					avatar_url: string | null;
					phone: string | null;
				}>(
					`SELECT 
						sp.student_id,
						sp.full_name,
						sp.age,
						sp.gender,
						sp.address,
						sp.avatar_url,
						s.phone
					FROM student_profiles sp
					LEFT JOIN students s ON s.id = sp.student_id
					WHERE sp.student_id = ANY($1::uuid[])`,
					[studentIds]
				);
				studentsResult.rows.forEach(row => studentsMap.set(row.student_id, row));
			} catch (error: any) {
				logger.error('Error batch fetching students', {
					error: error.message,
					stack: error.stack,
					studentIds: studentIds.length,
					service: 'allocation-service',
				});
			}
		}

		// Batch fetch courses
		const coursesMap = new Map<string, any>();
		if (courseIds.length > 0) {
			try {
				const coursesResult = await this.pool.query<{
					id: string;
					title: string | null;
					description: string | null;
					category: string | null;
					price: number | null;
					duration: number | null;
				}>(
					`SELECT id, title, description, category, price, duration
					FROM courses WHERE id = ANY($1::uuid[])`,
					[courseIds]
				);
				coursesResult.rows.forEach(row => coursesMap.set(row.id, row));
			} catch (error: any) {
				logger.error('Error batch fetching courses', {
					error: error.message,
					stack: error.stack,
					courseIds: courseIds.length,
					service: 'allocation-service',
				});
			}
		}

		// Batch fetch purchase metadata to get additional students
		const purchaseMetadataMap = new Map<string, any>();
		if (studentIds.length > 0 && courseIds.length > 0) {
			try {
				const purchaseResult = await this.pool.query<{
					student_id: string;
					course_id: string;
					metadata: any;
				}>(
					`SELECT student_id, course_id, metadata
					FROM student_course_purchases
					WHERE student_id = ANY($1::uuid[])
					AND course_id = ANY($2::uuid[])
					AND is_active = true`,
					[studentIds, courseIds]
				);
				purchaseResult.rows.forEach(row => {
					const key = `${row.student_id}-${row.course_id}`;
					purchaseMetadataMap.set(key, row.metadata);
				});
			} catch (error: any) {
				logger.error('Error batch fetching purchase metadata', {
					error: error.message,
					stack: error.stack,
					service: 'allocation-service',
				});
			}
		}

		// Enrich allocations
		return allocations.map((allocation) => {
			try {
				const student = studentsMap.get(allocation.studentId) || null;
				const course = allocation.courseId ? (coursesMap.get(allocation.courseId) || { id: allocation.courseId }) : null;

				// Extract class type and session count from metadata
				// Also check direct field (allocation.sessionCount) in case metadata doesn't have it
				const metadata = allocation.metadata || {};
				const groupSize = metadata.groupSize as number | undefined;
				const learningMode = metadata.learningMode as string | undefined;
				// Get sessionCount from metadata OR direct field (from JOIN - more reliable)
				const sessionCount = metadata.sessionCount as number | undefined 
					|| (allocation as any).sessionCount as number | undefined;
				
				// Extract additional students from purchase metadata
				let additionalStudents: Array<{ id?: string; name: string; email: string; phone?: string; dateOfBirth?: string; gender?: string }> | undefined = undefined;
				if (allocation.studentId && allocation.courseId) {
					const purchaseKey = `${allocation.studentId}-${allocation.courseId}`;
					const purchaseMetadata = purchaseMetadataMap.get(purchaseKey);
					if (purchaseMetadata && typeof purchaseMetadata === 'object') {
						const purchaseMeta = purchaseMetadata as Record<string, unknown>;
						if (Array.isArray(purchaseMeta.additionalStudents)) {
							additionalStudents = purchaseMeta.additionalStudents as Array<{ id?: string; name: string; email: string; phone?: string; dateOfBirth?: string; gender?: string }>;
						}
					}
				}
				
				// If sessionCount is missing, log warning for debugging
				if (!sessionCount) {
					logger.warn('No sessionCount found for allocation', {
						allocationId: allocation.id,
						studentId: allocation.studentId,
						courseId: allocation.courseId,
						metadataSessionCount: metadata.sessionCount,
						directSessionCount: (allocation as any).sessionCount,
						hasMetadata: !!allocation.metadata,
					});
				}
				
				// Format class type: "1-on-1", "1-on-2", "1-on-3" + learning mode
				let classType = 'N/A';
				if (groupSize && learningMode) {
					const groupType = groupSize === 1 ? '1-on-1' : `1-on-${groupSize}`;
					const modeDisplay = learningMode === 'home' ? 'Home' : learningMode === 'hybrid' ? 'Hybrid' : learningMode;
					classType = `${groupType} (${modeDisplay})`;
				} else if (groupSize) {
					classType = groupSize === 1 ? '1-on-1' : `1-on-${groupSize}`;
				} else if (learningMode) {
					classType = learningMode === 'home' ? 'Home' : learningMode === 'hybrid' ? 'Hybrid' : learningMode;
				}

				const scheduleType = this.getScheduleTypeFromMetadata(metadata as Record<string, unknown>) ?? undefined;

				return {
					...allocation,
					student: student ? {
						id: student.student_id,
						fullName: student.full_name,
						age: student.age,
						gender: student.gender,
						address: student.address,
						avatarUrl: student.avatar_url,
						phone: student.phone,
					} : null,
					course: course ? {
						id: course.id,
						title: course.title || null,
						description: course.description || null,
						category: course.category || null,
						price: course.price || null,
						duration: course.duration || null,
					} : null,
					classType,
					scheduleType,
					sessionCount: sessionCount || null,
					additionalStudents: additionalStudents || undefined,
					// Ensure metadata has sessionCount if we found it
					metadata: sessionCount && !metadata.sessionCount 
						? { ...metadata, sessionCount } 
						: metadata,
				};
			} catch (error: any) {
				logger.error('Error enriching trainer allocation', {
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					service: 'allocation-service',
				});
				return {
					...allocation,
					student: null,
					course: null,
					classType: 'N/A',
					scheduleType: undefined,
					sessionCount: null,
				};
			}
		});
	}

	/**
	 * Update allocation
	 */
	async updateAllocation(
		allocationId: string,
		adminId: string,
		updates: UpdateAllocationInput
	): Promise<TrainerAllocationRecord> {
		const allocation = await this.allocationRepo.findById(allocationId);
		if (!allocation) {
			throw new AppError('Allocation not found', 404);
		}

		// Handle payroll sync before update
		if (updates.status) {
			// If changing to cancelled/completed, end payroll allocation
			if ((updates.status === 'cancelled' || updates.status === 'completed') &&
				allocation.trainerId && allocation.studentId &&
				(allocation.status === 'approved' || allocation.status === 'active')) {
				try {
					await this.payrollSyncService.endPayrollAllocation(
						allocation.trainerId,
						allocation.studentId
					);
				} catch (error: any) {
					logger.error('Failed to end payroll allocation (non-critical)', {
						error: error?.message || String(error),
						allocationId: allocation.id,
						service: 'allocation-service',
					});
				}
			}
		}

		const updated = await this.allocationRepo.update(allocationId, updates, adminId);

		if (!updated) {
			throw new AppError('Failed to update allocation', 500);
		}

		// Handle payroll sync after update
		if (updates.status) {
			// If changing to approved/active, sync to payroll
			if ((updates.status === 'approved' || updates.status === 'active') &&
				updated.trainerId && updated.studentId) {
				try {
					await this.payrollSyncService.syncAllocationToPayroll(updated);
				} catch (error: any) {
					logger.error('Failed to sync to payroll (non-critical)', {
					error: error?.message || String(error),
					allocationId: updated.id,
					service: 'allocation-service',
				});
				}
			}
		}

		return updated;
	}

	/**
	 * Get trainer allocations with student details
	 */
	async getTrainerAllocationsWithDetails(
		trainerId: string,
		filters?: {
			status?: AllocationStatus;
			limit?: number;
			offset?: number;
		}
	): Promise<any[]> {
		const allocations = await this.getTrainerAllocations(trainerId, filters);

		// Batch fetch all student profiles in one query (performance optimization)
		const studentIds = [...new Set(allocations.map(a => a.studentId))];
		const courseIds = [...new Set(allocations.map(a => a.courseId).filter(Boolean))];
		
		// Batch fetch students
		const studentsMap = new Map<string, any>();
		if (studentIds.length > 0) {
			try {
				const studentsResult = await this.pool.query<{
						student_id: string;
						full_name: string | null;
						age: number | null;
						gender: string | null;
						address: string | null;
						avatar_url: string | null;
						phone: string | null;
					}>(
						`
							SELECT 
								sp.student_id,
								sp.full_name,
								sp.age,
								sp.gender,
								sp.address,
								sp.avatar_url,
								s.phone
							FROM student_profiles sp
							LEFT JOIN students s ON s.id = sp.student_id
						WHERE sp.student_id = ANY($1::uuid[])
						`,
					[studentIds]
					);

				studentsResult.rows.forEach(row => {
					studentsMap.set(row.student_id, row);
				});
			} catch (error: any) {
				logger.error('Error batch fetching students', {
					error: error.message,
					stack: error.stack,
					studentIds: studentIds.length,
					service: 'allocation-service',
				});
			}
					}

		// Batch fetch courses with full details
		const coursesMap = new Map<string, { 
			id: string; 
			title: string | null;
			description: string | null;
			category: string | null;
			price: number | null;
			duration: number | null;
		}>();
		if (courseIds.length > 0) {
						try {
				const coursesResult = await this.pool.query<{
					id: string;
					title: string | null;
					description: string | null;
					category: string | null;
					price: number | null;
					duration: number | null;
				}>(
					`
						SELECT 
							id, 
							title,
							description,
							category,
							price,
							duration
						FROM courses
						WHERE id = ANY($1::uuid[])
					`,
					[courseIds]
				);

				coursesResult.rows.forEach(row => {
					coursesMap.set(row.id, row);
				});
			} catch (error: any) {
				logger.error('Error batch fetching courses', {
					error: error.message,
					stack: error.stack,
					courseIds: courseIds.length,
					service: 'allocation-service',
				});
						}
					}

		// Batch fetch purchase metadata to get additional students
		const purchaseMetadataMap = new Map<string, any>();
		if (studentIds.length > 0 && courseIds.length > 0) {
			try {
				const purchaseResult = await this.pool.query<{
					student_id: string;
					course_id: string;
					metadata: any;
				}>(
					`SELECT student_id, course_id, metadata
					FROM student_course_purchases
					WHERE student_id = ANY($1::uuid[])
					AND course_id = ANY($2::uuid[])
					AND is_active = true`,
					[studentIds, courseIds]
				);
				purchaseResult.rows.forEach(row => {
					const key = `${row.student_id}-${row.course_id}`;
					purchaseMetadataMap.set(key, row.metadata);
				});
			} catch (error: any) {
				logger.error('Error batch fetching purchase metadata', {
					error: error.message,
					stack: error.stack,
					service: 'allocation-service',
				});
			}
		}

		// Enrich allocations with batched data
		const enriched = allocations.map((allocation) => {
			try {
				const student = studentsMap.get(allocation.studentId) || null;
				const course = allocation.courseId ? (coursesMap.get(allocation.courseId) || { id: allocation.courseId }) : null;

				// Extract class type and session count from metadata
				const metadata = allocation.metadata || {};
				const groupSize = metadata.groupSize as number | undefined;
				const learningMode = metadata.learningMode as string | undefined;
				const sessionCount = metadata.sessionCount as number | undefined;
				
				// Extract additional students from purchase metadata
				let additionalStudents: Array<{ id?: string; name: string; email: string; phone?: string; dateOfBirth?: string; gender?: string }> | undefined = undefined;
				if (allocation.studentId && allocation.courseId) {
					const purchaseKey = `${allocation.studentId}-${allocation.courseId}`;
					const purchaseMetadata = purchaseMetadataMap.get(purchaseKey);
					if (purchaseMetadata && typeof purchaseMetadata === 'object') {
						const purchaseMeta = purchaseMetadata as Record<string, unknown>;
						if (Array.isArray(purchaseMeta.additionalStudents)) {
							additionalStudents = purchaseMeta.additionalStudents as Array<{ id?: string; name: string; email: string; phone?: string; dateOfBirth?: string; gender?: string }>;
						}
					}
				}
				
				// Format class type: "1-on-1", "1-on-2", "1-on-3" + learning mode
				let classType = 'N/A';
				if (groupSize && learningMode) {
					const groupType = groupSize === 1 ? '1-on-1' : `1-on-${groupSize}`;
					const modeDisplay = learningMode === 'home' ? 'Home' : learningMode === 'hybrid' ? 'Hybrid' : learningMode;
					classType = `${groupType} (${modeDisplay})`;
				} else if (groupSize) {
					classType = groupSize === 1 ? '1-on-1' : `1-on-${groupSize}`;
				} else if (learningMode) {
					classType = learningMode === 'home' ? 'Home' : learningMode === 'hybrid' ? 'Hybrid' : learningMode;
				}

				const scheduleType = this.getScheduleTypeFromMetadata(metadata as Record<string, unknown>) ?? undefined;

					return {
						...allocation,
						student: student ? {
							id: student.student_id,
							fullName: student.full_name,
							age: student.age,
							gender: student.gender,
							address: student.address,
							avatarUrl: student.avatar_url,
							phone: student.phone,
						} : null,
						course,
						classType,
						scheduleType,
						sessionCount: sessionCount || null,
						additionalStudents: additionalStudents || undefined,
					};
				} catch (error: any) {
				logger.error('Error enriching allocation', {
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					allocationId: allocation.id,
					service: 'allocation-service',
				});
				logger.error('Error enriching allocation - Allocation ID', {
					allocationId: allocation.id,
					service: 'allocation-service',
				});
					return {
						...allocation,
						student: null,
						course: null,
						classType: 'N/A',
						scheduleType: undefined,
						sessionCount: null,
					};
				}
		});

		return enriched;
	}

	/**
	 * Get student allocations with trainer details
	 * Optimized with batch queries for better performance
	 */
	async getStudentAllocationsWithDetails(
		studentId: string,
		filters?: {
			status?: AllocationStatus;
			limit?: number;
			offset?: number;
		}
	): Promise<any[]> {
		const allocations = await this.getStudentAllocations(studentId, filters);
		// Use the centralized enrichment method to ensure consistency
		return this.enrichAllocationsWithDetails(allocations);
	}

	/**
	 * Cancel allocation
	 */
	async cancelAllocation(allocationId: string, adminId: string): Promise<TrainerAllocationRecord> {
		const allocation = await this.allocationRepo.findById(allocationId);
		if (!allocation) {
			throw new AppError('Allocation not found', 404);
		}

		if (allocation.status === 'cancelled' || allocation.status === 'completed') {
			throw new AppError(`Cannot cancel allocation with status: ${allocation.status}`, 400);
		}

		// End payroll allocation before cancelling
		if (allocation.trainerId && allocation.studentId && 
			(allocation.status === 'approved' || allocation.status === 'active')) {
			try {
				await this.payrollSyncService.endPayrollAllocation(
					allocation.trainerId,
					allocation.studentId
				);
			} catch (error: any) {
				logger.error('Failed to end payroll allocation (non-critical)', {
					error: error?.message || String(error),
					allocationId: allocation.id,
					service: 'allocation-service',
				});
			}
		}

		const updated = await this.allocationRepo.update(
			allocationId,
			{
				status: 'cancelled',
			},
			adminId
		);

		if (!updated) {
			throw new AppError('Failed to cancel allocation', 500);
		}

		// TODO: Send notification to student and trainer

		return updated;
	}

	/**
	 * Helper: Convert TIME format (15:00:00) to display format (3:00 PM)
	 */
	private timeToDisplayFormat(timeStr: string): string {
		// Handle TIME format: "15:00:00" or "15:00" or "3:00 PM"
		// If already in display format, return as-is
		if (timeStr.includes('AM') || timeStr.includes('PM')) {
			return timeStr;
		}
		
		const match = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
		if (!match) {
			logger.warn('Failed to parse time format', {
				timeStr,
				service: 'allocation-service',
			});
			return timeStr;
		}
		
		const hour = parseInt(match[1], 10);
		const minutes = match[2];
		const ampm = hour >= 12 ? 'PM' : 'AM';
		const displayHour = hour % 12 || 12;
		return `${displayHour}:${minutes} ${ampm}`;
	}

	/**
	 * Helper: Convert display format (3:00 PM) to TIME format (15:00:00)
	 */
	private displayFormatToTime(displayStr: string): string | null {
		const normalized = displayStr.trim().toUpperCase();
		const match = normalized.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/);
		if (!match) return null;
		
		let hour = parseInt(match[1], 10);
		const minutes = match[2];
		const period = match[3];
		
		if (period === 'PM' && hour !== 12) {
			hour += 12;
		} else if (period === 'AM' && hour === 12) {
			hour = 0;
		}
		
		return `${hour.toString().padStart(2, '0')}:${minutes}:00`;
	}

	/**
	 * Check if time slot has available trainers
	 * Uses BOTH trainer_profiles.availability.preferredTimeSlots AND trainer_availability table
	 */
	async checkTimeSlotAvailability(
		timeSlot: string,
		date: string,
		courseId?: string
	): Promise<{
		available: boolean;
		availableTrainers: number;
		totalTrainers: number;
		reason?: string;
		suggestedSlots?: string[];
	}> {
		try {
			// Normalize time slot for comparison
			const normalizedTimeSlot = timeSlot.trim().replace(/\s+/g, ' ').toUpperCase();
			
			// Convert display format to TIME format for database query
			const timeSlotInTimeFormat = this.displayFormatToTime(timeSlot);
			
			// Get all approved trainers with their availability from BOTH sources
			const approvedTrainers = await this.pool.query(`
				SELECT 
					t.id, 
					tp.availability,
					COALESCE(
						ARRAY_AGG(
							DISTINCT ta.slot_start::text
						) FILTER (WHERE ta.slot_start IS NOT NULL),
						ARRAY[]::text[]
					) as availability_slots
				FROM trainers t
				LEFT JOIN trainer_profiles tp ON t.id = tp.trainer_id
				LEFT JOIN trainer_availability ta ON t.id = ta.trainer_id
				WHERE t.approval_status = 'approved'
				GROUP BY t.id, tp.availability
			`);

			const totalTrainers = approvedTrainers.rows.length;
			
			// Filter trainers available at this time slot
			// Check BOTH preferredTimeSlots (JSONB) AND trainer_availability table
			const availableTrainers = approvedTrainers.rows.filter((trainer: any) => {
				let hasPreferredSlot = false;
				let hasAvailabilitySlot = false;
				
				// Check preferredTimeSlots from JSONB
				if (trainer.availability && typeof trainer.availability === 'object') {
					const availability = trainer.availability as Record<string, unknown>;
					const preferredSlots = availability.preferredTimeSlots as string[] | undefined;
					
					if (preferredSlots && Array.isArray(preferredSlots) && preferredSlots.length > 0) {
						hasPreferredSlot = preferredSlots.some(slot => 
							slot.trim().replace(/\s+/g, ' ').toUpperCase() === normalizedTimeSlot
						);
					}
				}
				
				// Check trainer_availability table
				if (trainer.availability_slots && Array.isArray(trainer.availability_slots) && trainer.availability_slots.length > 0) {
					if (timeSlotInTimeFormat) {
						// Check if any slot matches the time
						hasAvailabilitySlot = trainer.availability_slots.some((slot: string) => {
							// slot is in TIME format (15:00:00), convert to display format and compare
							const slotDisplay = this.timeToDisplayFormat(slot);
							return slotDisplay.trim().replace(/\s+/g, ' ').toUpperCase() === normalizedTimeSlot;
						});
					}
				}
				
				// Trainer is available if they have the slot in EITHER source
				return hasPreferredSlot || hasAvailabilitySlot;
			});

			// Check which trainers are already allocated at this specific date and time slot
			// This is critical: we need to check per trainer, not just count allocations
			// Check both trainer_allocations and schedule_slots tables
			const allocatedTrainersFromAllocations = await this.pool.query(`
				SELECT DISTINCT trainer_id
				FROM trainer_allocations
				WHERE status IN ('approved', 'active')
					AND metadata IS NOT NULL
					AND metadata->'schedule' IS NOT NULL
					AND (metadata->'schedule'->>'timeSlot')::text = $1
					AND (
						-- Check if start date matches or is before the requested date
						-- If start date is before requested date, assume allocation is ongoing
						(metadata->'schedule'->>'startDate')::date <= $2::date
						OR (metadata->'schedule'->>'startDate') IS NULL
					)
			`, [timeSlot, date]);

			// Also check schedule_slots table if it exists
			let allocatedTrainersFromSlots: any[] = [];
			try {
				const slotsResult = await this.pool.query(`
					SELECT DISTINCT trainer_id
					FROM schedule_slots
					WHERE date = $1::date
						AND timeslot = $2
						AND status IN ('booked', 'blocked')
				`, [date, timeSlotInTimeFormat || timeSlot]);
				allocatedTrainersFromSlots = slotsResult.rows;
			} catch (error: any) {
				// If schedule_slots table doesn't exist, skip this check
				if (error?.code !== '42P01') {
					logger.warn('Error checking schedule_slots', {
						error: error instanceof Error ? error.message : String(error),
						service: 'allocation-service',
					});
				}
			}

			// Combine both sets of allocated trainer IDs
			const allocatedTrainerIds = new Set([
				...allocatedTrainersFromAllocations.rows.map((row: any) => row.trainer_id),
				...allocatedTrainersFromSlots.map((row: any) => row.trainer_id)
			]);

			// Filter out trainers who are already allocated at this date/time
			const trulyAvailableTrainers = availableTrainers.filter((trainer: any) => 
				!allocatedTrainerIds.has(trainer.id)
			);

			// Check if slot is full (assuming max 3-5 students per trainer per time slot)
			// Adjust this based on your business logic
			const maxCapacityPerTrainer = 5;
			const totalCapacity = trulyAvailableTrainers.length * maxCapacityPerTrainer;
			const availableCount = trulyAvailableTrainers.length;
			const isFull = availableCount <= 0;

			// Get suggested alternative time slots
			const allSlots = [
				'4:00 PM', '5:00 PM', '6:00 PM', '7:00 PM', '8:00 PM',
				'9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', 
				'1:00 PM', '2:00 PM', '3:00 PM'
			];
			
			const suggestedSlots = allSlots
				.filter(slot => {
					const normalizedSlot = slot.trim().replace(/\s+/g, ' ').toUpperCase();
					return normalizedSlot !== normalizedTimeSlot;
				})
				.slice(0, 3); // Suggest top 3 alternatives

			return {
				available: !isFull && availableCount > 0 && trulyAvailableTrainers.length > 0,
				availableTrainers: availableCount,
				totalTrainers: totalTrainers,
				reason: isFull 
					? 'This time slot is currently full. Please select another time slot or date.'
					: trulyAvailableTrainers.length === 0
					? 'No trainers available at this time slot for the selected date. Please select another time slot or date.'
					: availableCount <= 0
					? 'This time slot is currently full. Please select another time slot or date.'
					: undefined,
				suggestedSlots: isFull || availableCount <= 0 || trulyAvailableTrainers.length === 0 ? suggestedSlots : undefined,
			};
		} catch (error: any) {
			logger.error('Error checking time slot availability', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				service: 'allocation-service',
			});
			// Return default available if check fails to prevent blocking users
			return {
				available: true,
				availableTrainers: 1,
				totalTrainers: 1,
			};
		}
	}

	/**
	 * Get all available time slots from all approved trainers
	 * Returns a unique list of time slots that have at least one trainer available
	 * Uses BOTH trainer_profiles.availability.preferredTimeSlots AND trainer_availability table
	 */
	async getAllAvailableTimeSlots(courseId?: string): Promise<{
		availableSlots: string[];
		slotDetails: Array<{
			timeSlot: string;
			availableTrainers: number;
		}>;
	}> {
		try {
			// Get all approved trainers with their availability from BOTH sources
			// Use LEFT JOIN for trainer_profiles to include trainers even if they don't have a profile yet
			// Availability can come from either trainer_profiles.availability.preferredTimeSlots OR trainer_availability table
			const approvedTrainers = await this.pool.query(`
				SELECT 
					t.id, 
					tp.availability,
					COALESCE(
						ARRAY_AGG(
							DISTINCT ta.slot_start::text
						) FILTER (WHERE ta.slot_start IS NOT NULL),
						ARRAY[]::text[]
					) as availability_slots
				FROM trainers t
				LEFT JOIN trainer_profiles tp ON t.id = tp.trainer_id
				LEFT JOIN trainer_availability ta ON t.id = ta.trainer_id
				WHERE t.approval_status = 'approved'
				GROUP BY t.id, tp.availability
			`);

			// Aggregate all preferred time slots from all trainers
			// Check BOTH preferredTimeSlots (JSONB) AND trainer_availability table
			const slotCounts: Record<string, number> = {};
			const slotSet = new Set<string>();

			approvedTrainers.rows.forEach((trainer: any) => {
				// Check preferredTimeSlots from JSONB
				if (trainer.availability && typeof trainer.availability === 'object') {
					const availability = trainer.availability as Record<string, unknown>;
					const preferredSlots = availability.preferredTimeSlots as string[] | undefined;

					if (preferredSlots && Array.isArray(preferredSlots) && preferredSlots.length > 0) {
						preferredSlots.forEach((slot: string) => {
							// Normalize slot format
							const normalizedSlot = slot.trim().replace(/\s+/g, ' ');
							slotSet.add(normalizedSlot);
							slotCounts[normalizedSlot] = (slotCounts[normalizedSlot] || 0) + 1;
						});
					}
				}

				// Check trainer_availability table
				if (trainer.availability_slots && Array.isArray(trainer.availability_slots) && trainer.availability_slots.length > 0) {
					trainer.availability_slots.forEach((slot: string) => {
						try {
							// Convert TIME format (15:00:00) to display format (3:00 PM)
							const displaySlot = this.timeToDisplayFormat(slot);
							if (displaySlot && displaySlot.trim()) {
								const normalizedSlot = displaySlot.trim().replace(/\s+/g, ' ');
								slotSet.add(normalizedSlot);
								slotCounts[normalizedSlot] = (slotCounts[normalizedSlot] || 0) + 1;
								logger.debug('Converted slot for trainer', {
									originalSlot: slot,
									normalizedSlot,
									trainerId: trainer.id,
									service: 'allocation-service',
								});
							} else {
								logger.warn('Empty display slot for trainer', {
									slot,
									trainerId: trainer.id,
									service: 'allocation-service',
								});
							}
						} catch (error: any) {
							logger.warn('Failed to convert slot for trainer', {
								slot,
								trainerId: trainer.id,
								error: error.message,
								service: 'allocation-service',
							});
						}
					});
				} else {
					logger.debug('Trainer has no availability_slots in trainer_availability table', {
						trainerId: trainer.id,
						service: 'allocation-service',
					});
				}
			});

			// Log summary for debugging
			logger.info('getAllAvailableTimeSlots result', {
				approvedTrainersCount: approvedTrainers.rows.length,
				uniqueSlotsCount: slotSet.size,
				service: 'allocation-service',
			});
			
			if (approvedTrainers.rows.length > 0 && slotSet.size === 0) {
				logger.warn('Found approved trainers but no available slots', {
					approvedTrainersCount: approvedTrainers.rows.length,
					trainers: approvedTrainers.rows.map((t: any) => ({
						id: t.id,
						hasAvailabilityJSONB: !!t.availability,
						hasAvailabilitySlots: Array.isArray(t.availability_slots) && t.availability_slots.length > 0,
						slotCount: Array.isArray(t.availability_slots) ? t.availability_slots.length : 0,
					})),
				});
			}

			// Convert to array and sort by time
			const availableSlots = Array.from(slotSet).sort((a, b) => {
				// Sort by time (convert to 24-hour format for comparison)
				const timeA = this.parseTimeSlot(a);
				const timeB = this.parseTimeSlot(b);
				return timeA - timeB;
			});

			// Create slot details with trainer counts
			const slotDetails = availableSlots.map(slot => ({
				timeSlot: slot,
				availableTrainers: slotCounts[slot] || 0,
			}));

			return {
				availableSlots,
				slotDetails,
			};
		} catch (error: any) {
			logger.error('Error getting all available time slots', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				service: 'allocation-service',
			});
			// Return empty array on error (strict mode - don't show slots if we can't verify)
			return {
				availableSlots: [],
				slotDetails: [],
			};
		}
	}

	/**
	 * Helper method to parse time slot to 24-hour format for sorting
	 */
	private parseTimeSlot(slot: string): number {
		const normalized = slot.trim().toUpperCase();
		const match = normalized.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/);
		if (!match) return 0;

		let hours = parseInt(match[1], 10);
		const minutes = parseInt(match[2], 10);
		const period = match[3];

		if (period === 'PM' && hours !== 12) {
			hours += 12;
		} else if (period === 'AM' && hours === 12) {
			hours = 0;
		}

		return hours * 60 + minutes; // Return minutes since midnight for easy comparison
	}

	/**
	 * Check if a specific trainer is available for upgrade sessions
	 * Used to check if existing trainer can accommodate new sessions
	 */
	async checkTrainerAvailabilityForUpgrade(
		trainerId: string,
		timeSlot: string,
		startDate: string,
		additionalSessions: number,
		scheduleMode: 'everyday' | 'sunday' = 'everyday',
		studentId?: string
	): Promise<{
		available: boolean;
		conflicts: string[];
		endDate: string;
	}> {
		try {
			const start = new Date(startDate);
			start.setHours(0, 0, 0, 0);
			
			// Calculate end date based on schedule mode
			let endDate: Date;
			if (scheduleMode === 'sunday') {
				// Sunday-only: (additionalSessions - 1) weeks after start
				endDate = new Date(start);
				const weeksToAdd = additionalSessions - 1;
				endDate.setDate(endDate.getDate() + (weeksToAdd * 7));
			} else {
				// Everyday: (additionalSessions - 1) days after start
				endDate = new Date(start);
				endDate.setDate(endDate.getDate() + (additionalSessions - 1));
			}
			endDate.setHours(23, 59, 59, 999);

			const conflicts: string[] = [];

			// Check for conflicts in schedule_slots table (may not exist in all databases)
			try {
				const conflictCheck = await this.pool.query<{ count: number }>(
					`SELECT COUNT(*)::int AS count
					FROM schedule_slots
					WHERE trainer_id = $1
						AND timeslot = $2
						AND date >= $3
						AND date <= $4
						AND status IN ('booked', 'blocked')`,
					[trainerId, timeSlot, start, endDate]
				);

				if (conflictCheck.rows[0]?.count > 0) {
					conflicts.push('Trainer has booked/blocked slots during this period');
				}
			} catch (error: any) {
				// If schedule_slots table doesn't exist, skip this check
				if (error?.code === '42P01') {
					logger.debug('Check Availability: schedule_slots table not found, skipping schedule slot conflict check', {
						service: 'allocation-service',
					});
				} else {
					throw error;
				}
			}

			// Check for conflicts with other active allocations (excluding current student if provided)
			if (studentId) {
				const allocationConflictCheck = await this.pool.query<{ count: number }>(
					`SELECT COUNT(*)::int AS count
					FROM trainer_allocations ta
					INNER JOIN tutoring_sessions ts ON ta.id = ts.allocation_id
					WHERE ta.trainer_id = $1
						AND ta.student_id != $2
						AND ta.status IN ('approved', 'active')
						AND ts.scheduled_time = $3
						AND ts.scheduled_date >= $4
						AND ts.scheduled_date <= $5
						AND ts.status NOT IN ('cancelled', 'completed')`,
					[trainerId, studentId, timeSlot, start, endDate]
				);

				if (allocationConflictCheck.rows[0]?.count > 0) {
					conflicts.push('Trainer has another student scheduled for this time slot');
				}
			}

			return {
				available: conflicts.length === 0,
				conflicts,
				endDate: endDate.toISOString().split('T')[0],
			};
		} catch (error: any) {
			logger.error('Error checking trainer availability for upgrade', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				trainerId,
				service: 'allocation-service',
			});
			// On error, assume available but log warning
			return {
				available: true,
				conflicts: [],
				endDate: startDate,
			};
		}
	}

	/**
	 * Get trainer available time slots and dates for upgrade
	 * Returns available time slots and date ranges for the trainer
	 */
	async getTrainerAvailableSlotsForUpgrade(
		trainerId: string,
		startDate: string,
		additionalSessions: number,
		scheduleMode: 'everyday' | 'sunday' = 'everyday',
		studentId?: string
	): Promise<{
		availableTimeSlots: Array<{
			timeSlot: string;
			available: boolean;
			conflicts: string[];
			availableDates: string[]; // Dates when this time slot is available
		}>;
		recommendedSlots: string[]; // Time slots with most availability
	}> {
		try {
			const start = new Date(startDate);
			start.setHours(0, 0, 0, 0);
			
			// Calculate end date based on schedule mode
			let endDate: Date;
			if (scheduleMode === 'sunday') {
				endDate = new Date(start);
				const weeksToAdd = additionalSessions - 1;
				endDate.setDate(endDate.getDate() + (weeksToAdd * 7));
			} else {
				endDate = new Date(start);
				endDate.setDate(endDate.getDate() + (additionalSessions - 1));
			}
			endDate.setHours(23, 59, 59, 999);

			// Common time slots to check
			const timeSlotsToCheck = ['4:00 PM', '5:00 PM', '6:00 PM', '7:00 PM', '8:00 PM'];
			
			const availableTimeSlots = [];
			const slotAvailabilityCount: Record<string, number> = {};

			for (const timeSlot of timeSlotsToCheck) {
				const conflicts: string[] = [];
				const availableDates: string[] = [];
				
				// Check for conflicts in schedule_slots table
				try {
					const conflictCheck = await this.pool.query<{ date: Date; count: number }>(
						`SELECT date, COUNT(*)::int AS count
						FROM schedule_slots
						WHERE trainer_id = $1
							AND timeslot = $2
							AND date >= $3
							AND date <= $4
							AND status IN ('booked', 'blocked')
						GROUP BY date`,
						[trainerId, timeSlot, start, endDate]
					);

					const conflictDates = new Set(
						conflictCheck.rows.map(row => row.date.toISOString().split('T')[0])
					);

					// Check for allocation conflicts
					const allocationConflictCheck = await this.pool.query<{ scheduled_date: Date }>(
						`SELECT DISTINCT ts.scheduled_date
						FROM trainer_allocations ta
						INNER JOIN tutoring_sessions ts ON ta.id = ts.allocation_id
						WHERE ta.trainer_id = $1
							${studentId ? 'AND ta.student_id != $5' : ''}
							AND ta.status IN ('approved', 'active')
							AND ts.scheduled_time = $2
							AND ts.scheduled_date >= $3
							AND ts.scheduled_date <= $4
							AND ts.status NOT IN ('cancelled', 'completed')`,
						studentId 
							? [trainerId, timeSlot, start, endDate, studentId]
							: [trainerId, timeSlot, start, endDate]
					);

					allocationConflictCheck.rows.forEach(row => {
						const conflictDate = row.scheduled_date.toISOString().split('T')[0];
						conflictDates.add(conflictDate);
					});

					// Generate all dates in range
					const currentDate = new Date(start);
					while (currentDate <= endDate) {
						const dateStr = currentDate.toISOString().split('T')[0];
						
						// For Sunday-only mode, only check Sundays
						if (scheduleMode === 'sunday' && currentDate.getDay() !== 0) {
							currentDate.setDate(currentDate.getDate() + 1);
							continue;
						}
						
						if (!conflictDates.has(dateStr)) {
							availableDates.push(dateStr);
						} else {
							conflicts.push(`Conflict on ${dateStr}`);
						}
						
						if (scheduleMode === 'sunday') {
							currentDate.setDate(currentDate.getDate() + 7);
						} else {
							currentDate.setDate(currentDate.getDate() + 1);
						}
					}

					const available = availableDates.length >= additionalSessions;
					slotAvailabilityCount[timeSlot] = availableDates.length;
					
					availableTimeSlots.push({
						timeSlot,
						available,
						conflicts: available ? [] : conflicts.slice(0, 3), // Show first 3 conflicts
						availableDates: availableDates.slice(0, 20), // Limit to first 20 dates
					});
				} catch (error: any) {
					// If schedule_slots table doesn't exist, skip that check
					if (error?.code !== '42P01') {
						throw error;
					}
					
					// Only check allocation conflicts
					const allocationConflictCheck = await this.pool.query<{ scheduled_date: Date }>(
						`SELECT DISTINCT ts.scheduled_date
						FROM trainer_allocations ta
						INNER JOIN tutoring_sessions ts ON ta.id = ts.allocation_id
						WHERE ta.trainer_id = $1
							${studentId ? 'AND ta.student_id != $5' : ''}
							AND ta.status IN ('approved', 'active')
							AND ts.scheduled_time = $2
							AND ts.scheduled_date >= $3
							AND ts.scheduled_date <= $4
							AND ts.status NOT IN ('cancelled', 'completed')`,
						studentId 
							? [trainerId, timeSlot, start, endDate, studentId]
							: [trainerId, timeSlot, start, endDate]
					);

					const conflictDates = new Set(
						allocationConflictCheck.rows.map(row => row.scheduled_date.toISOString().split('T')[0])
					);

					// Generate all dates in range
					const currentDate = new Date(start);
					while (currentDate <= endDate) {
						const dateStr = currentDate.toISOString().split('T')[0];
						
						if (scheduleMode === 'sunday' && currentDate.getDay() !== 0) {
							currentDate.setDate(currentDate.getDate() + 1);
							continue;
						}
						
						if (!conflictDates.has(dateStr)) {
							availableDates.push(dateStr);
						} else {
							conflicts.push(`Conflict on ${dateStr}`);
						}
						
						if (scheduleMode === 'sunday') {
							currentDate.setDate(currentDate.getDate() + 7);
						} else {
							currentDate.setDate(currentDate.getDate() + 1);
						}
					}

					const available = availableDates.length >= additionalSessions;
					slotAvailabilityCount[timeSlot] = availableDates.length;
					
					availableTimeSlots.push({
						timeSlot,
						available,
						conflicts: available ? [] : conflicts.slice(0, 3),
						availableDates: availableDates.slice(0, 20),
					});
				}
			}

			// Sort by availability count (most available first)
			const recommendedSlots = Object.entries(slotAvailabilityCount)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 3)
				.map(([slot]) => slot);

			return {
				availableTimeSlots,
				recommendedSlots,
			};
		} catch (error: any) {
			logger.error('Error getting trainer available slots for upgrade', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				trainerId,
				service: 'allocation-service',
			});
			return {
				availableTimeSlots: [],
				recommendedSlots: [],
			};
		}
	}

	/**
	 * Get system admin UUID for automated operations
	 * Falls back to a default system UUID if admin not found
	 */
	private async getSystemAdminId(): Promise<string> {
		try {
			const pool = this.allocationRepo.getPool();
			// Try to get admin from seed email first, then any active admin
			const seedEmail = process.env.ADMIN_SEED_EMAIL?.toLowerCase();
			let result;
			
			if (seedEmail) {
				result = await pool.query<{ id: string }>(
					`SELECT id FROM admin_users WHERE email = $1 AND status = 'active' LIMIT 1`,
					[seedEmail]
				);
			}
			
			// If not found, get any active admin
			if (!result || result.rows.length === 0) {
				result = await pool.query<{ id: string }>(
					`SELECT id FROM admin_users WHERE status = 'active' LIMIT 1`
				);
			}
			
			if (result.rows.length > 0) {
				return result.rows[0].id;
			}
			
			// Fallback: Use a consistent system UUID (00000000-0000-0000-0000-000000000001)
			// This is a special UUID reserved for system operations
			return '00000000-0000-0000-0000-000000000001';
		} catch (error) {
			// If query fails, use fallback UUID
			return '00000000-0000-0000-0000-000000000001';
		}
	}

	async autoAssignTrainerAfterPurchase(
		studentId: string,
		courseId: string,
		timeSlot: string,
		date: string,
		requestedBy: string = studentId,
		paymentMetadata?: Record<string, unknown>
	): Promise<TrainerAllocationRecord> {
		try {
			// Check if this is an upgrade by checking payment metadata
			const isUpgrade = paymentMetadata?.upgrade === true || paymentMetadata?.upgrade === 'true';
			
			// If it's an upgrade, check for existing approved/active allocation
			if (isUpgrade) {
				logger.info('Auto Assignment: Upgrade detected, checking for existing allocation', {
					studentId,
					courseId,
					service: 'allocation-service',
				});
				
				// Query directly for approved or active allocations (repository doesn't support array status)
				const existingAllocationResult = await this.pool.query<{
					id: string;
					student_id: string;
					trainer_id: string | null;
					course_id: string | null;
					requested_by: string;
					requested_at: Date | null;
					status: string;
					allocated_by: string | null;
					allocated_at: Date | null;
					rejected_by: string | null;
					rejected_at: Date | null;
					rejection_reason: string | null;
					notes: string | null;
					metadata: any;
					created_at: Date;
					updated_at: Date;
				}>(
					`SELECT * FROM trainer_allocations 
					WHERE student_id = $1 
						AND (course_id = $2 OR (course_id IS NULL AND $2 IS NULL))
						AND status IN ('approved', 'active')
					ORDER BY updated_at DESC
					LIMIT 1`,
					[studentId, courseId]
				);
				
				const existingAllocation = existingAllocationResult.rows.map(row => ({
					id: row.id,
					studentId: row.student_id,
					trainerId: row.trainer_id,
					courseId: row.course_id,
					requestedBy: row.requested_by,
					requestedAt: row.requested_at || new Date(),
					status: row.status as AllocationStatus,
					allocatedBy: row.allocated_by,
					allocatedAt: row.allocated_at,
					rejectedBy: row.rejected_by,
					rejectedAt: row.rejected_at,
					rejectionReason: row.rejection_reason,
					notes: row.notes,
					metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
					createdAt: row.created_at,
					updatedAt: row.updated_at,
				})) as TrainerAllocationRecord[];

				if (existingAllocation.length > 0) {
					const allocation = existingAllocation[0];
					const existingTrainerId = allocation.trainerId;
					logger.info('Auto Assignment: Found existing allocation for upgrade', {
						allocationId: allocation.id,
						existingTrainerId,
						studentId,
						courseId,
						service: 'allocation-service',
					});
					
					// Get session count from purchase record
					let additionalSessions = 10; // Default additional sessions
					try {
						const courseServiceUrl = process.env.COURSE_SERVICE_URL ||
							`http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.COURSE_SERVICE_PORT || 3005}`;

						const axios = (await import('axios')).default;
						const purchaseUrl = `${courseServiceUrl}/api/v1/students/${studentId}/courses/${courseId}/purchase`;

						const purchaseResponse = await axios.get(purchaseUrl, { timeout: 10000 });

						if (purchaseResponse.status === 200 && purchaseResponse.data?.data) {
							const purchase = purchaseResponse.data.data;
							const newTier = purchase.purchaseTier || 30;
							
							// Get additional sessions directly from payment metadata (most reliable)
							// This is set when the user selects how many sessions to add
							let previousTier = 10; // Default
							
							if (paymentMetadata?.additionalSessions && typeof paymentMetadata.additionalSessions === 'number') {
								additionalSessions = paymentMetadata.additionalSessions as number;
								logger.info('Auto Assignment: Using additionalSessions from payment metadata', {
									additionalSessions,
									studentId,
									courseId,
									service: 'allocation-service',
								});
							} else {
								// Fallback: Calculate from tiers
								// Get previous tier from payment metadata (set during upgrade payment)
								// If not in metadata, try to get from existing purchase metadata
								previousTier = (paymentMetadata?.previousPurchaseTier as number) || 0;
								
								if (!previousTier && purchase.metadata && typeof purchase.metadata === 'object') {
									const purchaseMeta = purchase.metadata as Record<string, unknown>;
									previousTier = (purchaseMeta.previousPurchaseTier as number) || 
										(purchaseMeta.purchaseTier as number) || 0;
								}
								
								// If still no previous tier, try to get from allocation metadata
								if (!previousTier && allocation.metadata && typeof allocation.metadata === 'object') {
									const allocMeta = allocation.metadata as Record<string, unknown>;
									const existingSessionCount = allocMeta.sessionCount as number;
									if (existingSessionCount) {
										previousTier = existingSessionCount;
									}
								}
								
								// Fallback: calculate from existing sessions
								if (!previousTier) {
									const existingSessionsResult = await this.pool.query(
										`SELECT COUNT(*) as count FROM tutoring_sessions WHERE allocation_id = $1`,
										[allocation.id]
									);
									const existingCount = parseInt(existingSessionsResult.rows[0]?.count || '0');
									if (existingCount > 0) {
										previousTier = existingCount;
									}
								}
								
								// Default to 10 if still no previous tier found
								previousTier = previousTier || 10;
								
								additionalSessions = newTier - previousTier;
							}
							logger.info('Auto Assignment: Upgrade tier change', {
								previousTier,
								newTier,
								additionalSessions,
								studentId,
								courseId,
								service: 'allocation-service',
							});
						}
					} catch (error: any) {
						logger.warn('Auto Assignment: Could not fetch purchase record for upgrade, using default', {
							error: error?.message || String(error),
							studentId,
							courseId,
							service: 'allocation-service',
						});
					}

					// Calculate start date and date range for availability check
					const lastSessionCheck = await this.pool.query<{
						scheduled_date: Date;
					}>(
						`SELECT scheduled_date 
						FROM tutoring_sessions 
						WHERE allocation_id = $1 
						ORDER BY scheduled_date DESC 
						LIMIT 1`,
						[allocation.id]
					);

					let startDateForCheck: Date;
					if (paymentMetadata?.startDate || paymentMetadata?.date || paymentMetadata?.preferredDate) {
						const dateStr = (paymentMetadata.startDate as string) ||
							(paymentMetadata.date as string) ||
							(paymentMetadata.preferredDate as string) ||
							'';
						
						// Parse date correctly to avoid timezone issues
						let parsedDateStr: string;
						if (dateStr.includes('T')) {
							// ISO format with time - extract just the date part (YYYY-MM-DD)
							parsedDateStr = dateStr.split('T')[0];
						} else {
							// Date-only format
							parsedDateStr = dateStr;
						}
						
						// Parse date components and create local date (no timezone conversion)
						const dateParts = parsedDateStr.split(/[-/]/);
						if (dateParts.length === 3) {
							// Create date in local timezone (month is 0-indexed)
							startDateForCheck = new Date(
								parseInt(dateParts[0], 10), // year
								parseInt(dateParts[1], 10) - 1, // month (0-indexed)
								parseInt(dateParts[2], 10) // day
							);
						} else {
							// Fallback if parsing fails
							if (lastSessionCheck.rows.length > 0) {
								startDateForCheck = new Date(lastSessionCheck.rows[0].scheduled_date);
								startDateForCheck.setDate(startDateForCheck.getDate() + 1);
							} else {
								startDateForCheck = new Date();
								startDateForCheck.setDate(startDateForCheck.getDate() + 1);
							}
						}
					} else if (lastSessionCheck.rows.length > 0) {
						startDateForCheck = new Date(lastSessionCheck.rows[0].scheduled_date);
						startDateForCheck.setDate(startDateForCheck.getDate() + 1);
					} else {
						startDateForCheck = new Date();
						startDateForCheck.setDate(startDateForCheck.getDate() + 1);
					}
					startDateForCheck.setHours(0, 0, 0, 0);

					// Get metadata to check schedule mode
					const metadata = allocation.metadata && typeof allocation.metadata === 'object' 
						? allocation.metadata as Record<string, unknown> 
						: {};
					const isSundayOnly = (metadata.isSundayOnly as boolean) || false;
					
					// Calculate end date based on schedule mode
					let endDateForCheck: Date;
					if (isSundayOnly) {
						// Sunday-only: (additionalSessions - 1) weeks after start
						endDateForCheck = new Date(startDateForCheck);
						const weeksToAdd = additionalSessions - 1;
						endDateForCheck.setDate(endDateForCheck.getDate() + (weeksToAdd * 7));
					} else {
						// Everyday: (additionalSessions - 1) days after start
						endDateForCheck = new Date(startDateForCheck);
						endDateForCheck.setDate(endDateForCheck.getDate() + (additionalSessions - 1));
					}

					// Check if existing trainer is available for the new time slot and date range
					let trainerAvailable = false;
					let trainerChanged = false;
					let newTrainerId: string | null = null;
					let availabilityConflicts: string[] = [];

					if (existingTrainerId) {
						logger.debug('Auto Assignment: Checking availability of existing trainer', {
							existingTrainerId,
							timeSlot,
							startDate: startDateForCheck.toISOString().split('T')[0],
							endDate: endDateForCheck.toISOString().split('T')[0],
							service: 'allocation-service',
						});
						
						// Check for conflicts in schedule_slots table (may not exist in all databases)
						let hasScheduleSlotConflicts = false;
						try {
							const conflictCheck = await this.pool.query<{ count: number }>(
								`SELECT COUNT(*)::int AS count
								FROM schedule_slots
								WHERE trainer_id = $1
									AND timeslot = $2
									AND date >= $3
									AND date <= $4
									AND status IN ('booked', 'blocked')`,
								[existingTrainerId, timeSlot, startDateForCheck, endDateForCheck]
							);
							hasScheduleSlotConflicts = (conflictCheck.rows[0]?.count || 0) > 0;
						} catch (error: any) {
							// If schedule_slots table doesn't exist, skip this check
							if (error?.code === '42P01') {
								logger.debug('Auto Assignment: schedule_slots table not found, skipping schedule slot conflict check', {
									service: 'allocation-service',
								});
							} else {
								throw error;
							}
						}

						// Also check for conflicts with other active allocations (excluding current student)
						const allocationConflictCheck = await this.pool.query<{ count: number }>(
							`SELECT COUNT(*)::int AS count
							FROM trainer_allocations ta
							INNER JOIN tutoring_sessions ts ON ta.id = ts.allocation_id
							WHERE ta.trainer_id = $1
								AND ta.student_id != $2
								AND ta.status IN ('approved', 'active')
								AND ts.scheduled_time = $3
								AND ts.scheduled_date >= $4
								AND ts.scheduled_date <= $5
								AND ts.status NOT IN ('cancelled', 'completed')`,
							[existingTrainerId, studentId, timeSlot, startDateForCheck, endDateForCheck]
						);

						const hasAllocationConflicts = (allocationConflictCheck.rows[0]?.count || 0) > 0;

						if (hasScheduleSlotConflicts || hasAllocationConflicts) {
							logger.warn('Auto Assignment: Existing trainer is NOT available', {
								existingTrainerId,
								hasScheduleSlotConflicts,
								hasAllocationConflicts,
								service: 'allocation-service',
							});
							trainerAvailable = false;
							if (hasScheduleSlotConflicts) {
								availabilityConflicts.push('Trainer has booked/blocked slots during this period');
							}
							if (hasAllocationConflicts) {
								availabilityConflicts.push('Trainer has another student scheduled for this time slot');
							}
						} else {
							logger.info('Auto Assignment: Existing trainer is available for new sessions', {
								existingTrainerId,
								service: 'allocation-service',
							});
							trainerAvailable = true;
						}
					}

					// If existing trainer is not available, find an alternative trainer
					if (!trainerAvailable && existingTrainerId) {
						logger.info('Auto Assignment: Searching for alternative trainer', {
							service: 'allocation-service',
						});
						
						// Get student profile (gender and location)
						const studentProfile = await this.pool.query<{
							student_id: string;
							gender: string | null;
							latitude: number | null;
							longitude: number | null;
						}>(`
							SELECT student_id, gender, latitude, longitude
							FROM student_profiles 
							WHERE student_id = $1
						`, [studentId]);

						const studentGender = studentProfile.rows[0]?.gender?.toLowerCase() || null;
						const studentLatitude = studentProfile.rows[0]?.latitude;
						const studentLongitude = studentProfile.rows[0]?.longitude;
						
						if (!studentLatitude || !studentLongitude) {
							logger.warn('Auto Assignment: Student does not have GPS coordinates, distance checks will be skipped', {
								studentId,
								service: 'allocation-service',
							});
						}

						// Get course details for expertise matching
						const courseDetails = await this.pool.query<{
							id: string;
							category: string | null;
							subcategory: string | null;
						}>(`
							SELECT id, category, subcategory
							FROM courses
							WHERE id = $1
						`, [courseId]);

						// Map course category to trainer course names (handle variations)
						const rawCategory = courseDetails.rows[0]?.category || null;
						const normalizeCourseName = (category: string | null): string | null => {
							if (!category) return null;
							const normalized = category.trim();
							// Map variations to trainer course names
							if (normalized.toLowerCase().includes('app') && (normalized.toLowerCase().includes('making') || normalized.toLowerCase().includes('development'))) {
								return 'App Making';
							}
							if (normalized.toLowerCase().includes('video') && (normalized.toLowerCase().includes('making') || normalized.toLowerCase().includes('editing'))) {
								return 'Video Making';
							}
							// Direct matches: AI, Robotics, Coding
							if (['AI', 'Robotics', 'Coding'].includes(normalized)) {
								return normalized;
							}
							// Return as-is for other cases
							return normalized;
						};
						const courseCategory = normalizeCourseName(rawCategory);
						const courseSubcategory = courseDetails.rows[0]?.subcategory || null;

						// Helper function to parse time slot to 24-hour format (e.g., "4:00 PM" -> 16:00)
						const parseTimeSlotTo24Hour = (slot: string): string | null => {
							const normalized = slot.trim().toUpperCase();
							
							// Handle AM/PM format (e.g., "4:00 PM")
							const ampmMatch = normalized.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/);
							if (ampmMatch) {
								let hour = parseInt(ampmMatch[1], 10);
								const minutes = ampmMatch[2];
								const ampm = ampmMatch[3];
								
								if (ampm === 'PM' && hour !== 12) hour += 12;
								if (ampm === 'AM' && hour === 12) hour = 0;
								
								return `${String(hour).padStart(2, '0')}:${minutes}`;
							}
							
							// Handle 24-hour format (e.g., "16:00")
							const hour24Match = normalized.match(/(\d{1,2}):(\d{2})/);
							if (hour24Match) {
								const hour = parseInt(hour24Match[1], 10);
								const minutes = hour24Match[2];
								if (hour >= 0 && hour < 24) {
									return `${String(hour).padStart(2, '0')}:${minutes}`;
								}
							}
							
							return null;
						};

						// Helper function to convert 24-hour to AM/PM format for database query matching
						const hour24ToAmPm = (hour24: string): string | null => {
							const [hourStr, minutes] = hour24.split(':');
							const hour = parseInt(hourStr, 10);
							if (isNaN(hour) || hour < 0 || hour >= 24) return null;
							
							const ampm = hour >= 12 ? 'PM' : 'AM';
							const displayHour = hour % 12 || 12;
							return `${displayHour}:${minutes} ${ampm}`;
						};

						// Get current time slot in 24-hour format
						const currentHour24 = parseTimeSlotTo24Hour(timeSlot);
						let previousHour24: string | null = null;
						let nextHour24: string | null = null;
						let previousHourAmPm: string | null = null;
						let nextHourAmPm: string | null = null;

						if (currentHour24) {
							const [hourStr] = currentHour24.split(':');
							const hour = parseInt(hourStr, 10);
							
							// Previous hour
							if (hour > 0) {
								previousHour24 = `${String(hour - 1).padStart(2, '0')}:00`;
								previousHourAmPm = hour24ToAmPm(previousHour24);
							}
							
							// Next hour
							if (hour < 23) {
								nextHour24 = `${String(hour + 1).padStart(2, '0')}:00`;
								nextHourAmPm = hour24ToAmPm(nextHour24);
							}
						}

						// Find available trainers (excluding the existing trainer)
						// Include trainer location for distance calculations
						const normalizedTimeSlot = timeSlot.trim().replace(/\s+/g, ' ').toUpperCase();
						
						// Convert time slot to TIME format for checking trainer_availability table
						const timeSlotMatch = normalizedTimeSlot.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/);
						let timeSlotInTimeFormatForUpgrade: string | null = null;
						if (timeSlotMatch) {
							let hour = parseInt(timeSlotMatch[1], 10);
							const minutes = timeSlotMatch[2];
							const period = timeSlotMatch[3];
							
							if (period === 'PM' && hour !== 12) {
								hour += 12;
							} else if (period === 'AM' && hour === 12) {
								hour = 0;
							}
							
							timeSlotInTimeFormatForUpgrade = `${hour.toString().padStart(2, '0')}:${minutes}:00`;
						}
						
						const alternativeTrainers = await this.pool.query<{
							trainer_id: string;
							gender: string | null;
							current_load: number;
							specialties: string[] | null;
							availability: any;
							years_of_experience: number | null;
							latitude: number | null;
							longitude: number | null;
						}>(`
							SELECT 
								t.id as trainer_id,
								tp.gender,
								tp.availability,
								tp.specialties,
								tp.years_of_experience,
								tl.latitude,
								tl.longitude,
								(
									SELECT COUNT(*) 
									FROM trainer_allocations ta
									WHERE ta.trainer_id = t.id 
										AND ta.status IN ('approved', 'active')
										AND ta.metadata IS NOT NULL
										AND ta.metadata->'schedule'->>'timeSlot' = $1
								) as current_load
							FROM trainers t
							INNER JOIN trainer_profiles tp ON t.id = tp.trainer_id
							LEFT JOIN trainer_locations tl ON t.id = tl.trainer_id
							LEFT JOIN trainer_availability tav ON t.id = tav.trainer_id
							WHERE t.approval_status = 'approved'
								AND t.id != $6
								AND (
									-- Gender matching
									tp.gender IS NULL 
									OR $2::text IS NULL 
									OR LOWER(tp.gender) = LOWER($2::text)
								)
								AND (
									-- CRITICAL FIX: Check time slot availability from BOTH sources
									-- Must have availability in EITHER preferredTimeSlots (JSONB) OR trainer_availability table
									-- Do NOT include trainers with NULL availability (this was the bug!)
									(
										-- Check JSONB preferredTimeSlots (handles "7:00 AM - 8:00 AM" format by matching start)
										tp.availability IS NOT NULL 
										AND tp.availability->'preferredTimeSlots' IS NOT NULL
										AND (
											SELECT COUNT(*) 
											FROM jsonb_array_elements_text(tp.availability->'preferredTimeSlots') AS slot
											WHERE UPPER(TRIM(REPLACE(slot, ' ', ' '))) = $3
											-- Also match if slot starts with the requested time (e.g., "7:00 AM - 8:00 AM" matches "7:00 AM")
											OR UPPER(TRIM(REPLACE(slot, ' ', ' '))) LIKE $3 || '%'
										) > 0
									)
									OR (
										-- Check trainer_availability table (TIME format: 07:00:00)
										$7::time IS NOT NULL
										AND tav.slot_start = $7::time
									)
								)
								AND (
									-- Filter by course specialty (CRITICAL: Must match course)
									($4::text IS NULL AND $5::text IS NULL)
									OR (
										tp.specialties IS NOT NULL 
										AND (
											$4::text IS NOT NULL AND EXISTS (
												SELECT 1 FROM unnest(tp.specialties) AS specialty
												WHERE LOWER(TRIM(specialty)) = LOWER(TRIM($4::text))
											)
											OR $5::text IS NOT NULL AND EXISTS (
												SELECT 1 FROM unnest(tp.specialties) AS specialty
												WHERE LOWER(TRIM(specialty)) = LOWER(TRIM($5::text))
											)
										)
									)
								)
							GROUP BY t.id, tp.gender, tp.availability, tp.specialties, tp.years_of_experience, tl.latitude, tl.longitude
							HAVING (
								-- Ensure trainer has availability in at least one source
								(
									tp.availability IS NOT NULL 
									AND tp.availability->'preferredTimeSlots' IS NOT NULL
									AND (
										SELECT COUNT(*) 
										FROM jsonb_array_elements_text(tp.availability->'preferredTimeSlots') AS slot
										WHERE UPPER(TRIM(REPLACE(slot, ' ', ' '))) = $3
										OR UPPER(TRIM(REPLACE(slot, ' ', ' '))) LIKE $3 || '%'
									) > 0
								)
								OR (
									$7::time IS NOT NULL
									AND COUNT(DISTINCT tav.slot_start) FILTER (WHERE tav.slot_start = $7::time) > 0
								)
							)
							ORDER BY 
								-- Prioritize trainers with exact course category match
								CASE 
									WHEN $4::text IS NOT NULL AND tp.specialties IS NOT NULL 
										AND EXISTS (
											SELECT 1 FROM unnest(tp.specialties) AS specialty
											WHERE LOWER(TRIM(specialty)) = LOWER(TRIM($4::text))
										)
									THEN 1 
									WHEN $5::text IS NOT NULL AND tp.specialties IS NOT NULL 
										AND EXISTS (
											SELECT 1 FROM unnest(tp.specialties) AS specialty
											WHERE LOWER(TRIM(specialty)) = LOWER(TRIM($5::text))
										)
									THEN 2
									ELSE 3
								END,
								current_load ASC,
								tp.years_of_experience DESC NULLS LAST
							LIMIT 20
						`, [timeSlot, studentGender, normalizedTimeSlot, courseCategory, courseSubcategory, existingTrainerId, timeSlotInTimeFormatForUpgrade]);

						// Distance calculation function using Haversine formula
						const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
							const R = 6371; // Earth's radius in kilometers
							const dLat = (lat2 - lat1) * (Math.PI / 180);
							const dLon = (lon2 - lon1) * (Math.PI / 180);
							const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
								Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
								Math.sin(dLon / 2) * Math.sin(dLon / 2);
							const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
							return R * c;
						};
						
						// Maximum distance for sequential time slots (configurable via env)
						const MAX_SEQUENTIAL_DISTANCE_KM = parseInt(
							process.env.MAX_SEQUENTIAL_DISTANCE_KM || '5',
							10
						);
						
						// Check each alternative trainer for conflicts and distance constraints
						for (const altTrainer of alternativeTrainers.rows) {
							// 1. Check for schedule slot conflicts (may not exist in all databases)
							let hasAltScheduleConflicts = false;
							try {
								const altConflictCheck = await this.pool.query<{ count: number }>(
									`SELECT COUNT(*)::int AS count
									FROM schedule_slots
									WHERE trainer_id = $1
										AND timeslot = $2
										AND date >= $3
										AND date <= $4
										AND status IN ('booked', 'blocked')`,
									[altTrainer.trainer_id, timeSlot, startDateForCheck, endDateForCheck]
								);
								hasAltScheduleConflicts = (altConflictCheck.rows[0]?.count || 0) > 0;
							} catch (error: any) {
								// If schedule_slots table doesn't exist, skip this check
								if (error?.code === '42P01') {
									logger.debug('Auto Assignment: schedule_slots table not found, skipping schedule slot conflict check for alternative trainer', {
										service: 'allocation-service',
									});
								} else {
									throw error;
								}
							}

							// 2. Check for allocation conflicts (same time slot, different student)
							const altAllocationConflictCheck = await this.pool.query<{ count: number }>(
								`SELECT COUNT(*)::int AS count
								FROM trainer_allocations ta
								INNER JOIN tutoring_sessions ts ON ta.id = ts.allocation_id
								WHERE ta.trainer_id = $1
									AND ta.student_id != $2
									AND ta.status IN ('approved', 'active')
									AND ts.scheduled_time = $3
									AND ts.scheduled_date >= $4
									AND ts.scheduled_date <= $5
									AND ts.status NOT IN ('cancelled', 'completed')`,
								[altTrainer.trainer_id, studentId, timeSlot, startDateForCheck, endDateForCheck]
							);

							const hasAltConflicts = hasAltScheduleConflicts || (altAllocationConflictCheck.rows[0]?.count || 0) > 0;

							if (hasAltConflicts) {
								continue; // Skip this trainer, has conflicts
							}

							// 3. Check for sequential time slot distance constraint
							// If trainer has students at previous hour (e.g., 4 PM), new student must be within 3km
							let passesDistanceCheck = true;
							
							if (previousHour24 && previousHourAmPm && studentLatitude && studentLongitude) {
								// Find all students at the previous hour time slot for this trainer
								// Check both 24-hour format (scheduled_time) and AM/PM format (metadata timeSlot)
								const previousHourStudents = await this.pool.query<{
									student_id: string;
									scheduled_date: Date;
									latitude: number | null;
									longitude: number | null;
								}>(
									`SELECT DISTINCT
										ta.student_id,
										ts.scheduled_date,
										sp.latitude,
										sp.longitude
									FROM trainer_allocations ta
									INNER JOIN tutoring_sessions ts ON ta.id = ts.allocation_id
									INNER JOIN student_profiles sp ON ta.student_id = sp.student_id
									WHERE ta.trainer_id = $1
										AND ta.status IN ('approved', 'active')
										AND (
											ts.scheduled_time = $2
											OR (
												ta.metadata IS NOT NULL
												AND ta.metadata->'schedule'->>'timeSlot' = $3
											)
										)
										AND ts.scheduled_date >= $4
										AND ts.scheduled_date <= $5
										AND ts.status NOT IN ('cancelled', 'completed')
										AND sp.latitude IS NOT NULL
										AND sp.longitude IS NOT NULL`,
									[altTrainer.trainer_id, previousHour24, previousHourAmPm, startDateForCheck, endDateForCheck]
								);

								// If trainer has students at previous hour, check distance
								if (previousHourStudents.rows.length > 0) {
									for (const prevStudent of previousHourStudents.rows) {
										if (prevStudent.latitude && prevStudent.longitude) {
											const distanceKm = calculateDistance(
												prevStudent.latitude,
												prevStudent.longitude,
												studentLatitude,
												studentLongitude
											);

											if (distanceKm > MAX_SEQUENTIAL_DISTANCE_KM) {
												passesDistanceCheck = false;
												logger.warn('Auto Assignment: Trainer has student at previous hour and new student exceeds distance limit', {
													trainerId: altTrainer.trainer_id,
													previousHour: previousHourAmPm || previousHour24,
													distanceKm: distanceKm.toFixed(2),
													maxDistanceKm: MAX_SEQUENTIAL_DISTANCE_KM,
													service: 'allocation-service',
												});
												break;
											}
										}
									}
								}
							}

							// 4. If trainer has students at next hour, check if they're within 3km of new student
							if (passesDistanceCheck && nextHour24 && nextHourAmPm && studentLatitude && studentLongitude) {
								// Find all students at the next hour time slot for this trainer
								// Check both 24-hour format (scheduled_time) and AM/PM format (metadata timeSlot)
								const nextHourStudents = await this.pool.query<{
									student_id: string;
									latitude: number | null;
									longitude: number | null;
								}>(
									`SELECT DISTINCT
										ta.student_id,
										sp.latitude,
										sp.longitude
									FROM trainer_allocations ta
									INNER JOIN tutoring_sessions ts ON ta.id = ts.allocation_id
									INNER JOIN student_profiles sp ON ta.student_id = sp.student_id
									WHERE ta.trainer_id = $1
										AND ta.status IN ('approved', 'active')
										AND (
											ts.scheduled_time = $2
											OR (
												ta.metadata IS NOT NULL
												AND ta.metadata->'schedule'->>'timeSlot' = $3
											)
										)
										AND ts.scheduled_date >= $4
										AND ts.scheduled_date <= $5
										AND ts.status NOT IN ('cancelled', 'completed')
										AND sp.latitude IS NOT NULL
										AND sp.longitude IS NOT NULL`,
									[altTrainer.trainer_id, nextHour24, nextHourAmPm, startDateForCheck, endDateForCheck]
								);

								// If trainer has students at next hour, they must be within 3km of new student
								if (nextHourStudents.rows.length > 0) {
									for (const nextStudent of nextHourStudents.rows) {
										if (nextStudent.latitude && nextStudent.longitude) {
											const distanceKm = calculateDistance(
												studentLatitude,
												studentLongitude,
												nextStudent.latitude,
												nextStudent.longitude
											);

											if (distanceKm > MAX_SEQUENTIAL_DISTANCE_KM) {
												passesDistanceCheck = false;
												logger.warn('Auto Assignment: Trainer has student at next hour and new student exceeds distance limit', {
													trainerId: altTrainer.trainer_id,
													nextHour: nextHourAmPm || nextHour24,
													distanceKm: distanceKm.toFixed(2),
													maxDistanceKm: MAX_SEQUENTIAL_DISTANCE_KM,
													service: 'allocation-service',
												});
												break;
											}
										}
									}
								}
							}

							if (passesDistanceCheck) {
								newTrainerId = altTrainer.trainer_id;
								trainerChanged = true;
								logger.info('Auto Assignment: Found alternative trainer who is available', {
									newTrainerId,
									hasCourseSpecialty: !!(courseCategory || courseSubcategory),
									hasGenderMatch: !!studentGender,
									timeSlot,
									service: 'allocation-service',
								});
								break;
							}
						}

						if (!newTrainerId) {
							logger.warn('Auto Assignment: No alternative trainer found, will proceed with existing trainer but may have conflicts', {
								existingTrainerId,
								service: 'allocation-service',
							});
							// Continue with existing trainer but note the conflict
						}
					}

					const systemAdminId = await this.getSystemAdminId();
					
					// CRITICAL: If trainer changed, create a NEW allocation for new sessions
					// Keep old allocation unchanged so old sessions remain with old trainer
					if (trainerChanged && newTrainerId) {
						logger.info('Auto Assignment: Trainer changed during upgrade, creating NEW allocation', {
							newTrainerId,
							oldAllocationId: allocation.id,
							existingTrainerId,
							service: 'allocation-service',
						});
						
						// Create new allocation for new trainer and new sessions
						const newAllocationMetadata: Record<string, unknown> = {
							sessionCount: additionalSessions,
							isSundayOnly,
							schedule: {
								timeSlot,
								date,
								startDate: paymentMetadata?.startDate || paymentMetadata?.date || paymentMetadata?.preferredDate || date,
							},
							upgrade: true,
							additionalSessions,
							upgradedAt: new Date().toISOString(),
							previousAllocationId: allocation.id,
							previousTrainerId: existingTrainerId,
							trainerChanged: true,
							trainerChangeReason: availabilityConflicts.join('; ') || 'Existing trainer not available for selected time slot',
							trainerChangeDate: new Date().toISOString(),
						};

						const newAllocation = await this.allocationRepo.create({
							studentId,
							trainerId: newTrainerId,
							courseId,
							requestedBy: studentId,
							notes: `Upgrade allocation: New trainer assigned for additional ${additionalSessions} sessions. Previous trainer ${existingTrainerId} continues with remaining sessions.`,
							metadata: newAllocationMetadata,
						});

						// Approve the new allocation
						const approvedNewAllocation = await this.allocationRepo.update(
							newAllocation.id,
							{
								status: 'approved',
							},
							systemAdminId
						);

						if (!approvedNewAllocation) {
							throw new AppError('Failed to approve new allocation for upgrade', 500);
						}

						// Update old allocation metadata to note the upgrade (but don't change trainer)
						const oldAllocationMetadata: Record<string, unknown> = {
							...(allocation.metadata || {}),
							upgrade: true,
							additionalSessionsAllocated: true,
							newAllocationId: approvedNewAllocation.id,
							newTrainerId: newTrainerId,
							upgradedAt: new Date().toISOString(),
							note: `Student upgraded. New sessions allocated to trainer ${newTrainerId} in allocation ${approvedNewAllocation.id}. This allocation continues with remaining original sessions.`,
						};

						await this.allocationRepo.update(
							allocation.id,
							{
								metadata: oldAllocationMetadata,
							},
							systemAdminId
						);

						// Create sessions for the NEW allocation (new trainer, new sessions)
						logger.info('Auto Assignment: Creating additional sessions for NEW allocation', {
							additionalSessions,
							allocationId: approvedNewAllocation.id,
							newTrainerId,
							service: 'allocation-service',
						});
						try {
							const validatedStartDate = (paymentMetadata?.startDate || paymentMetadata?.date || paymentMetadata?.preferredDate || date) as string;
							await this.createAdditionalSessionsForUpgrade(approvedNewAllocation, additionalSessions, timeSlot, validatedStartDate);
							logger.info('Auto Assignment: Successfully created additional sessions for new allocation', {
								additionalSessions,
								allocationId: approvedNewAllocation.id,
								service: 'allocation-service',
							});
						} catch (error: any) {
							logger.error('Auto Assignment: Failed to create additional sessions for new allocation', {
								error: error?.message || String(error),
								stack: error?.stack,
								allocationId: approvedNewAllocation.id,
								service: 'allocation-service',
							});
							// Don't throw - return the allocation anyway
						}

						return approvedNewAllocation;
					}

					// If same trainer is available, update existing allocation and add sessions
					// Update allocation metadata with upgrade info
					const updatedMetadata: Record<string, unknown> = {
						...(allocation.metadata || {}),
						upgrade: true,
						additionalSessions,
						upgradedAt: new Date().toISOString(),
						schedule: { timeSlot, date },
					};

					if (!trainerAvailable && !newTrainerId) {
						// Trainer not available but no alternative found
						updatedMetadata.trainerAvailabilityWarning = true;
						updatedMetadata.trainerAvailabilityConflicts = availabilityConflicts;
						logger.warn('Auto Assignment: Trainer availability issue noted but no alternative found', {
							existingTrainerId,
							service: 'allocation-service',
						});
					}

					const updated = await this.allocationRepo.update(
						allocation.id,
						{
							metadata: updatedMetadata,
						},
						systemAdminId
					);

					if (!updated) {
						throw new AppError('Failed to update allocation for upgrade', 500);
					}

					// Create only the additional sessions for the upgrade (same trainer)
					// CRITICAL: Use the start date from payment metadata if provided, but validate it's after last session
					logger.info('Auto Assignment: Creating additional sessions for upgrade with SAME trainer', {
						additionalSessions,
						existingTrainerId,
						allocationId: allocation.id,
						service: 'allocation-service',
					});
					try {
						// Get the last session date to validate start date
						const lastSessionCheck = await this.pool.query<{
							scheduled_date: Date;
						}>(
							`SELECT scheduled_date 
							FROM tutoring_sessions 
							WHERE allocation_id = $1 
							ORDER BY scheduled_date DESC 
							LIMIT 1`,
							[allocation.id]
						);

						// If a start date is provided in metadata, validate it's after the last session
						let validatedStartDate: string | undefined = undefined;
						if (paymentMetadata?.startDate || paymentMetadata?.date || paymentMetadata?.preferredDate) {
							const dateStr = (paymentMetadata.startDate as string) ||
								(paymentMetadata.date as string) ||
								(paymentMetadata.preferredDate as string) ||
								'';
							
							// Parse date correctly to avoid timezone issues
							let parsedDateStr: string;
							if (dateStr.includes('T')) {
								// ISO format with time - extract just the date part (YYYY-MM-DD)
								parsedDateStr = dateStr.split('T')[0];
							} else {
								// Date-only format
								parsedDateStr = dateStr;
							}
							
							// Parse date components and create local date (no timezone conversion)
							const dateParts = parsedDateStr.split(/[-/]/);
							let providedDate: Date;
							if (dateParts.length === 3) {
								// Create date in local timezone (month is 0-indexed)
								providedDate = new Date(
									parseInt(dateParts[0], 10), // year
									parseInt(dateParts[1], 10) - 1, // month (0-indexed)
									parseInt(dateParts[2], 10) // day
								);
							} else {
								// Fallback - use tomorrow
								providedDate = new Date();
								providedDate.setDate(providedDate.getDate() + 1);
							}
							
							if (lastSessionCheck.rows.length > 0) {
								const lastSessionDate = new Date(lastSessionCheck.rows[0].scheduled_date);
								lastSessionDate.setHours(0, 0, 0, 0);
								providedDate.setHours(0, 0, 0, 0);
								
								// Start date must be at least the day after the last session
								const minStartDate = new Date(lastSessionDate);
								minStartDate.setDate(minStartDate.getDate() + 1);
								
								if (providedDate < minStartDate) {
									logger.warn('Auto Assignment: Provided start date is before minimum, using calculated date', {
										providedDate: providedDate.toISOString().split('T')[0],
										minimumDate: minStartDate.toISOString().split('T')[0],
										service: 'allocation-service',
									});
								} else {
									validatedStartDate = providedDate.toISOString().split('T')[0];
									logger.info('Auto Assignment: Using validated start date from metadata', {
										validatedStartDate,
										service: 'allocation-service',
									});
								}
							} else {
								validatedStartDate = providedDate.toISOString().split('T')[0];
							}
						}

						await this.createAdditionalSessionsForUpgrade(updated, additionalSessions, timeSlot, validatedStartDate);
						logger.info('Auto Assignment: Successfully created additional sessions for upgrade', {
							additionalSessions,
							allocationId: allocation.id,
							service: 'allocation-service',
						});
					} catch (error: any) {
						logger.error('Auto Assignment: Failed to create additional sessions for upgrade', {
							error: error?.message || String(error),
							stack: error?.stack,
							allocationId: allocation.id,
							service: 'allocation-service',
						});
						// Don't throw - return the updated allocation anyway
						// Admin can manually create sessions if needed
					}

					return updated;
				} else {
					logger.warn('Auto Assignment: Upgrade detected but no existing allocation found', {
						studentId,
						courseId,
						service: 'allocation-service',
					});
					// For upgrades, we should always have an existing allocation
					// If not, something went wrong, but we'll continue with normal flow
				}
			}

			// CRITICAL: Check for existing approved/active allocation for this course BEFORE creating new one
			// This prevents duplicate allocations even if upgrade flag is missing or incorrect
			// Query directly for approved or active allocations (repository doesn't support array status)
			const existingAllocationCheckResult = await this.pool.query<{
				id: string;
				student_id: string;
				trainer_id: string | null;
				course_id: string | null;
				requested_by: string;
				requested_at: Date | null;
				status: string;
				allocated_by: string | null;
				allocated_at: Date | null;
				rejected_by: string | null;
				rejected_at: Date | null;
				rejection_reason: string | null;
				notes: string | null;
				metadata: any;
				created_at: Date;
				updated_at: Date;
			}>(
				`SELECT * FROM trainer_allocations 
				WHERE student_id = $1 
					AND (course_id = $2 OR (course_id IS NULL AND $2 IS NULL))
					AND status IN ('approved', 'active')
				ORDER BY updated_at DESC
				LIMIT 1`,
				[studentId, courseId]
			);
			
			const existingAllocationCheck = existingAllocationCheckResult.rows.map(row => ({
				id: row.id,
				studentId: row.student_id,
				trainerId: row.trainer_id,
				courseId: row.course_id,
				requestedBy: row.requested_by,
				requestedAt: row.requested_at || new Date(),
				status: row.status as AllocationStatus,
				allocatedBy: row.allocated_by,
				allocatedAt: row.allocated_at,
				rejectedBy: row.rejected_by,
				rejectedAt: row.rejected_at,
				rejectionReason: row.rejection_reason,
				notes: row.notes,
				metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
				createdAt: row.created_at,
				updatedAt: row.updated_at,
			})) as TrainerAllocationRecord[];

			if (existingAllocationCheck.length > 0) {
				const existingAlloc = existingAllocationCheck[0];
				logger.warn('Auto Assignment: Existing approved/active allocation found, might be unflagged upgrade', {
					existingAllocationId: existingAlloc.id,
					studentId,
					courseId,
					service: 'allocation-service',
				});
				// Return existing allocation instead of creating duplicate
				return existingAlloc;
			}

			// 0. Get session count from purchase record via course service API
			let sessionCount = 30; // Default to 30 sessions
			try {
				// Call course service to get purchase information
				const courseServiceUrl = process.env.COURSE_SERVICE_URL ||
					`http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.COURSE_SERVICE_PORT || 3005}`;

				const axios = (await import('axios')).default;
				const purchaseUrl = `${courseServiceUrl}/api/v1/students/${studentId}/courses/${courseId}/purchase`;

				const purchaseResponse = await axios.get(purchaseUrl, { timeout: 10000 });

				if (purchaseResponse.status === 200 && purchaseResponse.data?.data) {
					const purchase = purchaseResponse.data.data;

					// Purchase tier: 10, 20, or 30 sessions
					if (purchase.purchaseTier) {
						sessionCount = purchase.purchaseTier;
						logger.info('Auto Assignment: Found session count from purchase_tier', {
							sessionCount,
							studentId,
							courseId,
							service: 'allocation-service',
						});
					} else if (purchase.metadata && typeof purchase.metadata === 'object') {
						// Try to get from metadata
						const metadata = purchase.metadata as Record<string, unknown>;
						if (typeof metadata.sessionCount === 'number') {
							sessionCount = metadata.sessionCount;
							logger.info('Auto Assignment: Found session count from purchase metadata', {
								sessionCount,
								studentId,
								courseId,
								service: 'allocation-service',
							});
						}
					}
				} else {
					logger.warn('Auto Assignment: No purchase record found, using default session count', {
						studentId,
						courseId,
						defaultSessionCount: sessionCount,
						service: 'allocation-service',
					});
				}
			} catch (error: any) {
				logger.warn('Auto Assignment: Could not fetch purchase record for session count, using default', {
					error: error?.message || String(error),
					studentId,
					courseId,
					service: 'allocation-service',
				});
			}

			// 1. Get student profile (gender and location for distance checks)
			const studentProfile = await this.pool.query<{
				student_id: string;
				gender: string | null;
				latitude: number | null;
				longitude: number | null;
			}>(`
				SELECT student_id, gender, latitude, longitude
				FROM student_profiles 
				WHERE student_id = $1
			`, [studentId]);

			const studentGender = studentProfile.rows[0]?.gender?.toLowerCase() || null;
			const studentLatitude = studentProfile.rows[0]?.latitude;
			const studentLongitude = studentProfile.rows[0]?.longitude;
			
			if (!studentLatitude || !studentLongitude) {
				logger.warn('Auto Assignment: Student does not have GPS coordinates, distance checks will be skipped', {
					studentId,
					service: 'allocation-service',
				});
			}

			// 2. Get course details for expertise matching
			const courseDetails = await this.pool.query<{
				id: string;
				category: string | null;
				subcategory: string | null;
			}>(`
				SELECT id, category, subcategory
				FROM courses
				WHERE id = $1
			`, [courseId]);

			// Map course category to trainer course names (handle variations)
			const rawCategory = courseDetails.rows[0]?.category || null;
			const rawSubcategory = courseDetails.rows[0]?.subcategory || null;
			
			// Normalize course category/subcategory to match trainer application course names
			// Trainer application uses: AI, Robotics, Coding, App Making, Video Making
			// Course categories might use: AI, Robotics, Coding, App Development, Video Editing, etc.
			const normalizeCourseName = (category: string | null): string | null => {
				if (!category) return null;
				const normalized = category.trim();
				const lowerNormalized = normalized.toLowerCase();
				
				// Map variations to trainer course names (case-insensitive)
				if (lowerNormalized.includes('app') && (lowerNormalized.includes('making') || lowerNormalized.includes('development'))) {
					return 'App Making';
				}
				if (lowerNormalized.includes('video') && (lowerNormalized.includes('making') || lowerNormalized.includes('editing'))) {
					return 'Video Making';
				}
				// Handle coding variations: Coding, Programming, Computer Science, etc.
				if (lowerNormalized.includes('coding') || lowerNormalized.includes('programming') || 
				    lowerNormalized.includes('computer science') || lowerNormalized.includes('cs')) {
					return 'Coding';
				}
				// Handle AI variations - normalize "Artificial Intelligence" to "AI"
				if (lowerNormalized.includes('artificial intelligence') || lowerNormalized === 'ai') {
					return 'AI';
				}
				// Handle Robotics variations
				if (lowerNormalized.includes('robotic') || lowerNormalized === 'robotics') {
					return 'Robotics';
				}
				// Direct matches: AI, Robotics, Coding (case-insensitive)
				if (['ai', 'robotics', 'coding'].includes(lowerNormalized)) {
					return normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
				}
				// Return as-is for other cases
				return normalized;
			};
			
			const courseCategory = normalizeCourseName(rawCategory);
			const courseSubcategory = normalizeCourseName(rawSubcategory);
			
			logger.debug('Auto Assignment: Course category mapping', {
				rawCategory,
				rawSubcategory,
				normalizedCategory: courseCategory,
				normalizedSubcategory: courseSubcategory,
				courseId,
			});

			// 2.5. Helper functions for time slot parsing (same as upgrade logic)
			const parseTimeSlotTo24Hour = (slot: string): string | null => {
				const normalized = slot.trim().toUpperCase();
				
				// Handle AM/PM format (e.g., "4:00 PM")
				const ampmMatch = normalized.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/);
				if (ampmMatch) {
					let hour = parseInt(ampmMatch[1], 10);
					const minutes = ampmMatch[2];
					const ampm = ampmMatch[3];
					
					if (ampm === 'PM' && hour !== 12) hour += 12;
					if (ampm === 'AM' && hour === 12) hour = 0;
					
					return `${String(hour).padStart(2, '0')}:${minutes}`;
				}
				
				// Handle 24-hour format (e.g., "16:00")
				const hour24Match = normalized.match(/(\d{1,2}):(\d{2})/);
				if (hour24Match) {
					const hour = parseInt(hour24Match[1], 10);
					const minutes = hour24Match[2];
					if (hour >= 0 && hour < 24) {
						return `${String(hour).padStart(2, '0')}:${minutes}`;
					}
				}
				
				return null;
			};

			const hour24ToAmPm = (hour24: string): string | null => {
				const [hourStr, minutes] = hour24.split(':');
				const hour = parseInt(hourStr, 10);
				if (isNaN(hour) || hour < 0 || hour >= 24) return null;
				
				const ampm = hour >= 12 ? 'PM' : 'AM';
				const displayHour = hour % 12 || 12;
				return `${displayHour}:${minutes} ${ampm}`;
			};

			// Get sequential time slots
			const currentHour24 = parseTimeSlotTo24Hour(timeSlot);
			let previousHour24: string | null = null;
			let nextHour24: string | null = null;
			let previousHourAmPm: string | null = null;
			let nextHourAmPm: string | null = null;

			if (currentHour24) {
				const [hourStr] = currentHour24.split(':');
				const hour = parseInt(hourStr, 10);
				
				if (hour > 0) {
					previousHour24 = `${String(hour - 1).padStart(2, '0')}:00`;
					previousHourAmPm = hour24ToAmPm(previousHour24);
				}
				
				if (hour < 23) {
					nextHour24 = `${String(hour + 1).padStart(2, '0')}:00`;
					nextHourAmPm = hour24ToAmPm(nextHour24);
				}
			}

			// Calculate date range for distance checks (based on session count and schedule mode)
			// Get schedule mode from payment metadata if available
			const paymentMetadataSchedule = paymentMetadata?.schedule && typeof paymentMetadata.schedule === 'object' 
				? paymentMetadata.schedule as Record<string, unknown> 
				: {};
			const scheduleMode = (paymentMetadata?.scheduleMode as string) || 
				(paymentMetadata?.scheduleType as string) || 
				(paymentMetadataSchedule.mode as string) || 
				'everyday';
			const isSundayOnly = scheduleMode === 'sunday' || scheduleMode === 'sunday-focus';

			// Parse date correctly to avoid timezone issues
			let parsedDateStr: string;
			if (date.includes('T')) {
				// ISO format with time - extract just the date part (YYYY-MM-DD)
				parsedDateStr = date.split('T')[0];
			} else {
				// Date-only format
				parsedDateStr = date;
			}
			
			// Parse date components and create local date (no timezone conversion)
			const dateParts = parsedDateStr.split(/[-/]/);
			let startDateForCheck: Date;
			if (dateParts.length === 3) {
				// Create date in local timezone (month is 0-indexed)
				startDateForCheck = new Date(
					parseInt(dateParts[0], 10), // year
					parseInt(dateParts[1], 10) - 1, // month (0-indexed)
					parseInt(dateParts[2], 10) // day
				);
			} else {
				// Fallback - use today
				startDateForCheck = new Date();
			}
			startDateForCheck.setHours(0, 0, 0, 0);
			
			let endDateForCheck: Date;
			if (isSundayOnly) {
				endDateForCheck = new Date(startDateForCheck);
				const weeksToAdd = sessionCount - 1;
				endDateForCheck.setDate(endDateForCheck.getDate() + (weeksToAdd * 7));
			} else {
				endDateForCheck = new Date(startDateForCheck);
				endDateForCheck.setDate(endDateForCheck.getDate() + (sessionCount - 1));
			}
			endDateForCheck.setHours(23, 59, 59, 999);

			// 3. Find available trainers matching criteria
			// CRITICAL: Filter trainers by required course specialties to ensure trainers only teach courses they know
			const normalizedTimeSlot = timeSlot.trim().replace(/\s+/g, ' ').toUpperCase();
			
			// Convert time slot to TIME format for checking trainer_availability table
			// Handle both "7:00 AM" and "7:00 AM - 8:00 AM" formats
			const timeSlotMatch = normalizedTimeSlot.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/);
			let timeSlotInTimeFormat: string | null = null;
			if (timeSlotMatch) {
				let hour = parseInt(timeSlotMatch[1], 10);
				const minutes = timeSlotMatch[2];
				const period = timeSlotMatch[3];
				
				if (period === 'PM' && hour !== 12) {
					hour += 12;
				} else if (period === 'AM' && hour === 12) {
					hour = 0;
				}
				
				timeSlotInTimeFormat = `${hour.toString().padStart(2, '0')}:${minutes}:00`;
			}
			
			// Distance calculation function using Haversine formula
			const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
				const R = 6371; // Earth's radius in kilometers
				const dLat = (lat2 - lat1) * (Math.PI / 180);
				const dLon = (lon2 - lon1) * (Math.PI / 180);
				const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
					Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
					Math.sin(dLon / 2) * Math.sin(dLon / 2);
				const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
				return R * c;
			};
			// Maximum distance for sequential time slots (configurable via env)
			const MAX_SEQUENTIAL_DISTANCE_KM = parseInt(
				process.env.MAX_SEQUENTIAL_DISTANCE_KM || '5',
				10
			);
			
			// First, try to find trainers WITH matching specialties (required for proper allocation)
			// CRITICAL FIX: Check BOTH trainer_profiles.availability.preferredTimeSlots (JSONB) AND trainer_availability table
			// Only include trainers who actually have the time slot available
			let availableTrainers = await this.pool.query<{
				trainer_id: string;
				gender: string | null;
				current_load: number;
				total_allocations: number;
				specialties: string[] | null;
				availability: any;
				years_of_experience: number | null;
				latitude: number | null;
				longitude: number | null;
				rating_average: number | null;
			}>(`
				SELECT 
					t.id as trainer_id,
					tp.gender,
					tp.availability,
					tp.specialties,
					tp.years_of_experience,
					tp.rating_average,
					tl.latitude,
					tl.longitude,
					(
						SELECT COUNT(*) 
						FROM trainer_allocations ta
						WHERE ta.trainer_id = t.id 
							AND ta.status IN ('approved', 'active')
							AND ta.metadata IS NOT NULL
							AND ta.metadata->'schedule'->>'timeSlot' = $1
					) as current_load,
					(
						SELECT COUNT(*) 
						FROM trainer_allocations ta
						WHERE ta.trainer_id = t.id 
							AND ta.status IN ('approved', 'active')
					) as total_allocations
				FROM trainers t
				INNER JOIN trainer_profiles tp ON t.id = tp.trainer_id
				LEFT JOIN trainer_locations tl ON t.id = tl.trainer_id
				LEFT JOIN trainer_availability tav ON t.id = tav.trainer_id
				WHERE t.approval_status = 'approved'
					AND (
						-- Gender matching: male-male, female-female, or null matches all
						tp.gender IS NULL 
						OR $2::text IS NULL 
						OR LOWER(tp.gender) = LOWER($2::text)
					)
					AND (
						-- CRITICAL FIX: Check time slot availability from BOTH sources
						-- Must have availability in EITHER preferredTimeSlots (JSONB) OR trainer_availability table
						-- Do NOT include trainers with NULL availability (this was the bug!)
						(
							-- Check JSONB preferredTimeSlots (handles "7:00 AM - 8:00 AM" format by matching start)
							tp.availability IS NOT NULL 
							AND tp.availability->'preferredTimeSlots' IS NOT NULL
							AND (
								SELECT COUNT(*) 
								FROM jsonb_array_elements_text(tp.availability->'preferredTimeSlots') AS slot
								WHERE UPPER(TRIM(REPLACE(slot, ' ', ' '))) = $3
								-- Also match if slot starts with the requested time (e.g., "7:00 AM - 8:00 AM" matches "7:00 AM")
								OR UPPER(TRIM(REPLACE(slot, ' ', ' '))) LIKE $3 || '%'
							) > 0
						)
						OR (
							-- Check trainer_availability table (TIME format: 07:00:00)
							$6::time IS NOT NULL
							AND tav.slot_start = $6::time
						)
					)
					AND (
						-- CRITICAL: Filter by course specialty - trainer MUST have the course category or subcategory in their specialties
						-- Only include trainers who can actually teach this course
						-- Uses case-insensitive matching to handle variations like "Robotics" vs "robotics" vs "ROBOTICS"
						-- Also handles AI aliases: "AI" matches "AI", "Artificial Intelligence", "Artifical Intellegence" (typo), etc.
						($4::text IS NULL AND $5::text IS NULL)
						OR (
							tp.specialties IS NOT NULL 
							AND (
								$4::text IS NOT NULL AND EXISTS (
									SELECT 1 FROM unnest(tp.specialties) AS specialty
									WHERE (
										LOWER(TRIM(specialty)) = LOWER(TRIM($4::text))
										OR (LOWER(TRIM($4::text)) = 'ai' AND (
											LOWER(TRIM(specialty)) = 'ai'
											OR LOWER(TRIM(specialty)) LIKE '%artificial intelligence%'
											OR LOWER(TRIM(specialty)) LIKE '%artifical intellegence%'
											OR LOWER(TRIM(specialty)) LIKE '%artifical intelligence%'
										))
									)
								)
								OR $5::text IS NOT NULL AND EXISTS (
									SELECT 1 FROM unnest(tp.specialties) AS specialty
									WHERE (
										LOWER(TRIM(specialty)) = LOWER(TRIM($5::text))
										OR (LOWER(TRIM($5::text)) = 'ai' AND (
											LOWER(TRIM(specialty)) = 'ai'
											OR LOWER(TRIM(specialty)) LIKE '%artificial intelligence%'
											OR LOWER(TRIM(specialty)) LIKE '%artifical intellegence%'
											OR LOWER(TRIM(specialty)) LIKE '%artifical intelligence%'
										))
									)
								)
							)
						)
					)
				GROUP BY t.id, tp.gender, tp.availability, tp.specialties, tp.years_of_experience, tp.rating_average, tl.latitude, tl.longitude
				HAVING (
					-- Ensure trainer has availability in at least one source
					(
						tp.availability IS NOT NULL 
						AND tp.availability->'preferredTimeSlots' IS NOT NULL
						AND (
							SELECT COUNT(*) 
							FROM jsonb_array_elements_text(tp.availability->'preferredTimeSlots') AS slot
							WHERE UPPER(TRIM(REPLACE(slot, ' ', ' '))) = $3
							OR UPPER(TRIM(REPLACE(slot, ' ', ' '))) LIKE $3 || '%'
						) > 0
					)
					OR (
						$6::time IS NOT NULL
						AND COUNT(DISTINCT tav.slot_start) FILTER (WHERE tav.slot_start = $6::time) > 0
					)
				)
				ORDER BY 
					-- Priority 1: Trainers with less than 4 allocations get highest priority (need to reach minimum)
					CASE 
						WHEN (
							SELECT COUNT(*) 
							FROM trainer_allocations ta
							WHERE ta.trainer_id = t.id 
								AND ta.status IN ('approved', 'active')
						) < 4 THEN 0
						ELSE 1
					END,
					-- Priority 2: Rating (higher rating = higher priority for allocation)
					-- Only applies after minimum 4 allocations are met
					COALESCE(tp.rating_average, 0) DESC,
					-- Priority 3: Prioritize trainers with exact course category match (case-insensitive)
					CASE 
						WHEN $4::text IS NOT NULL AND tp.specialties IS NOT NULL 
							AND EXISTS (
								SELECT 1 FROM unnest(tp.specialties) AS specialty
								WHERE LOWER(TRIM(specialty)) = LOWER(TRIM($4::text))
							)
						THEN 1 
						WHEN $5::text IS NOT NULL AND tp.specialties IS NOT NULL 
							AND EXISTS (
								SELECT 1 FROM unnest(tp.specialties) AS specialty
								WHERE LOWER(TRIM(specialty)) = LOWER(TRIM($5::text))
							)
						THEN 2
						ELSE 3
					END,
					-- Priority 4: Current workload (balance distribution)
					current_load ASC,
					-- Priority 5: Trainer experience
					tp.years_of_experience DESC NULLS LAST
				LIMIT 10
			`, [timeSlot, studentGender, normalizedTimeSlot, courseCategory, courseSubcategory, timeSlotInTimeFormat]);

			// If no trainers with matching specialties found, log warning and try fallback (without specialty filter)
			// This should rarely happen in production, but provides graceful degradation
			let usedFallback = false;
			if (availableTrainers.rows.length === 0 && (courseCategory || courseSubcategory)) {
				logger.warn('Auto Assignment: No trainers found with matching specialties, attempting fallback', {
					courseId,
					courseCategory,
					courseSubcategory,
					service: 'allocation-service',
				});
				
				usedFallback = true;
				availableTrainers = await this.pool.query<{
					trainer_id: string;
					gender: string | null;
					current_load: number;
					total_allocations: number;
					specialties: string[] | null;
					availability: any;
					years_of_experience: number | null;
					latitude: number | null;
					longitude: number | null;
					rating_average: number | null;
				}>(`
					SELECT 
						t.id as trainer_id,
						tp.gender,
						tp.availability,
						tp.specialties,
						tp.years_of_experience,
						tp.rating_average,
						tl.latitude,
						tl.longitude,
						(
							SELECT COUNT(*) 
							FROM trainer_allocations ta
							WHERE ta.trainer_id = t.id 
								AND ta.status IN ('approved', 'active')
								AND ta.metadata IS NOT NULL
								AND ta.metadata->'schedule'->>'timeSlot' = $1
						) as current_load,
						(
							SELECT COUNT(*) 
							FROM trainer_allocations ta
							WHERE ta.trainer_id = t.id 
								AND ta.status IN ('approved', 'active')
						) as total_allocations
					FROM trainers t
					INNER JOIN trainer_profiles tp ON t.id = tp.trainer_id
					LEFT JOIN trainer_locations tl ON t.id = tl.trainer_id
					LEFT JOIN trainer_availability tav ON t.id = tav.trainer_id
					WHERE t.approval_status = 'approved'
						AND (
							-- Gender matching: male-male, female-female, or null matches all
							tp.gender IS NULL 
							OR $2::text IS NULL 
							OR LOWER(tp.gender) = LOWER($2::text)
						)
						AND (
							-- CRITICAL FIX: Check time slot availability from BOTH sources
							-- Must have availability in EITHER preferredTimeSlots (JSONB) OR trainer_availability table
							-- Do NOT include trainers with NULL availability (this was the bug!)
							(
								-- Check JSONB preferredTimeSlots (handles "7:00 AM - 8:00 AM" format by matching start)
								tp.availability IS NOT NULL 
								AND tp.availability->'preferredTimeSlots' IS NOT NULL
								AND (
									SELECT COUNT(*) 
									FROM jsonb_array_elements_text(tp.availability->'preferredTimeSlots') AS slot
									WHERE UPPER(TRIM(REPLACE(slot, ' ', ' '))) = $3
									-- Also match if slot starts with the requested time (e.g., "7:00 AM - 8:00 AM" matches "7:00 AM")
									OR UPPER(TRIM(REPLACE(slot, ' ', ' '))) LIKE $3 || '%'
								) > 0
							)
							OR (
								-- Check trainer_availability table (TIME format: 07:00:00)
								$4::time IS NOT NULL
								AND tav.slot_start = $4::time
							)
						)
					GROUP BY t.id, tp.gender, tp.availability, tp.specialties, tp.years_of_experience, tp.rating_average, tl.latitude, tl.longitude
					HAVING (
						-- Ensure trainer has availability in at least one source
						(
							tp.availability IS NOT NULL 
							AND tp.availability->'preferredTimeSlots' IS NOT NULL
							AND (
								SELECT COUNT(*) 
								FROM jsonb_array_elements_text(tp.availability->'preferredTimeSlots') AS slot
								WHERE UPPER(TRIM(REPLACE(slot, ' ', ' '))) = $3
								OR UPPER(TRIM(REPLACE(slot, ' ', ' '))) LIKE $3 || '%'
							) > 0
						)
						OR (
							$4::time IS NOT NULL
							AND COUNT(DISTINCT tav.slot_start) FILTER (WHERE tav.slot_start = $4::time) > 0
						)
					)
					ORDER BY 
						-- Priority 1: Trainers with less than 4 allocations get highest priority (need to reach minimum)
						CASE 
							WHEN (
								SELECT COUNT(*) 
								FROM trainer_allocations ta
								WHERE ta.trainer_id = t.id 
									AND ta.status IN ('approved', 'active')
							) < 4 THEN 0
							ELSE 1
						END,
						-- Priority 2: Rating (higher rating = higher priority for allocation)
						-- Only applies after minimum 4 allocations are met
						COALESCE(tp.rating_average, 0) DESC,
						-- Priority 3: Current workload (balance distribution)
						current_load ASC,
						-- Priority 4: Trainer experience
						tp.years_of_experience DESC NULLS LAST
					LIMIT 10
				`, [timeSlot, studentGender, normalizedTimeSlot, timeSlotInTimeFormat]);
			}

			if (availableTrainers.rows.length === 0) {
				// FALLBACK: If no trainers with rating 4.0+ available, try to find highest-rated trainer (even if below 4.0)
				// This ensures pending allocations can still be assigned when no high-rated trainers are available
				logger.warn('Auto Assignment: No trainers with rating 4.0+ found, attempting fallback', {
					studentId,
					courseId,
					service: 'allocation-service',
				});
				
				availableTrainers = await this.pool.query<{
					trainer_id: string;
					gender: string | null;
					current_load: number;
					total_allocations: number;
					specialties: string[] | null;
					availability: any;
					years_of_experience: number | null;
					latitude: number | null;
					longitude: number | null;
					rating_average: number | null;
				}>(`
					SELECT 
						t.id as trainer_id,
						tp.gender,
						tp.availability,
						tp.specialties,
						tp.years_of_experience,
						tp.rating_average,
						tl.latitude,
						tl.longitude,
						(
							SELECT COUNT(*) 
							FROM trainer_allocations ta
							WHERE ta.trainer_id = t.id 
								AND ta.status IN ('approved', 'active')
								AND ta.metadata IS NOT NULL
								AND ta.metadata->'schedule'->>'timeSlot' = $1
						) as current_load,
						(
							SELECT COUNT(*) 
							FROM trainer_allocations ta
							WHERE ta.trainer_id = t.id 
								AND ta.status IN ('approved', 'active')
						) as total_allocations
					FROM trainers t
					INNER JOIN trainer_profiles tp ON t.id = tp.trainer_id
					LEFT JOIN trainer_locations tl ON t.id = tl.trainer_id
					LEFT JOIN trainer_availability tav ON t.id = tav.trainer_id
					WHERE t.approval_status = 'approved'
						AND (
							-- Gender matching: male-male, female-female, or null matches all
							tp.gender IS NULL 
							OR $2::text IS NULL 
							OR LOWER(tp.gender) = LOWER($2::text)
						)
						AND (
							-- Check time slot availability from BOTH sources
							(
								tp.availability IS NOT NULL 
								AND tp.availability->'preferredTimeSlots' IS NOT NULL
								AND (
									SELECT COUNT(*) 
									FROM jsonb_array_elements_text(tp.availability->'preferredTimeSlots') AS slot
									WHERE UPPER(TRIM(REPLACE(slot, ' ', ' '))) = $3
									OR UPPER(TRIM(REPLACE(slot, ' ', ' '))) LIKE $3 || '%'
								) > 0
							)
							OR (
								$4::time IS NOT NULL
								AND tav.slot_start = $4::time
							)
						)
					GROUP BY t.id, tp.gender, tp.availability, tp.specialties, tp.years_of_experience, tp.rating_average, tl.latitude, tl.longitude
					HAVING (
						(
							tp.availability IS NOT NULL 
							AND tp.availability->'preferredTimeSlots' IS NOT NULL
							AND (
								SELECT COUNT(*) 
								FROM jsonb_array_elements_text(tp.availability->'preferredTimeSlots') AS slot
								WHERE UPPER(TRIM(REPLACE(slot, ' ', ' '))) = $3
								OR UPPER(TRIM(REPLACE(slot, ' ', ' '))) LIKE $3 || '%'
							) > 0
						)
						OR (
							$4::time IS NOT NULL
							AND COUNT(DISTINCT tav.slot_start) FILTER (WHERE tav.slot_start = $4::time) > 0
						)
					)
					ORDER BY 
						-- Priority 1: Trainers with less than 4 allocations get highest priority
						CASE 
							WHEN (
								SELECT COUNT(*) 
								FROM trainer_allocations ta
								WHERE ta.trainer_id = t.id 
									AND ta.status IN ('approved', 'active')
							) < 4 THEN 0
							ELSE 1
						END,
						-- Priority 2: Rating (higher rating = higher priority) - NO RATING FILTER, accept any rating
						COALESCE(tp.rating_average, 0) DESC,
						-- Priority 3: Current workload (balance distribution)
						current_load ASC,
						-- Priority 4: Trainer experience
						tp.years_of_experience DESC NULLS LAST
					LIMIT 10
				`, [timeSlot, studentGender, normalizedTimeSlot, timeSlotInTimeFormat]);
				
				if (availableTrainers.rows.length > 0) {
					logger.info('Auto Assignment: Fallback - Found trainers with rating below 4.0', {
						trainerCount: availableTrainers.rows.length,
						highestRating: availableTrainers.rows[0]?.rating_average || 0,
						service: 'allocation-service',
					});
				}
			}

			if (availableTrainers.rows.length === 0) {
				// No trainer found even after fallback - create pending allocation for manual review
				logger.warn('Auto Assignment: No available trainer found (even after fallback)', {
					studentId,
					courseId,
					courseCategory,
					courseSubcategory,
					studentGender,
					timeSlot,
					normalizedTimeSlot,
					reason: 'No trainers matched all criteria (specialty, gender, time slot)',
				});
				
				// Log all approved trainers for debugging
				const allTrainers = await this.pool.query(`
					SELECT 
						t.id,
						tp.full_name,
						tp.gender,
						tp.specialties,
						tp.availability,
						tp.rating_average
					FROM trainers t
					INNER JOIN trainer_profiles tp ON t.id = tp.trainer_id
					WHERE t.approval_status = 'approved'
					ORDER BY tp.rating_average DESC NULLS LAST
					LIMIT 10
				`);
				logger.debug('Auto Assignment: Available approved trainers', {
					trainers: allTrainers.rows.map(t => ({
						id: t.id,
						name: t.full_name,
						gender: t.gender,
						specialties: t.specialties,
						rating: t.rating_average,
					}))
				});
				
				return await this.allocationRepo.create({
					studentId,
					trainerId: null,
					courseId,
					requestedBy,
					notes: `Auto-assignment failed: No available trainers matching criteria (course: ${courseCategory || courseSubcategory || 'unknown'}, gender: ${studentGender || 'any'}, timeSlot: ${timeSlot})`,
					metadata: {
						schedule: { timeSlot, date },
						autoAssignmentAttempted: true,
						reason: 'no_available_trainers',
						courseCategory,
						courseSubcategory,
						studentGender,
					},
				});
			}

			// 4. Check each trainer for sequential time slot distance constraints and allocation limits
			// Filter trainers that pass all checks including distance constraints and allocation limits
			const eligibleTrainers: Array<{
				trainer: typeof availableTrainers.rows[0];
				passesDistanceCheck: boolean;
			}> = [];

			for (const trainer of availableTrainers.rows) {
				// Check allocation limit based on trainer rating (4-8 max allocations)
				const currentAllocationCount = await this.getTrainerCurrentAllocationCount(trainer.trainer_id);
				const maxAllocationCount = await this.getTrainerMaxAllocationCount(trainer.trainer_id);
				
				if (currentAllocationCount >= maxAllocationCount) {
					logger.debug('Auto Assignment: Trainer has reached max allocation limit, skipping', {
						trainerId: trainer.trainer_id,
						currentAllocationCount,
						maxAllocationCount,
						service: 'allocation-service',
					});
					continue;
				}
				let passesDistanceCheck = true;

				// Convert time slot to 24-hour format for database queries
				const timeSlot24 = currentHour24 || parseTimeSlotTo24Hour(timeSlot);
				if (!timeSlot24) {
					logger.warn('Auto Assignment: Could not parse time slot, skipping conflict checks', {
						timeSlot,
						service: 'allocation-service',
					});
				}

				// Check for schedule slot conflicts at the requested time slot
				// Note: schedule_slots table may not exist in all databases, so we wrap in try-catch
				if (timeSlot24) {
					try {
						const conflictCheck = await this.pool.query<{ count: number }>(
							`SELECT COUNT(*)::int AS count
							FROM schedule_slots
							WHERE trainer_id = $1
								AND timeslot = $2
								AND date >= $3
								AND date <= $4
								AND status IN ('booked', 'blocked')`,
							[trainer.trainer_id, timeSlot24, startDateForCheck, endDateForCheck]
						);

						const hasScheduleConflicts = (conflictCheck.rows[0]?.count || 0) > 0;
						if (hasScheduleConflicts) {
							logger.debug('Auto Assignment: Trainer has schedule slot conflicts, skipping', {
								trainerId: trainer.trainer_id,
								timeSlot,
								service: 'allocation-service',
							});
							continue;
						}
					} catch (error: any) {
						// If schedule_slots table doesn't exist, skip this check and continue
						// This is acceptable as allocation conflicts will still be checked
						if (error?.code === '42P01') {
							logger.debug('Auto Assignment: schedule_slots table not found, skipping schedule slot conflict check', {
								trainerId: trainer.trainer_id,
								service: 'allocation-service',
							});
						} else {
							throw error;
						}
					}
				}

				// Check for allocation conflicts at the requested time slot
				// Check both 24-hour format (scheduled_time) and AM/PM format (metadata timeSlot)
				const allocationConflictCheck = await this.pool.query<{ count: number }>(
					`SELECT COUNT(*)::int AS count
					FROM trainer_allocations ta
					INNER JOIN tutoring_sessions ts ON ta.id = ts.allocation_id
					WHERE ta.trainer_id = $1
						AND ta.student_id != $2
						AND ta.status IN ('approved', 'active')
						AND (
							($3::text IS NOT NULL AND ts.scheduled_time = $3::text)
							OR (
								ta.metadata IS NOT NULL
								AND ta.metadata->'schedule'->>'timeSlot' = $4
							)
						)
						AND ts.scheduled_date >= $5
						AND ts.scheduled_date <= $6
						AND ts.status NOT IN ('cancelled', 'completed')`,
					[trainer.trainer_id, studentId, timeSlot24 || null, timeSlot, startDateForCheck, endDateForCheck]
				);

				const hasAllocationConflicts = (allocationConflictCheck.rows[0]?.count || 0) > 0;
				if (hasAllocationConflicts) {
					logger.debug('Auto Assignment: Trainer has allocation conflicts, skipping', {
						trainerId: trainer.trainer_id,
						timeSlot,
						service: 'allocation-service',
					});
					continue;
				}

				// Check sequential time slot distance constraints if student has coordinates
				if (studentLatitude && studentLongitude) {
					// Check previous hour constraint
					if (previousHour24 && previousHourAmPm) {
						const previousHourStudents = await this.pool.query<{
							student_id: string;
							latitude: number | null;
							longitude: number | null;
						}>(
							`SELECT DISTINCT
								ta.student_id,
								sp.latitude,
								sp.longitude
							FROM trainer_allocations ta
							INNER JOIN tutoring_sessions ts ON ta.id = ts.allocation_id
							INNER JOIN student_profiles sp ON ta.student_id = sp.student_id
							WHERE ta.trainer_id = $1
								AND ta.status IN ('approved', 'active')
								AND (
									ts.scheduled_time = $2
									OR (
										ta.metadata IS NOT NULL
										AND ta.metadata->'schedule'->>'timeSlot' = $3
									)
								)
								AND ts.scheduled_date >= $4
								AND ts.scheduled_date <= $5
								AND ts.status NOT IN ('cancelled', 'completed')
								AND sp.latitude IS NOT NULL
								AND sp.longitude IS NOT NULL`,
							[trainer.trainer_id, previousHour24, previousHourAmPm, startDateForCheck, endDateForCheck]
						);

						if (previousHourStudents.rows.length > 0) {
							for (const prevStudent of previousHourStudents.rows) {
								if (prevStudent.latitude && prevStudent.longitude) {
									const distanceKm = calculateDistance(
										prevStudent.latitude,
										prevStudent.longitude,
										studentLatitude,
										studentLongitude
									);

									if (distanceKm > MAX_SEQUENTIAL_DISTANCE_KM) {
										passesDistanceCheck = false;
										logger.warn('Auto Assignment: Trainer has student at previous hour and new student exceeds distance limit', {
											trainerId: trainer.trainer_id,
											previousHour: previousHourAmPm || previousHour24,
											distanceKm: distanceKm.toFixed(2),
											maxDistanceKm: MAX_SEQUENTIAL_DISTANCE_KM,
											service: 'allocation-service',
										});
										break;
									}
								}
							}
						}
					}

					// Check next hour constraint
					if (passesDistanceCheck && nextHour24 && nextHourAmPm) {
						const nextHourStudents = await this.pool.query<{
							student_id: string;
							latitude: number | null;
							longitude: number | null;
						}>(
							`SELECT DISTINCT
								ta.student_id,
								sp.latitude,
								sp.longitude
							FROM trainer_allocations ta
							INNER JOIN tutoring_sessions ts ON ta.id = ts.allocation_id
							INNER JOIN student_profiles sp ON ta.student_id = sp.student_id
							WHERE ta.trainer_id = $1
								AND ta.status IN ('approved', 'active')
								AND (
									ts.scheduled_time = $2
									OR (
										ta.metadata IS NOT NULL
										AND ta.metadata->'schedule'->>'timeSlot' = $3
									)
								)
								AND ts.scheduled_date >= $4
								AND ts.scheduled_date <= $5
								AND ts.status NOT IN ('cancelled', 'completed')
								AND sp.latitude IS NOT NULL
								AND sp.longitude IS NOT NULL`,
							[trainer.trainer_id, nextHour24, nextHourAmPm, startDateForCheck, endDateForCheck]
						);

						if (nextHourStudents.rows.length > 0) {
							for (const nextStudent of nextHourStudents.rows) {
								if (nextStudent.latitude && nextStudent.longitude) {
									const distanceKm = calculateDistance(
										studentLatitude,
										studentLongitude,
										nextStudent.latitude,
										nextStudent.longitude
									);

									if (distanceKm > MAX_SEQUENTIAL_DISTANCE_KM) {
										passesDistanceCheck = false;
										logger.warn('Auto Assignment: Trainer has student at next hour and new student exceeds distance limit', {
											trainerId: trainer.trainer_id,
											nextHour: nextHourAmPm || nextHour24,
											distanceKm: distanceKm.toFixed(2),
											maxDistanceKm: MAX_SEQUENTIAL_DISTANCE_KM,
											service: 'allocation-service',
										});
										break;
									}
								}
							}
						}
					}
				}

				if (passesDistanceCheck) {
					eligibleTrainers.push({ trainer, passesDistanceCheck: true });
					logger.debug('Auto Assignment: Trainer passes all checks', {
						trainerId: trainer.trainer_id,
						hasCourseSpecialty: !!(courseCategory || courseSubcategory),
						hasGenderMatch: !!studentGender,
						timeSlot,
						currentAllocationCount,
						maxAllocationCount,
						service: 'allocation-service',
					});
				}
			}

			if (eligibleTrainers.length === 0) {
				// FALLBACK: If no trainers with rating 4.0+ passed checks (e.g., all at max capacity),
				// try to find highest-rated trainer below 4.0 who hasn't reached their max
				logger.warn('Auto Assignment: No trainers with rating 4.0+ passed all checks, attempting fallback', {
					studentId,
					courseId,
					service: 'allocation-service',
				});

				// Get all trainers (including below 4.0) who haven't reached their max allocation
				const fallbackTrainers = await this.pool.query<{
					trainer_id: string;
					gender: string | null;
					current_load: number;
					total_allocations: number;
					specialties: string[] | null;
					availability: any;
					years_of_experience: number | null;
					latitude: number | null;
					longitude: number | null;
					rating_average: number | null;
				}>(`
					SELECT 
						t.id as trainer_id,
						tp.gender,
						tp.availability,
						tp.specialties,
						tp.years_of_experience,
						tp.rating_average,
						tl.latitude,
						tl.longitude,
						(
							SELECT COUNT(*) 
							FROM trainer_allocations ta
							WHERE ta.trainer_id = t.id 
								AND ta.status IN ('approved', 'active')
								AND ta.metadata IS NOT NULL
								AND ta.metadata->'schedule'->>'timeSlot' = $1
						) as current_load,
						(
							SELECT COUNT(*) 
							FROM trainer_allocations ta
							WHERE ta.trainer_id = t.id 
								AND ta.status IN ('approved', 'active')
						) as total_allocations
					FROM trainers t
					INNER JOIN trainer_profiles tp ON t.id = tp.trainer_id
					LEFT JOIN trainer_locations tl ON t.id = tl.trainer_id
					LEFT JOIN trainer_availability tav ON t.id = tav.trainer_id
					WHERE t.approval_status = 'approved'
						AND (
							tp.gender IS NULL 
							OR $2::text IS NULL 
							OR LOWER(tp.gender) = LOWER($2::text)
						)
						AND (
							(
								tp.availability IS NOT NULL 
								AND tp.availability->'preferredTimeSlots' IS NOT NULL
								AND (
									SELECT COUNT(*) 
									FROM jsonb_array_elements_text(tp.availability->'preferredTimeSlots') AS slot
									WHERE UPPER(TRIM(REPLACE(slot, ' ', ' '))) = $3
									OR UPPER(TRIM(REPLACE(slot, ' ', ' '))) LIKE $3 || '%'
								) > 0
							)
							OR (
								$4::time IS NOT NULL
								AND tav.slot_start = $4::time
							)
						)
						AND (
							-- Only include trainers who haven't reached their max allocation
							-- Calculate max based on rating
							(
								SELECT COUNT(*) 
								FROM trainer_allocations ta
								WHERE ta.trainer_id = t.id 
									AND ta.status IN ('approved', 'active')
							) < CASE 
								WHEN COALESCE(tp.rating_average, 0) >= 4.6 THEN 8
								WHEN COALESCE(tp.rating_average, 0) >= 4.1 THEN 7
								WHEN COALESCE(tp.rating_average, 0) >= 3.6 THEN 6
								WHEN COALESCE(tp.rating_average, 0) >= 3.1 THEN 5
								WHEN COALESCE(tp.rating_average, 0) >= 2.1 THEN 4
								ELSE 3
							END
						)
					GROUP BY t.id, tp.gender, tp.availability, tp.specialties, tp.years_of_experience, tp.rating_average, tl.latitude, tl.longitude
					HAVING (
						(
							tp.availability IS NOT NULL 
							AND tp.availability->'preferredTimeSlots' IS NOT NULL
							AND (
								SELECT COUNT(*) 
								FROM jsonb_array_elements_text(tp.availability->'preferredTimeSlots') AS slot
								WHERE UPPER(TRIM(REPLACE(slot, ' ', ' '))) = $3
								OR UPPER(TRIM(REPLACE(slot, ' ', ' '))) LIKE $3 || '%'
							) > 0
						)
						OR (
							$4::time IS NOT NULL
							AND COUNT(DISTINCT tav.slot_start) FILTER (WHERE tav.slot_start = $4::time) > 0
						)
					)
					ORDER BY 
						CASE 
							WHEN (
								SELECT COUNT(*) 
								FROM trainer_allocations ta
								WHERE ta.trainer_id = t.id 
									AND ta.status IN ('approved', 'active')
							) < 4 THEN 0
							ELSE 1
						END,
						COALESCE(tp.rating_average, 0) DESC,
						current_load ASC,
						tp.years_of_experience DESC NULLS LAST
					LIMIT 10
				`, [timeSlot, studentGender, normalizedTimeSlot, timeSlotInTimeFormat]);

				if (fallbackTrainers.rows.length > 0) {
					logger.info('Auto Assignment: Fallback - Found trainers below 4.0 rating', {
						trainerCount: fallbackTrainers.rows.length,
						highestRating: fallbackTrainers.rows[0]?.rating_average || 0,
						service: 'allocation-service',
					});
					
					// Use the first fallback trainer (highest rated below 4.0)
					const fallbackTrainer = fallbackTrainers.rows[0];
					eligibleTrainers.push({ 
						trainer: fallbackTrainer, 
						passesDistanceCheck: true // Skip distance check for fallback
					});
				} else {
					logger.warn('Auto Assignment: No trainers passed all checks, creating pending allocation for manual review', {
						studentId,
						courseId,
						service: 'allocation-service',
					});
					// Create pending allocation for manual review (allows null trainer_id)
					return await this.allocationRepo.create({
						studentId,
						trainerId: null,
						courseId,
						requestedBy,
						notes: `Auto-assignment failed: No trainers passed all eligibility checks (specialty: ${courseCategory || courseSubcategory}, gender: ${studentGender}, timeSlot: ${timeSlot}). Manual assignment required.`,
						metadata: {
							schedule: { timeSlot, date },
							autoAssignmentAttempted: true,
							reason: 'no_eligible_trainers_after_checks',
							sessionCount,
						},
					});
				}
			}

			// 4. Select best trainer from eligible trainers (first in sorted list)
			const selectedTrainerData = eligibleTrainers[0];
			const selectedTrainer = selectedTrainerData.trainer;
			
			// Ensure we have a valid trainer_id
			if (!selectedTrainer || !selectedTrainer.trainer_id) {
				logger.error('Auto Assignment: Selected trainer is invalid, cannot create allocation without trainer_id', {
					eligibleTrainersCount: eligibleTrainers.length,
					selectedTrainer,
					studentId,
					courseId,
					service: 'allocation-service',
				});
				throw new AppError(
					'Auto-assignment failed: No valid trainer selected. Please try again or contact support.',
					500
				);
			}

			// 5. Check if trainer is not overloaded (max 5 students per time slot)
			const maxCapacity = 5;
			if (selectedTrainer.current_load >= maxCapacity) {
				// Trainer is full - try next trainer or create pending
				if (availableTrainers.rows.length > 1) {
					const nextTrainer = availableTrainers.rows[1];
					if (nextTrainer.current_load < maxCapacity) {
						const systemAdminId = await this.getSystemAdminId();
						
						const allocation = await this.allocateTrainer(
							studentId,
							nextTrainer.trainer_id,
							systemAdminId,
							{ courseId, notes: 'Auto-assigned by system (fallback to second choice)' }
						);
						
						// Update metadata with schedule and session count (sessionCount is already fetched above)
						await this.allocationRepo.update(
							allocation.id,
							{
								metadata: {
									schedule: { timeSlot, date },
									sessionCount, // Critical for session creation
									timeSlot,
									date,
									preferredTimeSlot: timeSlot,
									preferredDate: date,
									autoAssigned: true,
									assignedAt: new Date().toISOString(),
									matchingCriteria: {
										genderMatch: studentGender === nextTrainer.gender?.toLowerCase(),
										timeSlotMatch: true,
										workloadBalance: nextTrainer.current_load,
										fallbackUsed: true,
									},
								},
							},
							systemAdminId
						);
						
						logger.info('Auto Assignment: Assigned fallback trainer', {
							trainerId: nextTrainer.trainer_id,
							studentId,
							service: 'allocation-service',
						});
						return allocation;
					}
				}
				
				// All trainers are full - throw error instead of creating NULL trainer_id allocation
				logger.error('Auto Assignment: All trainers are at capacity', {
					maxCapacity,
					availableTrainersCount: availableTrainers.rows.length,
					studentId,
					courseId,
					service: 'allocation-service',
				});
				throw new AppError(
					`Auto-assignment failed: All available trainers are at capacity. Please try a different time slot or contact support.`,
					503 // Service Unavailable
				);
			}

			// 6. Get system admin ID for automated operations
			const systemAdminId = await this.getSystemAdminId();

			// 7. Prepare metadata with schedule, session count, and matching criteria
			// This metadata is critical for session creation
			// CRITICAL: Store startDate in multiple places for reliable retrieval
			const hasSpecialtyMatch = courseCategory && selectedTrainer.specialties
				? selectedTrainer.specialties.includes(courseCategory) || selectedTrainer.specialties.includes(courseSubcategory || '')
				: false;
			
			// Merge payment metadata so Class Format and Schedule show on learnings card (student-service reads allocation.metadata)
			const paymentSchedule = paymentMetadata?.schedule && typeof paymentMetadata.schedule === 'object'
				? (paymentMetadata.schedule as Record<string, unknown>)
				: {};
			const allocationMetadata = {
				schedule: {
					timeSlot,
					date,
					startDate: date,
					mode: paymentMetadata?.scheduleMode ?? paymentMetadata?.scheduleType ?? paymentSchedule.mode ?? 'everyday',
					...(typeof paymentSchedule === 'object' && paymentSchedule !== null ? paymentSchedule : {}),
				},
				sessionCount,
				timeSlot,
				date,
				startDate: date,
				preferredTimeSlot: timeSlot,
				preferredDate: date,
				autoAssigned: true,
				assignedAt: new Date().toISOString(),
				// Class Format / Schedule for learnings card (aggregation.service enrichAllocationForLearning)
				scheduleType: paymentMetadata?.scheduleType ?? paymentMetadata?.scheduleMode ?? (paymentSchedule.mode as string) ?? 'everyday',
				scheduleMode: paymentMetadata?.scheduleMode ?? paymentMetadata?.scheduleType ?? (paymentSchedule.mode as string) ?? 'everyday',
				groupSize: paymentMetadata?.groupSize ?? 1,
				learningMode: paymentMetadata?.learningMode ?? 'home',
				matchingCriteria: {
					genderMatch: studentGender === selectedTrainer.gender?.toLowerCase(),
					timeSlotMatch: true,
					workloadBalance: selectedTrainer.current_load,
					courseExpertiseMatch: hasSpecialtyMatch,
					specialtyFilterUsed: !usedFallback && (courseCategory || courseSubcategory),
					fallbackUsed: usedFallback,
					courseCategory,
					courseSubcategory,
					trainerSpecialties: selectedTrainer.specialties,
				},
			};

			// 8. Create and approve allocation automatically using allocateTrainer
			// allocateTrainer will create, approve, and trigger createInitialSession
			// Metadata is passed so createInitialSession has access to sessionCount
			// Build notes with specialty information
			const specialtyNote = usedFallback 
				? `⚠️ WARNING: No trainers with matching specialties found. Fallback allocation used.`
				: hasSpecialtyMatch
					? `Specialty match: ${courseCategory || courseSubcategory}`
					: `No specialty filter applied (course has no category/subcategory)`;
			
			logger.info('Auto Assignment: Assigning trainer to student', {
				trainerId: selectedTrainer.trainer_id,
				studentId,
				courseId,
				courseCategory,
				courseSubcategory,
				trainerSpecialties: selectedTrainer.specialties,
				hasSpecialtyMatch,
				usedFallback,
				timeSlot,
				date,
				sessionCount,
				service: 'allocation-service',
			});
			
			// CRITICAL: Verify trainer_id is valid before creating allocation
			if (!selectedTrainer.trainer_id) {
				logger.error('Auto Assignment: CRITICAL - Selected trainer has NULL trainer_id', {
					selectedTrainer,
					studentId,
					courseId,
					service: 'allocation-service',
				});
				throw new AppError(
					'Auto-assignment failed: Selected trainer has invalid ID. Please try again or contact support.',
					500
				);
			}

			const allocation = await this.allocateTrainer(
				studentId,
				selectedTrainer.trainer_id,
				systemAdminId,
				{
					courseId,
					notes: `Auto-assigned based on gender match (${studentGender}), time slot availability, workload balance. ${specialtyNote}`,
					metadata: allocationMetadata,
				}
			);
			
			// CRITICAL: Verify allocation was created with correct trainer_id
			if (!allocation.trainerId || allocation.trainerId !== selectedTrainer.trainer_id) {
				logger.error('Auto Assignment: CRITICAL - Allocation created with incorrect trainer_id', {
					allocationId: allocation.id,
					expectedTrainerId: selectedTrainer.trainer_id,
					actualTrainerId: allocation.trainerId,
					studentId: allocation.studentId,
					service: 'allocation-service',
					courseId: allocation.courseId,
				});
				throw new AppError(
					'Auto-assignment failed: Allocation created with invalid trainer ID. Please contact support.',
					500
				);
			}
			
			logger.info('Auto Assignment: Allocation created successfully', {
				allocationId: allocation.id,
				status: allocation.status,
				trainerId: allocation.trainerId,
				studentId: allocation.studentId,
				courseId: allocation.courseId,
				trainerIdMatch: allocation.trainerId === selectedTrainer.trainer_id,
			});

			// 9. Verify sessions were created (allocateTrainer should have created them with metadata)
			// If not, create them now as a fallback
			try {
				const existingSessions = await this.pool.query(
					'SELECT COUNT(*) as count FROM tutoring_sessions WHERE allocation_id = $1',
					[allocation.id]
				);
				const sessionsCount = parseInt(existingSessions.rows[0].count);

				logger.info('Auto Assignment: Session verification', {
					allocationId: allocation.id,
					sessionsCount,
					service: 'allocation-service',
				});

				if (sessionsCount === 0) {
					logger.info('Auto Assignment: Creating sessions for allocation (no sessions found after allocateTrainer)', {
						allocationId: allocation.id,
						sessionCount,
						timeSlot,
						date,
						hasMetadata: !!allocation.metadata,
					});
					
					await this.createInitialSession(allocation);

					// Final verification
					const finalCheck = await this.pool.query(
						'SELECT COUNT(*) as count FROM tutoring_sessions WHERE allocation_id = $1',
						[allocation.id]
					);
					const finalCount = parseInt(finalCheck.rows[0].count);
					logger.info('Auto Assignment: Final verification - sessions created', {
						finalCount,
						allocationId: allocation.id,
						service: 'allocation-service',
					});

					if (finalCount === 0) {
						logger.error('Auto Assignment: WARNING - No sessions were created despite successful call, may indicate GPS coordinates issue', {
							allocationId: allocation.id,
							studentId: allocation.studentId,
							service: 'allocation-service',
						});
						
						// Check GPS coordinates
						const studentProfile = await this.pool.query(
							'SELECT latitude, longitude, address FROM student_profiles WHERE student_id = $1',
							[allocation.studentId]
						);

						if (studentProfile.rows.length > 0) {
							const profile = studentProfile.rows[0];
							if (!profile.latitude || !profile.longitude) {
								logger.error('Auto Assignment: STUDENT GPS ISSUE - Student missing coordinates', {
									studentId: allocation.studentId,
									address: profile.address || 'not set',
									allocationId: allocation.id,
									service: 'allocation-service',
								});
							}
						}
					}
				} else {
					logger.info('Auto Assignment: Sessions already exist', {
						sessionsCount,
						allocationId: allocation.id,
						service: 'allocation-service',
					});
				}
			} catch (verifyError: any) {
				logger.error('Auto Assignment: Session verification/creation failed', {
					error: verifyError?.message || String(verifyError),
					stack: verifyError?.stack,
					allocationId: allocation.id,
					service: 'allocation-service',
				});

				// Log GPS coordinates issue if that's the problem
				const studentProfile = await this.pool.query(
					'SELECT latitude, longitude, address FROM student_profiles WHERE student_id = $1',
					[allocation.studentId]
				);

				if (studentProfile.rows.length > 0) {
					const profile = studentProfile.rows[0];
					if (!profile.latitude || !profile.longitude) {
						logger.error('Auto Assignment: STUDENT GPS ISSUE - Student missing coordinates', {
							studentId: allocation.studentId,
							address: profile.address || 'not set',
							allocationId: allocation.id,
							service: 'allocation-service',
						});
					}
				}

				// Don't throw - allow allocation to succeed even if session creation fails
				// Admin can manually create sessions later if needed
			}

			logger.info('Auto Assignment: Successfully assigned trainer to student', {
				trainerId: selectedTrainer.trainer_id,
				studentId,
				courseId,
				service: 'allocation-service',
			});

			return allocation;

			logger.info('Auto Assignment: Successfully assigned trainer to student', {
				trainerId: selectedTrainer.trainer_id,
				studentId,
				courseId,
				service: 'allocation-service',
			});

			// TODO: Send notifications to student and trainer
			// await notificationService.sendTrainerAssignedNotification(studentId, selectedTrainer.trainer_id);

			return allocation;
		} catch (error: any) {
			logger.error('Auto Assignment: Error during automatic assignment', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				studentId,
				courseId,
				service: 'allocation-service',
			});
			
			// Fallback: Create pending allocation for manual review
			return await this.allocationRepo.create({
				studentId,
				trainerId: null,
				courseId,
				requestedBy,
				notes: `Auto-assignment failed due to error: ${error.message}`,
				metadata: {
					schedule: { timeSlot, date },
					autoAssignmentAttempted: true,
					error: error.message,
				},
			});
		}
	}

	/**
	 * Check if trainers are available for a course before purchase
	 * This prevents purchases when no trainers can teach the course
	 */
	async checkTrainerAvailabilityForCourse(
		courseId: string,
		timeSlot?: string
	): Promise<{
		available: boolean;
		availableTrainersCount: number;
		message: string;
		courseCategory?: string | null;
		courseSubcategory?: string | null;
	}> {
		try {
			// Get course details for expertise matching
			const courseDetails = await this.pool.query<{
				id: string;
				category: string | null;
				subcategory: string | null;
			}>(`
				SELECT id, category, subcategory
				FROM courses
				WHERE id = $1
			`, [courseId]);

			if (courseDetails.rows.length === 0) {
				return {
					available: false,
					availableTrainersCount: 0,
					message: 'Course not found',
				};
			}

			const rawCategory = courseDetails.rows[0]?.category || null;
			const rawSubcategory = courseDetails.rows[0]?.subcategory || null;

			// Normalize course category/subcategory to match trainer application course names
			const normalizeCourseName = (category: string | null): string | null => {
				if (!category) return null;
				const normalized = category.trim();
				const lowerNormalized = normalized.toLowerCase();
				
				// Map variations to trainer course names (case-insensitive)
				if (lowerNormalized.includes('app') && (lowerNormalized.includes('making') || lowerNormalized.includes('development'))) {
					return 'App Making';
				}
				if (lowerNormalized.includes('video') && (lowerNormalized.includes('making') || lowerNormalized.includes('editing'))) {
					return 'Video Making';
				}
				// Handle coding variations
				if (lowerNormalized.includes('coding') || lowerNormalized.includes('programming') || 
				    lowerNormalized.includes('computer science') || lowerNormalized.includes('cs')) {
					return 'Coding';
				}
				// Handle AI variations - normalize "Artificial Intelligence" to "AI"
				if (lowerNormalized.includes('artificial intelligence') || lowerNormalized === 'ai') {
					return 'AI';
				}
				// Handle Robotics variations
				if (lowerNormalized.includes('robotic') || lowerNormalized === 'robotics') {
					return 'Robotics';
				}
				// Direct matches
				if (['ai', 'robotics', 'coding'].includes(lowerNormalized)) {
					return normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
				}
				return normalized;
			};

			const courseCategory = normalizeCourseName(rawCategory);
			const courseSubcategory = normalizeCourseName(rawSubcategory);

			// Build query to check for trainers with matching specialty
			let query = `
				SELECT COUNT(DISTINCT t.id)::int as trainer_count
				FROM trainers t
				INNER JOIN trainer_profiles tp ON t.id = tp.trainer_id
				WHERE t.approval_status = 'approved'
			`;

			const queryParams: any[] = [];
			let paramIndex = 1;

			// Add specialty filter if course has category
			// Use normalized values and handle aliases (e.g., "AI" matches "Artificial Intelligence", "Artifical Intellegence", etc.)
			if (courseCategory || courseSubcategory) {
				const specialtyConditions: string[] = [];
				
				// Collect all normalized specialty values to match
				const specialtyValues: string[] = [];
				if (courseCategory) specialtyValues.push(courseCategory);
				if (courseSubcategory) specialtyValues.push(courseSubcategory);
				
				// Remove duplicates
				const uniqueSpecialtyValues = [...new Set(specialtyValues)];
				
				// For each normalized specialty value, check if it matches trainer specialties
				// Handle aliases: "AI" should match "AI", "Artificial Intelligence", "Artifical Intellegence", etc.
				for (const specialtyValue of uniqueSpecialtyValues) {
					const lowerSpecialty = specialtyValue.toLowerCase();
					
					if (lowerSpecialty === 'ai') {
						// AI can match: "AI", "Artificial Intelligence", "Artifical Intellegence" (typo), etc.
						specialtyConditions.push(`EXISTS (
							SELECT 1 FROM unnest(tp.specialties) AS specialty
							WHERE (
								LOWER(TRIM(specialty)) = 'ai'
								OR LOWER(TRIM(specialty)) LIKE '%artificial intelligence%'
								OR LOWER(TRIM(specialty)) LIKE '%artifical intellegence%'
								OR LOWER(TRIM(specialty)) LIKE '%artifical intelligence%'
							)
						)`);
					} else {
						// For other specialties, do exact match (case-insensitive)
						specialtyConditions.push(`EXISTS (
							SELECT 1 FROM unnest(tp.specialties) AS specialty
							WHERE LOWER(TRIM(specialty)) = LOWER(TRIM($${paramIndex}::text))
						)`);
						queryParams.push(specialtyValue);
						paramIndex++;
					}
				}
				
				if (specialtyConditions.length > 0) {
					query += ` AND (
						tp.specialties IS NOT NULL 
						AND (${specialtyConditions.join(' OR ')})
					)`;
				}
			}

			// Add time slot filter if provided
			if (timeSlot) {
				const normalizedTimeSlot = timeSlot.trim().replace(/\s+/g, ' ').toUpperCase();
				
				// Convert time slot to TIME format
				const timeSlotMatch = normalizedTimeSlot.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/);
				let timeSlotInTimeFormat: string | null = null;
				if (timeSlotMatch) {
					let hour = parseInt(timeSlotMatch[1], 10);
					const minutes = timeSlotMatch[2];
					const period = timeSlotMatch[3];
					
					if (period === 'PM' && hour !== 12) {
						hour += 12;
					} else if (period === 'AM' && hour === 12) {
						hour = 0;
					}
					
					timeSlotInTimeFormat = `${hour.toString().padStart(2, '0')}:${minutes}:00`;
				}

				// Build time slot filter - check BOTH JSONB availability AND trainer_availability table
				// This matches the logic used in getAllAvailableTimeSlots and autoAssignTrainerAfterPurchase
				let timeSlotFilter = `(
					-- Check JSONB preferredTimeSlots
					(
						tp.availability IS NOT NULL 
						AND tp.availability->'preferredTimeSlots' IS NOT NULL
						AND (
							SELECT COUNT(*) 
							FROM jsonb_array_elements_text(tp.availability->'preferredTimeSlots') AS slot
							WHERE UPPER(TRIM(REPLACE(slot, ' ', ' '))) = $${paramIndex}
							OR UPPER(TRIM(REPLACE(slot, ' ', ' '))) LIKE $${paramIndex} || '%'
						) > 0
					)`;
				
				// Also check trainer_availability table if time slot is in TIME format
				if (timeSlotInTimeFormat) {
					timeSlotFilter += `
					OR (
						-- Check trainer_availability table (TIME format: 12:00:00)
						EXISTS (
							SELECT 1 FROM trainer_availability tav
							WHERE tav.trainer_id = t.id
							AND tav.slot_start = $${paramIndex + 1}::time
						)
					)`;
					queryParams.push(normalizedTimeSlot, timeSlotInTimeFormat);
					paramIndex += 2;
				} else {
					queryParams.push(normalizedTimeSlot);
					paramIndex++;
				}
				
				timeSlotFilter += `)`;
				
				query += ` AND ${timeSlotFilter}`;
			}

			// Log query for debugging (only in non-production)
			if (process.env.NODE_ENV !== 'production') {
				logger.debug('Checking trainer availability query', {
					query: query.substring(0, 500),
					paramCount: queryParams.length,
					params: queryParams,
					courseId,
					timeSlot,
					courseCategory,
					courseSubcategory,
					service: 'allocation-service',
				});
			}

			let result;
			try {
				result = await this.pool.query<{ trainer_count: number }>(query, queryParams);
			} catch (sqlError: any) {
				logger.error('SQL query error', {
					error: sqlError.message,
					code: sqlError.code,
					detail: sqlError.detail,
					position: sqlError.position,
					query: query.substring(0, 500),
					params: queryParams,
					service: 'allocation-service',
				});
				throw sqlError; // Re-throw to be caught by outer catch
			}
			
			const availableTrainersCount = result.rows[0]?.trainer_count || 0;

			if (availableTrainersCount === 0) {
				const courseName = rawCategory || courseSubcategory || 'this course';
				
				// Log demand signal for analytics (non-blocking)
				// This helps track demand even when purchases are blocked
				// Note: We don't have userId here, so we'll log it when the frontend calls
				// The frontend will call logPurchaseBlocked with userId after receiving this response
				logger.info('No trainers available for course, demand signal will be logged by frontend', {
					courseId,
					courseCategory: rawCategory,
					courseSubcategory,
					service: 'allocation-service',
				});
				
				return {
					available: false,
					availableTrainersCount: 0,
					message: `No trainers are currently available for ${courseName}. Please contact support or try again later.`,
					courseCategory: rawCategory,
					courseSubcategory,
				};
			}

			return {
				available: true,
				availableTrainersCount,
				message: `${availableTrainersCount} trainer(s) available for this course`,
				courseCategory: rawCategory,
				courseSubcategory,
			};
		} catch (error: any) {
			// Log detailed error information
			logger.error('Error checking trainer availability for course', {
				error: error.message,
				stack: error.stack,
				courseId,
				timeSlot,
				errorCode: error.code,
				errorDetail: error.detail,
				errorPosition: error.position,
				errorHint: error.hint,
				errorName: error.name,
				service: 'allocation-service',
			});
			
			// Return unavailable to prevent purchases with uncertain trainer availability
			// This is safer than throwing - we don't want to block the entire request
			return {
				available: false,
				availableTrainersCount: 0,
				message: 'Unable to verify trainer availability. Please try again or contact support.',
			};
		}
	}
}

