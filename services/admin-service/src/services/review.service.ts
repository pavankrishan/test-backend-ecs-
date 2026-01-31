import { AppError } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';
import { getPool } from '../config/database';
import { SessionReviewRepository, type CreateReviewInput, type ReviewType, type SessionReviewRecord } from '../models/sessionReview.model';
import { SessionRepository } from '../models/session.model';

export class ReviewService {
	private reviewRepo: SessionReviewRepository;
	private sessionRepo: SessionRepository;
	private pool = getPool();

	constructor() {
		this.reviewRepo = new SessionReviewRepository(this.pool);
		this.sessionRepo = new SessionRepository(this.pool);
	}

	/**
	 * Submit a review for a session
	 */
	async submitReview(input: CreateReviewInput): Promise<SessionReviewRecord> {
		// Validate rating (allow 0.5 increments)
		if (input.rating < 0.5 || input.rating > 5) {
			throw new AppError('Rating must be between 0.5 and 5.0', 400);
		}
		// Ensure rating is in 0.5 increments
		const roundedRating = Math.round(input.rating * 2) / 2;
		if (Math.abs(roundedRating - input.rating) > 0.01) {
			throw new AppError('Rating must be in 0.5 increments (0.5, 1.0, 1.5, etc.)', 400);
		}

		// Verify session exists and is completed
		const session = await this.sessionRepo.findById(input.sessionId);
		if (!session) {
			throw new AppError('Session not found', 404);
		}

		if (session.status !== 'completed') {
			throw new AppError('Can only review completed sessions', 400);
		}

		// Verify session belongs to the correct student/trainer
		if (input.reviewType === 'student' && session.studentId !== input.studentId) {
			throw new AppError('Session does not belong to this student', 403);
		}

		if (input.reviewType === 'trainer' && session.trainerId !== input.trainerId) {
			throw new AppError('Session does not belong to this trainer', 403);
		}

		// Create or update review
		const review = await this.reviewRepo.create(input);

		// If this is a student review, update trainer rating
		if (input.reviewType === 'student') {
			await this.updateTrainerRating(input.trainerId);
		}

		logger.info('Review submitted successfully', {
			service: 'admin-service',
			reviewId: review.id,
			sessionId: input.sessionId,
			reviewType: input.reviewType,
			rating: input.rating,
		});

		return review;
	}

	/**
	 * Get reviews for a session
	 */
	async getSessionReviews(sessionId: string): Promise<SessionReviewRecord[]> {
		return await this.reviewRepo.findBySessionId(sessionId);
	}

	/**
	 * Get reviews for a trainer (student reviews)
	 */
	async getTrainerReviews(trainerId: string, limit?: number, offset?: number): Promise<SessionReviewRecord[]> {
		return await this.reviewRepo.findByTrainerId(trainerId, limit, offset);
	}

	/**
	 * Get trainer rating statistics
	 */
	async getTrainerRatingStats(trainerId: string): Promise<{
		averageRating: number;
		totalReviews: number;
		ratingDistribution: { rating: number; count: number }[];
	}> {
		return await this.reviewRepo.getTrainerRatingStats(trainerId);
	}

	/**
	 * Get reviews for a student (trainer reviews)
	 */
	async getStudentReviews(studentId: string, limit?: number, offset?: number): Promise<SessionReviewRecord[]> {
		return await this.reviewRepo.findByStudentId(studentId, limit, offset);
	}

	/**
	 * Get review for a session by type
	 */
	async getReviewBySessionAndType(sessionId: string, reviewType: ReviewType): Promise<SessionReviewRecord | null> {
		return await this.reviewRepo.findBySessionAndType(sessionId, reviewType);
	}

	/**
	 * Get session info for review submission (helper method)
	 */
	async getSessionInfo(sessionId: string): Promise<{ trainerId: string; courseId: string | null } | null> {
		const session = await this.sessionRepo.findById(sessionId);
		if (!session) {
			return null;
		}
		return {
			trainerId: session.trainerId,
			courseId: session.courseId,
		};
	}

	/**
	 * Update trainer rating average based on all student reviews
	 */
	private async updateTrainerRating(trainerId: string): Promise<void> {
		try {
			const stats = await this.reviewRepo.getTrainerRatingStats(trainerId);

			// Update trainer profile with new rating directly via SQL
			await this.pool.query(
				`
					UPDATE trainer_profiles
					SET 
						rating_average = $1,
						rating_count = $2,
						updated_at = NOW()
					WHERE trainer_id = $3
				`,
				[stats.averageRating, stats.totalReviews, trainerId]
			);

			logger.info('Trainer rating updated', {
				service: 'admin-service',
				trainerId,
				averageRating: stats.averageRating,
				totalReviews: stats.totalReviews,
			});
		} catch (error: any) {
			logger.error('Error updating trainer rating', {
				service: 'admin-service',
				trainerId,
				error: error.message,
			});
			// Don't throw - rating update failure shouldn't block review submission
		}
	}
}

