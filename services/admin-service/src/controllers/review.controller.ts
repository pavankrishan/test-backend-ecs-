import { Request, Response } from 'express';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import { ReviewService } from '../services/review.service';
import { z } from 'zod';

const reviewService = new ReviewService();

const submitReviewSchema = z.object({
	rating: z.number().min(0.5).max(5).multipleOf(0.5), // Allow 0.5 increments
	feedback: z.string().optional().nullable(),
	satisfied: z.boolean().optional().nullable(), // For student reviews only
});

export class ReviewController {
	/**
	 * Submit a student review for a session
	 * POST /api/v1/students/sessions/:sessionId/review
	 */
	static submitStudentReview = asyncHandler(async (req: Request, res: Response) => {
		const { sessionId } = req.params;
		const studentId = (req as any).studentId || (req as any).userId;

		if (!studentId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Student authentication required',
			});
		}

		const body = submitReviewSchema.parse(req.body);

		// Get session info to extract trainerId and courseId
		const sessionInfo = await reviewService.getSessionInfo(sessionId);
		
		if (!sessionInfo) {
			return errorResponse(res, {
				statusCode: 404,
				message: 'Session not found',
			});
		}

		const review = await reviewService.submitReview({
			sessionId,
			studentId,
			trainerId: sessionInfo.trainerId,
			courseId: sessionInfo.courseId,
			reviewType: 'student',
			rating: body.rating,
			feedback: body.feedback || null,
			satisfied: body.satisfied ?? null,
		});

		return successResponse(res, {
			statusCode: 201,
			message: 'Review submitted successfully',
			data: review,
		});
	});

	/**
	 * Submit a trainer review for a session
	 * POST /api/v1/students/:studentId/courses/:courseId/sessions/:sessionId/review
	 */
	static submitTrainerReview = asyncHandler(async (req: Request, res: Response) => {
		const { studentId, courseId, sessionId } = req.params;
		const trainerId = (req as any).trainerId || (req as any).userId;

		if (!trainerId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Trainer authentication required',
			});
		}

		const body = z.object({
			rating: z.number().min(0.5).max(5).multipleOf(0.5), // Allow 0.5 increments
			review: z.string().optional().nullable(),
		}).parse(req.body);

		const review = await reviewService.submitReview({
			sessionId,
			studentId,
			trainerId,
			courseId: courseId || null,
			reviewType: 'trainer',
			rating: body.rating,
			feedback: body.review || null,
			satisfied: null, // Not applicable for trainer reviews
		});

		return successResponse(res, {
			statusCode: 201,
			message: 'Review submitted successfully',
			data: review,
		});
	});

	/**
	 * Get reviews for a session
	 * GET /api/v1/sessions/:sessionId/reviews
	 */
	static getSessionReviews = asyncHandler(async (req: Request, res: Response) => {
		const { sessionId } = req.params;

		const reviews = await reviewService.getSessionReviews(sessionId);

		return successResponse(res, {
			message: 'Reviews retrieved successfully',
			data: reviews,
		});
	});

	/**
	 * Get reviews for a trainer
	 * GET /api/v1/trainers/:trainerId/reviews
	 */
	static getTrainerReviews = asyncHandler(async (req: Request, res: Response) => {
		const { trainerId } = req.params;
		const { limit, offset } = req.query;

		const reviews = await reviewService.getTrainerReviews(
			trainerId,
			limit ? parseInt(limit as string, 10) : undefined,
			offset ? parseInt(offset as string, 10) : undefined
		);

		return successResponse(res, {
			message: 'Reviews retrieved successfully',
			data: reviews,
		});
	});

	/**
	 * Get trainer rating statistics
	 * GET /api/v1/trainers/:trainerId/rating-stats
	 */
	static getTrainerRatingStats = asyncHandler(async (req: Request, res: Response) => {
		const { trainerId } = req.params;

		const stats = await reviewService.getTrainerRatingStats(trainerId);

		return successResponse(res, {
			message: 'Rating statistics retrieved successfully',
			data: stats,
		});
	});

	/**
	 * Get reviews for a student (trainer reviews)
	 * GET /api/v1/students/:studentId/reviews
	 */
	static getStudentReviews = asyncHandler(async (req: Request, res: Response) => {
		const { studentId } = req.params;
		const { limit, offset } = req.query;

		const reviews = await reviewService.getStudentReviews(
			studentId,
			limit ? parseInt(limit as string, 10) : undefined,
			offset ? parseInt(offset as string, 10) : undefined
		);

		return successResponse(res, {
			message: 'Reviews retrieved successfully',
			data: reviews,
		});
	});
}

