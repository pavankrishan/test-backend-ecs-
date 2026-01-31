import { AppError } from '@kodingcaravan/shared';
import { getPool } from '../config/database';
import {
	TrainerRescheduleRepository,
	type TrainerRescheduleRecord,
	type CreateRescheduleInput,
	type UpdateRescheduleInput,
	type RescheduleStatus,
} from '../models/trainerReschedule.model';
import { SessionRepository } from '../models/session.model';

export class RescheduleService {
	private rescheduleRepo: TrainerRescheduleRepository;
	private sessionRepo: SessionRepository;
	private pool = getPool();

	constructor() {
		this.rescheduleRepo = new TrainerRescheduleRepository(this.pool);
		this.sessionRepo = new SessionRepository(this.pool);
	}

	/**
	 * Create a reschedule request
	 */
	async createReschedule(input: CreateRescheduleInput): Promise<TrainerRescheduleRecord> {
		// Validate session exists
		const session = await this.sessionRepo.findById(input.sessionId);
		if (!session) {
			throw new AppError('Session not found', 404);
		}

		// Validate that the requester owns the session
		if (input.requestType === 'student' && session.studentId !== input.requestedBy) {
			throw new AppError('Unauthorized: You do not own this session', 403);
		}

		if (input.requestType === 'trainer' && session.trainerId !== input.requestedBy) {
			throw new AppError('Unauthorized: You do not own this session', 403);
		}

		// Validate new date is in the future
		const newDateTime = new Date(`${input.newDate}T${input.newTime}`);
		if (newDateTime <= new Date()) {
			throw new AppError('New date and time must be in the future', 400);
		}

		// Check if there's already a pending reschedule for this session
		const existing = await this.rescheduleRepo.findAll({
			sessionId: input.sessionId,
			status: 'pending',
			limit: 1,
		});

		if (existing.length > 0) {
			throw new AppError('A pending reschedule request already exists for this session', 400);
		}

		const reschedule = await this.rescheduleRepo.create(input);

		// TODO: Send notification to admin, student, and trainer

		return reschedule;
	}

	/**
	 * Approve reschedule request
	 */
	async approveReschedule(
		rescheduleId: string,
		adminId: string
	): Promise<{ reschedule: TrainerRescheduleRecord; sessionUpdated: boolean }> {
		const reschedule = await this.rescheduleRepo.findById(rescheduleId);
		if (!reschedule) {
			throw new AppError('Reschedule request not found', 404);
		}

		if (reschedule.status !== 'pending') {
			throw new AppError(`Cannot approve reschedule with status: ${reschedule.status}`, 400);
		}

		// Update reschedule status
		const updated = await this.rescheduleRepo.update(
			rescheduleId,
			{
				status: 'approved',
			},
			adminId
		);

		if (!updated) {
			throw new AppError('Failed to approve reschedule', 500);
		}

		// Update the session with new date/time
		const session = await this.sessionRepo.findById(reschedule.sessionId);
		if (session) {
			// Note: We need to update the session's scheduled_date and scheduled_time
			// Since SessionRepository doesn't have an update method for date/time,
			// we'll need to add that or use raw SQL
			// For now, we'll use raw SQL
			await this.pool.query(
				`
					UPDATE tutoring_sessions
					SET scheduled_date = $1,
						scheduled_time = $2,
						updated_at = NOW()
					WHERE id = $3
				`,
				[reschedule.newDate, reschedule.newTime, reschedule.sessionId]
			);
		}

		// TODO: Send notification to student and trainer

		return {
			reschedule: updated,
			sessionUpdated: !!session,
		};
	}

	/**
	 * Reject reschedule request
	 */
	async rejectReschedule(
		rescheduleId: string,
		adminId: string,
		rejectionReason: string
	): Promise<TrainerRescheduleRecord> {
		const reschedule = await this.rescheduleRepo.findById(rescheduleId);
		if (!reschedule) {
			throw new AppError('Reschedule request not found', 404);
		}

		if (reschedule.status !== 'pending') {
			throw new AppError(`Cannot reject reschedule with status: ${reschedule.status}`, 400);
		}

		const updated = await this.rescheduleRepo.update(
			rescheduleId,
			{
				status: 'rejected',
				rejectionReason,
			},
			adminId
		);

		if (!updated) {
			throw new AppError('Failed to reject reschedule', 500);
		}

		// TODO: Send notification to requester

		return updated;
	}

	/**
	 * Update reschedule request (by requester before admin review)
	 */
	async updateReschedule(
		rescheduleId: string,
		updates: UpdateRescheduleInput,
		requesterId: string
	): Promise<TrainerRescheduleRecord> {
		const reschedule = await this.rescheduleRepo.findById(rescheduleId);
		if (!reschedule) {
			throw new AppError('Reschedule request not found', 404);
		}

		// Only allow updates if status is pending
		if (reschedule.status !== 'pending') {
			throw new AppError(`Cannot update reschedule with status: ${reschedule.status}`, 400);
		}

		// Verify requester owns this reschedule
		if (reschedule.requestedBy !== requesterId) {
			throw new AppError('Unauthorized: You do not own this reschedule request', 403);
		}

		// Validate new date if provided
		if (updates.newDate && updates.newTime) {
			const newDateTime = new Date(`${updates.newDate}T${updates.newTime}`);
			if (newDateTime <= new Date()) {
				throw new AppError('New date and time must be in the future', 400);
			}
		}

		const updated = await this.rescheduleRepo.update(rescheduleId, updates);

		if (!updated) {
			throw new AppError('Failed to update reschedule', 500);
		}

		return updated;
	}

	/**
	 * Get reschedule by ID
	 */
	async getReschedule(rescheduleId: string): Promise<TrainerRescheduleRecord | null> {
		return this.rescheduleRepo.findById(rescheduleId);
	}

	/**
	 * Get all reschedule requests with filters
	 */
	async getAllReschedules(filters?: {
		status?: RescheduleStatus;
		studentId?: string;
		trainerId?: string;
		sessionId?: string;
		limit?: number;
		offset?: number;
	}): Promise<TrainerRescheduleRecord[]> {
		return this.rescheduleRepo.findAll(filters);
	}

	/**
	 * Get reschedules for a session
	 */
	async getSessionReschedules(sessionId: string): Promise<TrainerRescheduleRecord[]> {
		return this.rescheduleRepo.findBySessionId(sessionId);
	}

	/**
	 * Cancel reschedule request (by requester)
	 */
	async cancelReschedule(rescheduleId: string, requesterId: string): Promise<TrainerRescheduleRecord> {
		const reschedule = await this.rescheduleRepo.findById(rescheduleId);
		if (!reschedule) {
			throw new AppError('Reschedule request not found', 404);
		}

		if (reschedule.status !== 'pending') {
			throw new AppError(`Cannot cancel reschedule with status: ${reschedule.status}`, 400);
		}

		// Verify requester owns this reschedule
		if (reschedule.requestedBy !== requesterId) {
			throw new AppError('Unauthorized: You do not own this reschedule request', 403);
		}

		const updated = await this.rescheduleRepo.update(rescheduleId, {
			status: 'cancelled',
		});

		if (!updated) {
			throw new AppError('Failed to cancel reschedule', 500);
		}

		return updated;
	}
}



