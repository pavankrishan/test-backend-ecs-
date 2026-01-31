/**
 * Auto Trainer Assignment Service
 * Main service for automatically assigning trainers to course purchases
 */

import type { Pool, PoolClient } from 'pg';
import logger from '@kodingcaravan/shared/config/logger';
import { CoursePurchaseRepository, type CoursePurchase, type CoursePurchaseCreateInput } from '../models/coursePurchase.model';
import { PurchaseSessionRepository } from '../models/purchaseSession.model';
import { ScheduleSlotRepository } from '../models/scheduleSlot.model';
import { ZoneRepository, getZoneOperator, type ZoneOperator } from '../models/zone.model';
import { FranchiseRepository } from '../models/franchise.model';
import { CertificateRepository } from '../models/certificate.model';
import { SessionScheduleGeneratorService } from './sessionScheduleGenerator.service';
import { PurchaseValidatorService } from './purchaseValidator.service';
import { TrainerEligibilityCheckerService, type TrainerInfo } from './trainerEligibilityChecker.service';
import { SessionSyncService } from './sessionSync.service';
import { calculateDistance } from '../utils/distance';

export type AssignmentResult = 'ASSIGNED' | 'WAITLISTED' | 'SERVICE_NOT_AVAILABLE' | 'INVALID_PURCHASE';

export interface AutoAssignmentInput {
	bookingId: string;
	courseId: string;
	classType: 'ONE_ON_ONE' | 'ONE_ON_TWO' | 'ONE_ON_THREE' | 'HYBRID';
	totalSessions: 10 | 20 | 30;
	deliveryMode: 'WEEKDAY_DAILY' | 'SUNDAY_ONLY';
	startDate: Date;
	preferredTimeSlot: string;
	studentLocation: {
		latitude: number;
		longitude: number;
	};
	students: Array<{
		id: string;
		name: string;
		email?: string;
		phone?: string;
	}>;
}

export interface AutoAssignmentOutput {
	result: AssignmentResult;
	purchaseId?: string;
	trainerId?: string | null;
	message: string;
}

/**
 * Function type for fetching trainers from external service
 * 
 * @param filters.franchiseId - null for COMPANY-operated zones, franchise ID for FRANCHISE-operated zones
 */
export type FetchTrainersFunction = (filters: {
	franchiseId?: string | null; // null = COMPANY, non-null = FRANCHISE
	zoneId?: string | null;
	courseId: string;
	isActive?: boolean;
}) => Promise<TrainerInfo[]>;

export class AutoTrainerAssignmentService {
	private sessionSyncService: SessionSyncService;

	constructor(
		private readonly purchaseRepo: CoursePurchaseRepository,
		private readonly sessionRepo: PurchaseSessionRepository,
		private readonly scheduleSlotRepo: ScheduleSlotRepository,
		private readonly zoneRepo: ZoneRepository,
		private readonly franchiseRepo: FranchiseRepository,
		private readonly certificateRepo: CertificateRepository,
		private readonly scheduleGenerator: SessionScheduleGeneratorService,
		private readonly validator: PurchaseValidatorService,
		private readonly eligibilityChecker: TrainerEligibilityCheckerService,
		private readonly pool: Pool
	) {
		this.sessionSyncService = new SessionSyncService(pool);
	}

	/**
	 * Main entry point for auto trainer assignment
	 */
	async assignTrainer(
		input: AutoAssignmentInput,
		fetchTrainers: FetchTrainersFunction
	): Promise<AutoAssignmentOutput> {
		// Step 1: Validate purchase
		const validation = this.validator.validatePurchase(
			input.classType,
			input.totalSessions,
			input.deliveryMode,
			input.students
		);

		if (!validation.isValid) {
			// Create purchase record with INVALID_PURCHASE status
			const purchase = await this.purchaseRepo.create({
				bookingId: input.bookingId,
				courseId: input.courseId,
				classType: input.classType,
				totalSessions: input.totalSessions,
				deliveryMode: input.deliveryMode,
				startDate: input.startDate,
				preferredTimeSlot: input.preferredTimeSlot,
				studentLocation: input.studentLocation,
				students: input.students,
				status: 'INVALID_PURCHASE',
			});

			return {
				result: 'INVALID_PURCHASE',
				purchaseId: purchase.id,
				message: validation.message || 'Invalid purchase combination',
			};
		}

		// Step 2: Determine zone and operator (COMPANY or FRANCHISE)
		const zoneInfo = await this.determineZoneAndOperator(
			input.studentLocation.latitude,
			input.studentLocation.longitude
		);

		if (!zoneInfo.zoneId) {
			// Create purchase record with SERVICE_NOT_AVAILABLE status
			const purchase = await this.purchaseRepo.create({
				bookingId: input.bookingId,
				courseId: input.courseId,
				classType: input.classType,
				totalSessions: input.totalSessions,
				deliveryMode: input.deliveryMode,
				startDate: input.startDate,
				preferredTimeSlot: input.preferredTimeSlot,
				studentLocation: input.studentLocation,
				students: input.students,
				franchiseId: zoneInfo.zoneFranchiseId,
				zoneId: zoneInfo.zoneId,
				status: 'SERVICE_NOT_AVAILABLE',
			});

			return {
				result: 'SERVICE_NOT_AVAILABLE',
				purchaseId: purchase.id,
				message: 'Service not available at this location',
			};
		}

		const { zoneId, zoneFranchiseId, zoneOperator, zoneRadiusKm } = zoneInfo;

		// Step 3: Generate session schedule
		// Note: purchaseId is temporary, will be replaced with actual purchase ID after creation
		const schedule = this.scheduleGenerator.generateSchedule(
			'temp', // Will be replaced with actual purchase ID
			input.bookingId,
			input.classType,
			input.totalSessions,
			input.deliveryMode,
			input.startDate,
			input.preferredTimeSlot
		);

		// Validate schedule was generated correctly
		if (schedule.sessions.length !== input.totalSessions) {
			throw new Error(
				`Schedule generation mismatch: Expected ${input.totalSessions} sessions, got ${schedule.sessions.length}`
			);
		}

		// Step 4: Fetch eligible trainers
		// Pass zoneFranchiseId (null for COMPANY, franchise ID for FRANCHISE)
		const allTrainers = await fetchTrainers({
			franchiseId: zoneFranchiseId, // null for COMPANY-operated zones
			zoneId,
			courseId: input.courseId,
			isActive: true,
		});

		// Step 5: Filter eligible trainers (before transaction to avoid long-running transactions)
		// Pass zone operator info for proper matching
		// Note: Availability checks will be re-verified inside transaction
		const eligibleTrainers = await this.eligibilityChecker.filterEligibleTrainers(
			allTrainers,
			input.courseId,
			zoneOperator,
			zoneFranchiseId,
			zoneId,
			schedule.sessions,
			input.studentLocation,
			zoneRadiusKm
		);

		// Step 6: Select best trainer (prioritize by distance for offline sessions)
		const selectedTrainer = this.selectBestTrainer(
			eligibleTrainers.map(e => e.trainer),
			input.studentLocation,
			schedule.sessions
		);

		// Step 7: Create purchase and assign trainer (or waitlist)
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');

			// Re-verify trainer availability within transaction to prevent race conditions
			let finalSelectedTrainer = selectedTrainer;
			if (selectedTrainer) {
				const finalEligibilityCheck = await this.eligibilityChecker.filterEligibleTrainers(
					[selectedTrainer],
					input.courseId,
					zoneOperator,
					zoneFranchiseId,
					zoneId,
					schedule.sessions,
					input.studentLocation,
					zoneRadiusKm,
					client // Use transaction client for consistent reads
				);

				if (finalEligibilityCheck.length === 0) {
					// Trainer became unavailable, fall back to waitlist
					finalSelectedTrainer = null;
				}
			}

			const purchase = await this.purchaseRepo.create({
				bookingId: input.bookingId,
				courseId: input.courseId,
				classType: input.classType,
				totalSessions: input.totalSessions,
				deliveryMode: input.deliveryMode,
				startDate: input.startDate,
				preferredTimeSlot: input.preferredTimeSlot,
				studentLocation: input.studentLocation,
				students: input.students,
				franchiseId: zoneFranchiseId, // null for COMPANY-operated zones
				zoneId,
				trainerId: finalSelectedTrainer?.id || null,
				status: finalSelectedTrainer ? 'ASSIGNED' : 'WAITLISTED',
			}, client);

			// Update session schedule with actual purchase ID
			const sessionsWithPurchaseId = schedule.sessions.map(s => ({
				...s,
				purchaseId: purchase.id,
			}));

			// Step 8: Create session records
			const createdPurchaseSessions = await this.sessionRepo.createMany(sessionsWithPurchaseId, client);

			// Step 8.5: Sync sessions to tutoring_sessions table (for frontend visibility)
			if (finalSelectedTrainer && createdPurchaseSessions.length > 0) {
				try {
					const syncResult = await this.sessionSyncService.syncPurchaseSessionsToTutoringSessions(
						purchase,
						createdPurchaseSessions,
						finalSelectedTrainer.id,
						client
					);
					
					if (!syncResult.success || syncResult.errors.length > 0) {
						logger.warn('Session sync had errors', {
							purchaseId: purchase.id,
							sessionsCreated: syncResult.sessionsCreated,
							sessionsUpdated: syncResult.sessionsUpdated,
							errorsCount: syncResult.errors.length,
							errors: syncResult.errors,
							service: 'booking-service',
						});
						// Don't throw - sync failure shouldn't break assignment
						// Sessions can be synced manually or via background job later
					} else {
						logger.info('Synced sessions to tutoring_sessions table', {
							sessionsCreated: syncResult.sessionsCreated,
							purchaseId: purchase.id,
							trainerId: finalSelectedTrainer?.id,
							service: 'booking-service',
						});
					}
				} catch (syncError: any) {
					logger.error('Failed to sync sessions to tutoring_sessions', {
						purchaseId: purchase.id,
						error: syncError?.message || String(syncError),
						stack: syncError?.stack,
						trainerId: finalSelectedTrainer?.id,
						service: 'booking-service',
					});
					// Don't throw - sync failure shouldn't break assignment
					// Log error but continue with transaction
				}
			}

			// Step 9: Lock trainer availability if assigned
			if (finalSelectedTrainer) {
				for (const session of schedule.sessions) {
					try {
						await this.scheduleSlotRepo.create({
							trainerId: finalSelectedTrainer.id,
							bookingId: input.bookingId,
							date: session.sessionDate,
							timeslot: session.sessionTime,
							status: 'booked',
						}, client);
					} catch (error: any) {
						// Handle unique constraint violation (trainer already booked for this slot)
						if (error.code === '23505' || error.message?.includes('unique constraint')) {
							// Trainer became unavailable between eligibility check and assignment
							// Roll back and waitlist the booking
							throw new Error(
								`Trainer ${finalSelectedTrainer.id} is no longer available for ${session.sessionDate.toISOString().split('T')[0]} at ${session.sessionTime}. Booking waitlisted.`
							);
						}
						throw error;
					}
				}
			}

			// Step 10: Certificate generation removed from assignment flow
			// Certificates should be generated by a background job after all 30 sessions are completed.
			// See: certificateGeneration.service.ts for the certificate generation service.
			// This ensures certificates are only issued after course completion.

			await client.query('COMMIT');

			return {
				result: finalSelectedTrainer ? 'ASSIGNED' : 'WAITLISTED',
				purchaseId: purchase.id,
				trainerId: finalSelectedTrainer?.id || null,
				message: finalSelectedTrainer
					? 'Trainer assigned successfully'
					: 'No eligible trainer available, booking waitlisted',
			};
		} catch (error) {
			await client.query('ROLLBACK');
			logger.error('Failed to assign trainer', {
				bookingId: input.bookingId,
				courseId: input.courseId,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				service: 'booking-service',
			});
			throw error;
		} finally {
			client.release();
		}
	}

	/**
	 * Determine zone and operator (COMPANY or FRANCHISE) for a location
	 * 
	 * Ownership Rule:
	 * - If zone.franchise_id is NULL → COMPANY-operated
	 * - If zone.franchise_id is set → FRANCHISE-operated
	 * - Assignment logic works identically for both ownership types
	 */
	private async determineZoneAndOperator(
		latitude: number,
		longitude: number
	): Promise<{
		zoneId: string | null;
		zoneFranchiseId: string | null; // null for COMPANY, franchise ID for FRANCHISE
		zoneOperator: ZoneOperator;
		zoneRadiusKm?: number;
	}> {
		// Find zones containing this location
		const zones = await this.zoneRepo.findZonesContainingLocation(latitude, longitude);

		if (zones.length === 0) {
			return {
				zoneId: null,
				zoneFranchiseId: null,
				zoneOperator: 'COMPANY',
			};
		}

		// Use the first (nearest) zone
		const zone = zones[0];
		if (!zone) {
			return {
				zoneId: null,
				zoneFranchiseId: null,
				zoneOperator: 'COMPANY',
			};
		}

		const zoneOperator = getZoneOperator(zone);

		return {
			zoneId: zone.id,
			zoneFranchiseId: zone.franchiseId, // null for COMPANY, franchise ID for FRANCHISE
			zoneOperator,
			zoneRadiusKm: zone.radiusKm,
		};
	}

	/**
	 * Select best trainer from eligible trainers
	 * Priority: distance (for offline sessions), then load balancing
	 */
	private selectBestTrainer(
		trainers: TrainerInfo[],
		studentLocation: { latitude: number; longitude: number },
		sessions: Array<{ sessionType: 'offline' | 'online' }>
	): TrainerInfo | null {
		if (trainers.length === 0) {
			return null;
		}

		// If only one trainer, return it
		if (trainers.length === 1) {
			return trainers[0] || null;
		}

		// For offline sessions, prioritize by distance
		const hasOfflineSessions = sessions.some(s => s.sessionType === 'offline');
		if (hasOfflineSessions) {
			// Calculate distances and sort
			const trainersWithDistance = trainers
				.filter(t => t.location)
				.map(trainer => ({
					trainer,
					distance: calculateDistance(studentLocation, trainer.location!),
				}))
				.sort((a, b) => a.distance - b.distance);

			if (trainersWithDistance.length > 0 && trainersWithDistance[0]) {
				return trainersWithDistance[0].trainer;
			}
		}

		// Fallback: return first trainer
		return trainers[0] || null;
	}

}

