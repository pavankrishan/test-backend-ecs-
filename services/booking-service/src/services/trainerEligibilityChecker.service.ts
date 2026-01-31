/**
 * Trainer Eligibility Checker Service
 * Checks if trainers meet all eligibility criteria for assignment
 */

import type { Pool, PoolClient } from 'pg';
import { calculateDistance, type Coordinates } from '../utils/distance';
import { ScheduleSlotRepository } from '../models/scheduleSlot.model';
import type { PurchaseSessionCreateInput } from '../models/purchaseSession.model';

export interface TrainerInfo {
	id: string;
	isActive: boolean;
	franchiseId: string | null;
	zoneId: string | null;
	certifiedCourses: string[]; // Array of course IDs the trainer is certified for
	location?: {
		latitude: number;
		longitude: number;
	};
}

export interface EligibilityCheckResult {
	isEligible: boolean;
	reasons: string[];
}

export class TrainerEligibilityCheckerService {
	constructor(
		private readonly scheduleSlotRepo: ScheduleSlotRepository,
		private readonly pool: Pool
	) {}

	/**
	 * Check if a trainer is eligible for a booking
	 * 
	 * @param zoneOperator - 'COMPANY' if zone.franchise_id is NULL, 'FRANCHISE' otherwise
	 * @param zoneFranchiseId - The franchise_id of the zone (null for COMPANY-operated zones)
	 * @param client - Optional transaction client for consistent reads
	 */
	async checkEligibility(
		trainer: TrainerInfo,
		courseId: string,
		zoneOperator: 'COMPANY' | 'FRANCHISE',
		zoneFranchiseId: string | null,
		zoneId: string | null,
		sessions: PurchaseSessionCreateInput[],
		studentLocation: Coordinates,
		zoneRadiusKm?: number,
		client?: PoolClient
	): Promise<EligibilityCheckResult> {
		const reasons: string[] = [];

		// Check 1: Trainer must be active
		if (!trainer.isActive) {
			reasons.push('Trainer is not active');
		}

		// Check 2: Trainer must belong to same operator (COMPANY or FRANCHISE) for offline sessions
		// Note: Online sessions ignore operator/zone rules
		const hasOfflineSessions = sessions.some(s => s.sessionType === 'offline');
		if (hasOfflineSessions) {
			// Determine trainer's operator
			const trainerOperator = trainer.franchiseId === null ? 'COMPANY' : 'FRANCHISE';
			
			// Operators must match
			if (trainerOperator !== zoneOperator) {
				reasons.push(
					`Trainer operator (${trainerOperator}) does not match zone operator (${zoneOperator})`
				);
			}

			// If both are FRANCHISE, franchise IDs must match
			if (zoneOperator === 'FRANCHISE' && trainer.franchiseId !== zoneFranchiseId) {
				reasons.push('Trainer does not belong to the same franchise');
			}

			// Check 3: Trainer must belong to same zone (for offline sessions)
			if (!zoneId || trainer.zoneId !== zoneId) {
				reasons.push('Trainer does not belong to the same zone');
			}

			// Check 4: Travel feasibility for offline sessions
			if (trainer.location && zoneRadiusKm) {
				const distance = calculateDistance(studentLocation, trainer.location);
				if (distance > zoneRadiusKm) {
					reasons.push(`Trainer is too far from student location (${distance.toFixed(2)}km > ${zoneRadiusKm}km)`);
				}
			}
		}

		// Check 5: Trainer must be certified for the course
		if (!trainer.certifiedCourses.includes(courseId)) {
			reasons.push('Trainer is not certified for this course');
		}

		// Check 6: Trainer must have ≤ 3 certified courses
		if (trainer.certifiedCourses.length > 3) {
			reasons.push(`Trainer has more than 3 certified courses (${trainer.certifiedCourses.length})`);
		}

		// Check 7: Trainer must be available for ALL generated sessions
		const availabilityCheck = await this.checkAvailability(trainer.id, sessions, client);
		if (!availabilityCheck.isAvailable) {
			reasons.push(...availabilityCheck.conflicts);
		}

		return {
			isEligible: reasons.length === 0,
			reasons,
		};
	}

	/**
	 * Check if trainer is available for all sessions
	 */
	private async checkAvailability(
		trainerId: string,
		sessions: PurchaseSessionCreateInput[],
		client?: PoolClient
	): Promise<{ isAvailable: boolean; conflicts: string[] }> {
		const conflicts: string[] = [];

		// Check each session individually for conflicts
		for (const session of sessions) {
			const sessionDate = new Date(session.sessionDate);
			sessionDate.setHours(0, 0, 0, 0);
			const nextDay = new Date(sessionDate);
			nextDay.setDate(nextDay.getDate() + 1);

			// Check if there's a booked/blocked slot for this exact date and time
			const result = await (client || this.pool).query<{ count: number }>(
				`
					SELECT COUNT(*)::int AS count
					FROM schedule_slots
					WHERE trainer_id = $1
						AND date = $2
						AND timeslot = $3
						AND status IN ('booked', 'blocked')
				`,
				[trainerId, sessionDate, session.sessionTime]
			);

			if ((result.rows[0]?.count ?? 0) > 0) {
				conflicts.push(
					`Trainer has conflict on ${session.sessionDate.toISOString().split('T')[0]} at ${session.sessionTime}`
				);
			}
		}

		return {
			isAvailable: conflicts.length === 0,
			conflicts,
		};
	}

	/**
	 * Filter eligible trainers from a list
	 * 
	 * @param zoneOperator - 'COMPANY' if zone.franchise_id is NULL, 'FRANCHISE' otherwise
	 * @param zoneFranchiseId - The franchise_id of the zone (null for COMPANY-operated zones)
	 * @param client - Optional transaction client for consistent reads
	 */
	async filterEligibleTrainers(
		trainers: TrainerInfo[],
		courseId: string,
		zoneOperator: 'COMPANY' | 'FRANCHISE',
		zoneFranchiseId: string | null,
		zoneId: string | null,
		sessions: PurchaseSessionCreateInput[],
		studentLocation: Coordinates,
		zoneRadiusKm?: number,
		client?: PoolClient
	): Promise<Array<{ trainer: TrainerInfo; eligibility: EligibilityCheckResult }>> {
		const results = await Promise.all(
			trainers.map(async (trainer) => {
				const eligibility = await this.checkEligibility(
					trainer,
					courseId,
					zoneOperator,
					zoneFranchiseId,
					zoneId,
					sessions,
					studentLocation,
					zoneRadiusKm,
					client
				);
				return { trainer, eligibility };
			})
		);

		return results.filter((result) => result.eligibility.isEligible);
	}
}

