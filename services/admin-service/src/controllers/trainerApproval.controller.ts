import { Request, Response } from 'express';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import { trainerApprovalService } from '../services/trainerApproval.service';

export class TrainerApprovalController {
	/**
	 * Get all trainers filtered by approval status
	 * GET /api/v1/admin/trainers/approvals?status=pending&limit=10&offset=0&includeProfile=true
	 */
	static getTrainersByStatus = asyncHandler(async (req: Request, res: Response) => {
		const { status } = req.query;
		const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
		const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
		const includeProfile = req.query.includeProfile === 'true';

		if (!status || !['pending', 'approved', 'rejected'].includes(status as string)) {
			return errorResponse(res, {
				statusCode: 400,
				message: 'Invalid status. Must be one of: pending, approved, rejected',
			});
		}

		const trainers = await trainerApprovalService.getTrainersByStatus(
			status as 'pending' | 'approved' | 'rejected',
			{ limit, offset, includeProfile }
		);

		return successResponse(res, {
			message: `Trainers with status '${status}' retrieved successfully`,
			data: trainers,
		});
	});

	/**
	 * Get a single trainer by ID
	 * GET /api/v1/admin/trainers/approvals/:trainerId?includeProfile=true
	 */
	static getTrainerById = asyncHandler(async (req: Request, res: Response) => {
		const { trainerId } = req.params;
		const includeProfile = req.query.includeProfile !== 'false'; // Default to true

		const trainer = await trainerApprovalService.getTrainerById(trainerId, includeProfile);

		return successResponse(res, {
			message: 'Trainer retrieved successfully',
			data: trainer,
		});
	});

	/**
	 * Approve a trainer application
	 * POST /api/v1/admin/trainers/approvals/:trainerId/approve
	 */
	static approveTrainer = asyncHandler(async (req: Request, res: Response) => {
		const { trainerId } = req.params;
		const adminId = (req as any).adminId;

		if (!adminId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Admin authentication required',
			});
		}

		const trainer = await trainerApprovalService.approveTrainer(trainerId, adminId);

		return successResponse(res, {
			message: 'Trainer application approved successfully',
			data: trainer,
		});
	});

	/**
	 * Reject a trainer application
	 * POST /api/v1/admin/trainers/approvals/:trainerId/reject
	 */
	static rejectTrainer = asyncHandler(async (req: Request, res: Response) => {
		const { trainerId } = req.params;
		const { reason } = req.body;
		const adminId = (req as any).adminId;

		if (!adminId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Admin authentication required',
			});
		}

		const trainer = await trainerApprovalService.rejectTrainer(trainerId, adminId, reason);

		return successResponse(res, {
			message: 'Trainer application rejected successfully',
			data: trainer,
		});
	});

	/**
	 * Get approval statistics
	 * GET /api/v1/admin/trainers/approvals/statistics
	 */
	static getStatistics = asyncHandler(async (_req: Request, res: Response) => {
		const stats = await trainerApprovalService.getApprovalStatistics();

		return successResponse(res, {
			message: 'Trainer approval statistics retrieved successfully',
			data: stats,
		});
	});
}

