import { Request, Response, NextFunction } from 'express';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import logger from '@kodingcaravan/shared/config/logger';
import { getPool } from '../config/database';
import { z } from 'zod';

const initiateCallSchema = z.object({
	trainerId: z.string().uuid(),
	studentId: z.string().uuid(),
	sessionId: z.string().uuid().optional().nullable(),
	callerRole: z.enum(['trainer', 'student']),
});

/**
 * Initiate a call between trainer and student
 * POST /api/v1/admin/calls/initiate
 */
export const initiateCall = asyncHandler(
	async (req: Request, res: Response, next: NextFunction) => {
		const userId = (req as any).user?.id;
		const userRole = (req as any).user?.role;

		if (!userId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Unauthorized',
			});
		}

		// Validate request body
		const validationResult = initiateCallSchema.safeParse(req.body);
		if (!validationResult.success) {
			return errorResponse(res, {
				statusCode: 400,
				message: 'Invalid request data',
				errors: validationResult.error.errors,
			});
		}

		const { trainerId, studentId, sessionId, callerRole } = validationResult.data;

		// Verify user has permission to initiate call
		if (userRole === 'trainer' && userId !== trainerId) {
			return errorResponse(res, {
				statusCode: 403,
				message: 'Unauthorized: You can only initiate calls as yourself',
			});
		}
		if (userRole === 'student' && userId !== studentId) {
			return errorResponse(res, {
				statusCode: 403,
				message: 'Unauthorized: You can only initiate calls as yourself',
			});
		}

		// Fetch phone numbers from database
		const pool = getPool();
		
		// Get trainer phone
		const trainerResult = await pool.query(
			`SELECT phone FROM trainers WHERE id = $1`,
			[trainerId]
		);
		if (trainerResult.rows.length === 0) {
			return errorResponse(res, {
				statusCode: 404,
				message: 'Trainer not found',
			});
		}
		const trainerPhone = trainerResult.rows[0].phone;
		if (!trainerPhone) {
			return errorResponse(res, {
				statusCode: 400,
				message: 'Trainer phone number not found',
			});
		}

		// Get student phone
		const studentResult = await pool.query(
			`SELECT phone FROM students WHERE id = $1`,
			[studentId]
		);
		if (studentResult.rows.length === 0) {
			return errorResponse(res, {
				statusCode: 404,
				message: 'Student not found',
			});
		}
		const studentPhone = studentResult.rows[0].phone;
		if (!studentPhone) {
			return errorResponse(res, {
				statusCode: 400,
				message: 'Student phone number not found',
			});
		}

		// Return the appropriate phone number based on caller role
		// Phone number is only returned, never displayed in app UI
		// User will use device dialer to make the call
		const phoneNumber = callerRole === 'student' ? trainerPhone : studentPhone;
		const phoneLabel = callerRole === 'student' ? 'trainerPhone' : 'studentPhone';

		return successResponse(res, {
			statusCode: 200,
			message: 'Phone number retrieved successfully',
			data: {
				[phoneLabel]: phoneNumber,
				// Note: Phone number is only for dialer use, not for display
			},
		});
	}
);

/**
 * Handle Exotel webhook (DEPRECATED - No longer used)
 * POST /api/v1/admin/calls/webhook
 * This endpoint is kept for backwards compatibility but is no longer functional
 */
export const handleWebhook = asyncHandler(
	async (req: Request, res: Response, next: NextFunction) => {
		// Exotel webhook is no longer used - return 200 to prevent errors
		logger.debug('Exotel webhook received but ignored (deprecated)', {
			correlationId: (req as any).correlationId,
			service: 'admin-service',
		});
		return res.status(200).send('OK');
	}
);

/**
 * Get call history for a trainer-student pair
 * GET /api/v1/admin/calls/history?trainerId=...&studentId=...
 */
export const getCallHistory = asyncHandler(
	async (req: Request, res: Response, next: NextFunction) => {
		const userId = (req as any).user?.id;
		const userRole = (req as any).user?.role;

		if (!userId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Unauthorized',
			});
		}

		const trainerId = req.query.trainerId as string;
		const studentId = req.query.studentId as string;
		const limit = parseInt(req.query.limit as string) || 50;

		if (!trainerId || !studentId) {
			return errorResponse(res, {
				statusCode: 400,
				message: 'trainerId and studentId are required',
			});
		}

		// Verify user has permission
		if (userRole === 'trainer' && userId !== trainerId) {
			return errorResponse(res, {
				statusCode: 403,
				message: 'Unauthorized',
			});
		}
		if (userRole === 'student' && userId !== studentId) {
			return errorResponse(res, {
				statusCode: 403,
				message: 'Unauthorized',
			});
		}

		try {
			// Get call history from database (if call_logs table exists)
			const pool = getPool();
			const historyResult = await pool.query(
				`SELECT 
					call_sid,
					trainer_id,
					student_id,
					session_id,
					caller_role,
					status,
					direction,
					duration,
					recording_url,
					start_time,
					end_time,
					created_at,
					updated_at
				FROM call_logs 
				WHERE trainer_id = $1 AND student_id = $2 
				ORDER BY created_at DESC 
				LIMIT $3`,
				[trainerId, studentId, limit]
			);

			return successResponse(res, {
				message: 'Call history retrieved successfully',
				data: { calls: historyResult.rows },
			});
		} catch (error: any) {
			logger.error('Error fetching call history', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				trainerId: req.query.trainerId,
				studentId: req.query.studentId,
				correlationId: (req as any).correlationId,
				service: 'admin-service',
			});
			// If call_logs table doesn't exist, return empty array
			if (error.message?.includes('does not exist') || error.message?.includes('relation')) {
				return successResponse(res, {
					message: 'Call history retrieved successfully',
					data: { calls: [] },
				});
			}
			return errorResponse(res, {
				statusCode: 500,
				message: error.message || 'Failed to fetch call history',
			});
		}
	}
);

