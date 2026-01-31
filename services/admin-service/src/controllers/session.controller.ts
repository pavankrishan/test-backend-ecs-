import { Request, Response } from 'express';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import logger from '@kodingcaravan/shared/config/logger';
import { SessionService } from '../services/session.service';
import { LiveKitService } from '../services/livekit.service';
import { getPool } from '../config/database';
import { z } from 'zod';

const sessionService = new SessionService();
const livekitService = new LiveKitService(getPool());

const createSessionSchema = z.object({
	allocationId: z.string().uuid(),
	studentId: z.string().uuid(),
	trainerId: z.string().uuid(),
	courseId: z.string().uuid().optional().nullable(),
	scheduledDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
	scheduledTime: z.string(),
	duration: z.number().int().positive().default(40),
	studentHomeLocation: z.object({
		latitude: z.number().min(-90).max(90),
		longitude: z.number().min(-180).max(180),
		address: z.string().optional(),
	}),
	otp: z.string().optional().nullable(),
	notes: z.string().optional().nullable(),
	metadata: z.record(z.any()).optional().nullable(),
});

const startSessionSchema = z.object({
	trainerLocation: z.object({
		latitude: z.number().min(-90).max(90),
		longitude: z.number().min(-180).max(180),
	}),
	faceVerificationImage: z.string(), // Base64 encoded image
	faceVerificationMethod: z.enum(['selfie', 'video']).optional(),
});

const endSessionSchema = z.object({
	trainerLocation: z.object({
		latitude: z.number().min(-90).max(90),
		longitude: z.number().min(-180).max(180),
	}),
	notes: z.string().optional().nullable(),
});

const confirmSessionSchema = z.object({
	confirmed: z.boolean(),
	notes: z.string().optional().nullable(),
});

const verifyStudentOtpSchema = z.object({
	otp: z.string().length(6),
});

export class SessionController {
	/**
	 * Create a new session
	 * POST /api/v1/admin/sessions
	 */
	static createSession = asyncHandler(async (req: Request, res: Response) => {
		const body = createSessionSchema.parse(req.body);

		const session = await sessionService.createSession({
			...body,
			scheduledDate: new Date(body.scheduledDate),
		});

		return successResponse(res, {
			statusCode: 201,
			message: 'Session created successfully',
			data: session,
		});
	});

	/**
	 * Start session with GPS + Face verification
	 * POST /api/v1/admin/sessions/:sessionId/start
	 */
	static startSession = asyncHandler(async (req: Request, res: Response) => {
		const { sessionId } = req.params;
		const body = startSessionSchema.parse(req.body);

		// Get trainer ID from request (set by auth middleware)
		const trainerId = (req as any).trainerId || (req as any).userId;
		if (!trainerId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Trainer authentication required',
			});
		}

		const result = await sessionService.startSession(sessionId, trainerId, body);

		if (!result.verificationPassed) {
			return successResponse(res, {
				statusCode: 200,
				message: 'Verification failed. Please check GPS and face verification.',
				data: result,
			});
		}

		return successResponse(res, {
			message: 'Session started successfully',
			data: result,
		});
	});

	/**
	 * End session
	 * POST /api/v1/admin/sessions/:sessionId/end
	 */
	static endSession = asyncHandler(async (req: Request, res: Response) => {
		const { sessionId } = req.params;
		const body = endSessionSchema.parse(req.body);

		// Get trainer ID from request (set by auth middleware)
		const trainerId = (req as any).trainerId || (req as any).userId;
		if (!trainerId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Trainer authentication required',
			});
		}

		const session = await sessionService.endSession(sessionId, trainerId, body);

		return successResponse(res, {
			message: 'Session ended. Waiting for student confirmation.',
			data: session,
		});
	});

	/**
	 * Student/Parent confirms session
	 * POST /api/v1/admin/sessions/:sessionId/confirm
	 */
	static confirmSession = asyncHandler(async (req: Request, res: Response) => {
		const { sessionId } = req.params;
		const body = confirmSessionSchema.parse(req.body);

		// Get student ID from request (set by auth middleware)
		const studentId = (req as any).studentId || (req as any).userId;
		if (!studentId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Student authentication required',
			});
		}

		const session = await sessionService.confirmSession(sessionId, studentId, body);

		const message = body.confirmed
			? 'Session confirmed successfully'
			: 'Session marked as disputed. Admin will review.';

		return successResponse(res, {
			message,
			data: session,
		});
	});

	/**
	 * Get session by ID
	 * GET /api/v1/admin/sessions/:sessionId
	 */
	static getSession = asyncHandler(async (req: Request, res: Response) => {
		const { sessionId } = req.params;

		// Validate sessionId format - must be a valid UUID
		// Reject allocation IDs and other invalid formats
		if (sessionId.startsWith('alloc-')) {
			return errorResponse(res, {
				statusCode: 400,
				message: 'Invalid session ID format. Allocation IDs cannot be used as session IDs.',
			});
		}

		// Basic UUID format validation (8-4-4-4-12 hex characters)
		const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		if (!uuidRegex.test(sessionId)) {
			return errorResponse(res, {
				statusCode: 400,
				message: 'Invalid session ID format. Session ID must be a valid UUID.',
			});
		}

		// Use getSessionWithDetails to include trainer information
		const session = await sessionService.getSessionWithDetails(sessionId);
		if (!session) {
			return errorResponse(res, {
				statusCode: 404,
				message: 'Session not found',
			});
		}

		// Log what we're about to send
		logger.debug('getSession - About to send response', {
			sessionId,
			hasTrainerName: 'trainerName' in session,
			trainerName: session.trainerName,
			correlationId: (req as any).correlationId,
			service: 'admin-service',
			hasTrainerPhoto: 'trainerPhoto' in session,
			hasCourseName: 'courseName' in session,
			sessionKeys: Object.keys(session),
		});

		return successResponse(res, {
			message: 'Session retrieved successfully',
			data: session,
		});
	});

	/**
	 * Get student's sessions
	 * GET /api/v1/admin/sessions/student/:studentId
	 */
	static getStudentSessions = asyncHandler(async (req: Request, res: Response) => {
		const { studentId } = req.params;
		const { status, limit, offset } = req.query;

		// Use the enriched version that includes trainer and course details
		const sessions = await sessionService.getStudentSessionsWithDetails(studentId, {
			status: status as string,
			limit: limit ? parseInt(limit as string, 10) : undefined,
			offset: offset ? parseInt(offset as string, 10) : undefined,
		});

		return successResponse(res, {
			message: 'Sessions retrieved successfully',
			data: sessions,
		});
	});

	/**
	 * Get trainer's sessions
	 * GET /api/v1/admin/sessions/trainer/:trainerId
	 */
	static getTrainerSessions = asyncHandler(async (req: Request, res: Response) => {
		const { trainerId } = req.params;
		const { status, limit, offset } = req.query;

		// Use the enriched version that includes student and course details
		const sessions = await sessionService.getTrainerSessionsWithDetails(trainerId, {
			status: status as string,
			limit: limit ? parseInt(limit as string, 10) : undefined,
			offset: offset ? parseInt(offset as string, 10) : undefined,
		});

		logger.debug('getTrainerSessions response', {
			trainerId,
			sessionsCount: sessions.length,
			correlationId: (req as any).correlationId,
			service: 'admin-service',
			responseSize: JSON.stringify(sessions).length,
			firstSession: sessions[0] ? {
				id: sessions[0].id,
				studentId: sessions[0].studentId,
				status: sessions[0].status,
			} : null,
		});

		return successResponse(res, {
			message: 'Sessions retrieved successfully',
			data: sessions,
		});
	});

	/**
	 * Verify student OTP and start session
	 * POST /api/v1/admin/sessions/:sessionId/verify-otp
	 */
	static verifyStudentOtp = asyncHandler(async (req: Request, res: Response) => {
		const { sessionId } = req.params;
		const body = verifyStudentOtpSchema.parse(req.body);

		// Get trainer ID from request (set by auth middleware)
		const trainerId = (req as any).trainerId || (req as any).userId;
		if (!trainerId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Trainer authentication required',
			});
		}

		const session = await sessionService.verifyStudentOtp(sessionId, trainerId, body.otp);

		return successResponse(res, {
			message: 'OTP verified successfully. Session started.',
			data: session,
		});
	});

	/**
	 * Get LiveKit access token for joining a live class
	 * POST /api/v1/admin/sessions/:sessionId/livekit-token
	 */
	static getLiveKitToken = asyncHandler(async (req: Request, res: Response) => {
		const { sessionId } = req.params;
		
		// Get user info from request (set by auth middleware)
		const userId = (req as any).userId || (req as any).studentId || (req as any).trainerId;
		const userRole = (req as any).userRole || ((req as any).trainerId ? 'trainer' : 'student');
		const userName = (req as any).userName || (req as any).name || 'User';

		if (!userId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Authentication required',
			});
		}

		const tokenResponse = await livekitService.generateAccessToken({
			sessionId,
			userId,
			userRole: userRole as 'student' | 'trainer',
			userName,
		});

		return successResponse(res, {
			message: 'LiveKit token generated successfully',
			data: tokenResponse,
		});
	});
}

