/**
 * Trainer Assignment Service
 * Handles trainer selection and assignment logic
 */

import { SessionBookingRepository, type SessionBooking } from '../models/sessionBooking.model';
import { ScheduleSlotRepository } from '../models/scheduleSlot.model';
import { ClusterRepository } from '../models/cluster.model';
import { calculateDistance, type Coordinates } from '../utils/distance';
import type { Pool, PoolClient } from 'pg';

export interface TrainerCandidate {
	id: string;
	latitude: number;
	longitude: number;
	clusterId: string | null;
	isActive: boolean;
	currentLoad?: number; // Number of active bookings
}

export interface TrainerAssignmentResult {
	success: boolean;
	trainerId: string | null;
	booking: SessionBooking | null;
	message: string;
}

export class TrainerAssignmentService {
	constructor(
		private readonly bookingRepo: SessionBookingRepository,
		private readonly scheduleSlotRepo: ScheduleSlotRepository,
		private readonly clusterRepo: ClusterRepository,
		private readonly pool: Pool
	) {}

	/**
	 * Get available trainers for a booking
	 */
	async getAvailableTrainers(
		studentLocation: Coordinates,
		courseId: string,
		timeslot: string,
		startDate: Date,
		sessionCount: number,
		getTrainerCandidates: () => Promise<TrainerCandidate[]>
	): Promise<TrainerCandidate[]> {
		// Step 1: Get all trainer candidates
		const allTrainers = await getTrainerCandidates();

		// Step 2: Filter by distance (max 5km)
		const trainersWithin5km = allTrainers
			.map((trainer) => ({
				...trainer,
				distance: calculateDistance(studentLocation, {
					latitude: trainer.latitude,
					longitude: trainer.longitude,
				}),
			}))
			.filter((trainer) => trainer.distance <= 5)
			.sort((a, b) => a.distance - b.distance); // Sort by distance

		// Step 3: Check for timeslot conflicts
		const availableTrainers: TrainerCandidate[] = [];

		for (const trainer of trainersWithin5km) {
			const hasConflict = await this.scheduleSlotRepo.checkConflicts(
				trainer.id,
				timeslot,
				startDate,
				sessionCount
			);

			if (!hasConflict) {
				availableTrainers.push(trainer);
			}
		}

		return availableTrainers;
	}

	/**
	 * Select best trainer using priority algorithm
	 */
	selectBestTrainer(trainers: TrainerCandidate[]): TrainerCandidate | null {
		if (trainers.length === 0) {
			return null;
		}

		// Priority 1: Trainers within 3km (HIGH PRIORITY)
		const trainersWithin3km = trainers.filter((t) => (t as any).distance <= 3);

		if (trainersWithin3km.length > 0) {
			// Among 3km trainers, pick the one with least load
			return trainersWithin3km.sort((a, b) => (a.currentLoad || 0) - (b.currentLoad || 0))[0] ?? null;
		}

		// Priority 2: Trainers within 3-5km (SECONDARY PRIORITY)
		const trainers3to5km = trainers.filter((t) => (t as any).distance > 3 && (t as any).distance <= 5);

		if (trainers3to5km.length > 0) {
			// Among 3-5km trainers, pick the one with least load
			return trainers3to5km.sort((a, b) => (a.currentLoad || 0) - (b.currentLoad || 0))[0] ?? null;
		}

		// Fallback: Return first trainer (shouldn't happen due to 5km filter)
		return trainers[0] ?? null;
	}

	/**
	 * Assign trainer to a booking
	 */
	async assignTrainer(
		bookingId: string,
		getTrainerCandidates: () => Promise<TrainerCandidate[]>
	): Promise<TrainerAssignmentResult> {
		// Get booking
		const booking = await this.bookingRepo.findById(bookingId);
		if (!booking) {
			return {
				success: false,
				trainerId: null,
				booking: null,
				message: 'Booking not found',
			};
		}

		if (booking.trainerId) {
			return {
				success: true,
				trainerId: booking.trainerId,
				booking,
				message: 'Trainer already assigned',
			};
		}

		// Detect cluster
		let clusterId = booking.clusterId;
		if (!clusterId) {
			const nearestCluster = await this.clusterRepo.findNearestCluster(
				booking.latitude,
				booking.longitude
			);
			if (nearestCluster) {
				clusterId = nearestCluster.id;
				await this.bookingRepo.update(bookingId, { clusterId });
			}
		}

		// Get available trainers
		const studentLocation: Coordinates = {
			latitude: booking.latitude,
			longitude: booking.longitude,
		};

		const availableTrainers = await this.getAvailableTrainers(
			studentLocation,
			booking.courseId,
			booking.timeslot,
			booking.startDate,
			booking.sessionCount,
			getTrainerCandidates
		);

		if (availableTrainers.length === 0) {
			return {
				success: false,
				trainerId: null,
				booking,
				message: 'No available trainers found within 5km radius',
			};
		}

		// Select best trainer
		const selectedTrainer = this.selectBestTrainer(availableTrainers);

		if (!selectedTrainer) {
			return {
				success: false,
				trainerId: null,
				booking,
				message: 'Failed to select trainer',
			};
		}

		// Assign trainer and lock schedule slots
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');

			// Update booking
			const updatedBooking = await this.bookingRepo.update(
				bookingId,
				{
					trainerId: selectedTrainer.id,
					clusterId,
					status: 'confirmed',
				},
				client
			);

			// Lock schedule slots
			await this.scheduleSlotRepo.lockSlots(
				selectedTrainer.id,
				bookingId,
				booking.timeslot,
				booking.startDate,
				booking.sessionCount,
				client
			);

			await client.query('COMMIT');

			return {
				success: true,
				trainerId: selectedTrainer.id,
				booking: updatedBooking,
				message: 'Trainer assigned successfully',
			};
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}
}

