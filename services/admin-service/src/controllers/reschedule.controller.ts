import { Request, Response } from 'express';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import { RescheduleService } from '../services/reschedule.service';
import { z } from 'zod';

const rescheduleService = new RescheduleService();

const createRescheduleSchema = z.object({
	sessionId: z.string().uuid(),
	allocationId: z.string().uuid(),
	studentId: z.string().uuid(),
	trainerId: z.string().uuid(),
	requestedBy: z.string().uuid(),
	requestType: z.enum(['student', 'trainer']),
	originalDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
	originalTime: z.string(),
	newDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
	newTime: z.string(),
	reason: z.string().min(1),
	notes: z.string().optional().nullable(),
	metadata: z.record(z.any()).optional().nullable(),
});

const approveRescheduleSchema = z.object({
	// No body needed, approval is implicit
});

const rejectRescheduleSchema = z.object({
	rejectionReason: z.string().min(1),
});

const updateRescheduleSchema = z.object({
	newDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
	newTime: z.string().optional(),
	reason: z.string().optional(),
	notes: z.string().optional().nullable(),
	metadata: z.record(z.any()).optional().nullable(),
});

export class RescheduleController {
	/**
	 * Create a reschedule request
	 * POST /api/v1/admin/reschedule
	 */
	static create = asyncHandler(async (req: Request, res: Response) => {
		const body = createRescheduleSchema.parse(req.body);

		const reschedule = await rescheduleService.createReschedule({
			...body,
			originalDate: new Date(body.originalDate),
			newDate: new Date(body.newDate),
		});

		return successResponse(res, {
			statusCode: 201,
			message: 'Reschedule request created successfully',
			data: reschedule,
		});
	});

	/**
	 * Approve reschedule request
	 * POST /api/v1/admin/reschedule/:id/approve
	 */
	static approve = asyncHandler(async (req: Request, res: Response) => {
		const { id } = req.params;
		const adminId = (req as any).adminId || (req as any).userId;

		if (!adminId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Admin authentication required',
			});
		}

		const result = await rescheduleService.approveReschedule(id, adminId);

		return successResponse(res, {
			message: 'Reschedule request approved successfully',
			data: result,
		});
	});

	/**
	 * Reject reschedule request
	 * POST /api/v1/admin/reschedule/:id/reject
	 */
	static reject = asyncHandler(async (req: Request, res: Response) => {
		const { id } = req.params;
		const body = rejectRescheduleSchema.parse(req.body);
		const adminId = (req as any).adminId || (req as any).userId;

		if (!adminId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Admin authentication required',
			});
		}

		const reschedule = await rescheduleService.rejectReschedule(id, adminId, body.rejectionReason);

		return successResponse(res, {
			message: 'Reschedule request rejected successfully',
			data: reschedule,
		});
	});

	/**
	 * Update reschedule request
	 * PUT /api/v1/admin/reschedule/:id
	 */
	static update = asyncHandler(async (req: Request, res: Response) => {
		const { id } = req.params;
		const body = updateRescheduleSchema.parse(req.body);
		const requesterId = (req as any).studentId || (req as any).trainerId || (req as any).userId;

		if (!requesterId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Authentication required',
			});
		}

		const updates: any = {};
		if (body.newDate) updates.newDate = new Date(body.newDate);
		if (body.newTime) updates.newTime = body.newTime;
		if (body.reason) updates.reason = body.reason;
		if (body.notes !== undefined) updates.notes = body.notes;
		if (body.metadata) updates.metadata = body.metadata;

		const reschedule = await rescheduleService.updateReschedule(id, updates, requesterId);

		return successResponse(res, {
			message: 'Reschedule request updated successfully',
			data: reschedule,
		});
	});

	/**
	 * Get reschedule by ID
	 * GET /api/v1/admin/reschedule/:id
	 */
	static getById = asyncHandler(async (req: Request, res: Response) => {
		const { id } = req.params;

		const reschedule = await rescheduleService.getReschedule(id);
		if (!reschedule) {
			return errorResponse(res, {
				statusCode: 404,
				message: 'Reschedule request not found',
			});
		}

		return successResponse(res, {
			message: 'Reschedule request retrieved successfully',
			data: reschedule,
		});
	});

	/**
	 * Get all reschedule requests
	 * GET /api/v1/admin/reschedule
	 */
	static getAll = asyncHandler(async (req: Request, res: Response) => {
		const { status, studentId, trainerId, sessionId, limit, offset } = req.query;

		const reschedules = await rescheduleService.getAllReschedules({
			status: status as any,
			studentId: studentId as string,
			trainerId: trainerId as string,
			sessionId: sessionId as string,
			limit: limit ? parseInt(limit as string, 10) : undefined,
			offset: offset ? parseInt(offset as string, 10) : undefined,
		});

		return successResponse(res, {
			message: 'Reschedule requests retrieved successfully',
			data: reschedules,
		});
	});

	/**
	 * Get reschedules for a session
	 * GET /api/v1/admin/reschedule/session/:sessionId
	 */
	static getBySession = asyncHandler(async (req: Request, res: Response) => {
		const { sessionId } = req.params;

		const reschedules = await rescheduleService.getSessionReschedules(sessionId);

		return successResponse(res, {
			message: 'Session reschedules retrieved successfully',
			data: reschedules,
		});
	});

	/**
	 * Cancel reschedule request
	 * POST /api/v1/admin/reschedule/:id/cancel
	 */
	static cancel = asyncHandler(async (req: Request, res: Response) => {
		const { id } = req.params;
		const requesterId = (req as any).studentId || (req as any).trainerId || (req as any).userId;

		if (!requesterId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Authentication required',
			});
		}

		const reschedule = await rescheduleService.cancelReschedule(id, requesterId);

		return successResponse(res, {
			message: 'Reschedule request cancelled successfully',
			data: reschedule,
		});
	});
}



