import { Request, Response } from 'express';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import { DemandTrackingService } from '../services/demandTracking.service';
import { z } from 'zod';

const demandTrackingService = new DemandTrackingService();

const registerWaitlistSchema = z.object({
	courseId: z.string().uuid(),
	metadata: z.record(z.any()).optional().nullable(),
});

const getAnalyticsSchema = z.object({
	courseId: z.string().uuid().optional(),
	cityId: z.string().uuid().optional().nullable(),
	startDate: z.string().optional(),
	endDate: z.string().optional(),
});

export class DemandTrackingController {
	/**
	 * Register user for waitlist
	 * POST /api/v1/admin/demand/waitlist
	 */
	static registerWaitlist = asyncHandler(async (req: Request, res: Response) => {
		const userId = (req as any).user?.id || (req as any).userId;
		
		if (!userId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'User authentication required',
			});
		}

		const body = registerWaitlistSchema.parse(req.body);
		
		// Check if user is already on waitlist
		const alreadyOnWaitlist = await demandTrackingService.isUserOnWaitlist(
			body.courseId,
			userId
		);

		if (alreadyOnWaitlist) {
			return successResponse(res, {
				message: 'You are already on the waitlist for this course',
				data: { alreadyRegistered: true },
			});
		}

		const signal = await demandTrackingService.registerWaitlist(
			body.courseId,
			userId,
			body.metadata || undefined
		);

		return successResponse(res, {
			statusCode: 201,
			message: 'Successfully added to waitlist',
			data: {
				id: signal.id,
				courseId: signal.courseId,
				registeredAt: signal.createdAt,
			},
		});
	});

	/**
	 * Log purchase blocked demand signal
	 * POST /api/v1/admin/demand/purchase-blocked
	 */
	static logPurchaseBlocked = asyncHandler(async (req: Request, res: Response) => {
		const userId = (req as any).user?.id || (req as any).userId;
		
		if (!userId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'User authentication required',
			});
		}

		const body = z.object({
			courseId: z.string().uuid(),
			reason: z.string().optional(),
			metadata: z.record(z.any()).optional().nullable(),
		}).parse(req.body);

		const signal = await demandTrackingService.logPurchaseBlocked(
			body.courseId,
			userId,
			body.reason || 'NO_TRAINER_AVAILABLE',
			body.metadata || undefined
		);

		return successResponse(res, {
			statusCode: 201,
			message: 'Demand signal logged',
			data: {
				id: signal.id,
				courseId: signal.courseId,
				loggedAt: signal.createdAt,
			},
		});
	});

	/**
	 * Get demand analytics for a course
	 * GET /api/v1/admin/demand/analytics
	 */
	static getAnalytics = asyncHandler(async (req: Request, res: Response) => {
		const adminId = (req as any).adminId || (req as any).userId;
		
		if (!adminId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Admin authentication required',
			});
		}

		const query = getAnalyticsSchema.parse(req.query);
		
		const startDate = query.startDate ? new Date(query.startDate) : undefined;
		const endDate = query.endDate ? new Date(query.endDate) : undefined;

		if (query.courseId) {
			// Get analytics for specific course
			const analytics = await demandTrackingService.getCourseDemandAnalytics(
				query.courseId,
				startDate,
				endDate,
				query.cityId || undefined
			);

			return successResponse(res, {
				message: 'Demand analytics retrieved successfully',
				data: analytics,
			});
		} else {
			// Get analytics for all courses
			const analytics = await demandTrackingService.getAllCoursesDemandAnalytics(
				startDate,
				endDate,
				query.cityId || undefined
			);

			return successResponse(res, {
				message: 'Demand analytics retrieved successfully',
				data: { courses: analytics },
			});
		}
	});

	/**
	 * Check if user is on waitlist
	 * GET /api/v1/admin/demand/waitlist/check
	 */
	static checkWaitlist = asyncHandler(async (req: Request, res: Response) => {
		const userId = (req as any).user?.id || (req as any).userId;
		
		if (!userId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'User authentication required',
			});
		}

		const { courseId } = z.object({
			courseId: z.string().uuid(),
		}).parse(req.query);

		const isOnWaitlist = await demandTrackingService.isUserOnWaitlist(courseId, userId);

		return successResponse(res, {
			message: 'Waitlist status retrieved',
			data: {
				courseId,
				isOnWaitlist,
			},
		});
	});
}
