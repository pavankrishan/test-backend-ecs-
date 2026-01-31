import { Request, Response, NextFunction } from 'express';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import { JourneyService } from '../services/journey.service';
import { JourneyRepository } from '../models/journey.model';
import { getPool } from '../config/database';
import { SessionRepository } from '../models/session.model';
import { z } from 'zod';

const journeyService = new JourneyService();
const journeyRepo = new JourneyRepository(getPool());
const sessionRepo = new SessionRepository(getPool());

const startJourneySchema = z.object({
	sessionId: z.string().uuid(),
});

const updateLocationSchema = z.object({
	sequence: z.number().int().min(0),
	latitude: z.number().min(-90).max(90),
	longitude: z.number().min(-180).max(180),
	accuracy: z.number().optional(),
	speed: z.number().optional(),
	heading: z.number().optional(),
});

/**
 * POST /journeys/start
 * Start a journey for a session. Returns journeyId. Trainer must own session.
 */
export const startJourney = asyncHandler(async (req: Request, res: Response): Promise<void> => {
	const trainerId = (req as any).trainerId ?? (req as any).userId;
	if (!trainerId) {
		errorResponse(res, { statusCode: 401, message: 'Trainer authentication required' });
		return;
	}

	const body = startJourneySchema.safeParse(req.body);
	const sessionId = body.success ? body.data.sessionId : (req.body?.sessionId ?? req.params?.sessionId);
	if (!sessionId || typeof sessionId !== 'string') {
		errorResponse(res, { statusCode: 400, message: 'sessionId is required' });
		return;
	}

	const result = await journeyService.startJourney({ sessionId, trainerId });
	successResponse(res, { statusCode: 201, message: 'Journey started', data: result });
});

/**
 * POST /journeys/:journeyId/location
 * Update location during journey. Hard validation of trainer ownership (Redis, no DB on hot path).
 * Rejects stale sequence numbers.
 */
export const updateLocation = asyncHandler(async (req: Request, res: Response): Promise<void> => {
	const trainerId = (req as any).trainerId ?? (req as any).userId;
	if (!trainerId) {
		errorResponse(res, { statusCode: 401, message: 'Trainer authentication required' });
		return;
	}

	const journeyId = req.params.journeyId;
	if (!journeyId) {
		errorResponse(res, { statusCode: 400, message: 'journeyId is required' });
		return;
	}

	const parsed = updateLocationSchema.safeParse(req.body);
	if (!parsed.success) {
		errorResponse(res, { statusCode: 400, message: 'Invalid body', errors: parsed.error.flatten() });
		return;
	}

	const result = await journeyService.updateLocation({
		journeyId,
		trainerId,
		sequence: parsed.data.sequence,
		latitude: parsed.data.latitude,
		longitude: parsed.data.longitude,
		accuracy: parsed.data.accuracy,
		speed: parsed.data.speed,
		heading: parsed.data.heading,
	});
	successResponse(res, { statusCode: 200, message: 'Location updated', data: result });
});

/**
 * POST /journeys/:journeyId/end
 * End journey (cancel). Immediate revoke of tracking.
 */
export const endJourney = asyncHandler(async (req: Request, res: Response): Promise<void> => {
	const trainerId = (req as any).trainerId ?? (req as any).userId;
	if (!trainerId) {
		errorResponse(res, { statusCode: 401, message: 'Trainer authentication required' });
		return;
	}

	const journeyId = req.params.journeyId;
	if (!journeyId) {
		errorResponse(res, { statusCode: 400, message: 'journeyId is required' });
		return;
	}

	const reason = (req.body?.reason === 'arrived' ? 'arrived' : 'cancelled') as 'arrived' | 'cancelled';
	const result = await journeyService.endJourney(journeyId, trainerId, reason);
	successResponse(res, { statusCode: 200, message: 'Journey ended', data: result });
});

/**
 * POST /journeys/:journeyId/arrived
 * Mark trainer arrived (validates distance to student location, then ends journey).
 */
export const markArrived = asyncHandler(async (req: Request, res: Response): Promise<void> => {
	const trainerId = (req as any).trainerId ?? (req as any).userId;
	if (!trainerId) {
		errorResponse(res, { statusCode: 401, message: 'Trainer authentication required' });
		return;
	}

	const journeyId = req.params.journeyId;
	if (!journeyId) {
		errorResponse(res, { statusCode: 400, message: 'journeyId is required' });
		return;
	}

	// One-off DB read for journey + session (allowed for arrived)
	const journey = await journeyRepo.findById(journeyId);
	if (!journey || journey.trainerId !== trainerId) {
		errorResponse(res, { statusCode: 404, message: 'Journey not found or access denied' });
		return;
	}
	const session = await sessionRepo.findById(journey.sessionId);
	if (!session?.studentHomeLocation) {
		errorResponse(res, { statusCode: 400, message: 'Student location not available' });
		return;
	}

	const result = await journeyService.markArrived(
		journeyId,
		trainerId,
		session.studentHomeLocation.latitude,
		session.studentHomeLocation.longitude,
		150
	);
	successResponse(res, { statusCode: 200, message: 'Arrived', data: result });
});

/**
 * GET /journeys/:journeyId/live
 * Get live location for a journey (student only). Used by WebSocket or single GET.
 */
export const getLiveLocation = asyncHandler(async (req: Request, res: Response): Promise<void> => {
	const studentId = (req as any).studentId ?? (req as any).userId;
	if (!studentId) {
		errorResponse(res, { statusCode: 401, message: 'Student authentication required' });
		return;
	}

	const journeyId = req.params.journeyId ?? req.query.journeyId;
	if (!journeyId || typeof journeyId !== 'string') {
		errorResponse(res, { statusCode: 400, message: 'journeyId is required' });
		return;
	}

	const result = await journeyService.getLiveLocation(journeyId, studentId);
	if (result === null) {
		errorResponse(res, { statusCode: 403, message: 'Access denied to this journey' });
		return;
	}
	successResponse(res, { statusCode: 200, message: 'Live location', data: result });
});

/**
 * GET /sessions/:sessionId/active-journey
 * Returns { journeyId: string | null } when the session has an active journey.
 * Access: student (must own session) or trainer (must own session).
 */
export const getActiveJourneyForSession = asyncHandler(async (req: Request, res: Response): Promise<void> => {
	const userId = (req as any).userId;
	if (!userId) {
		errorResponse(res, { statusCode: 401, message: 'Authentication required' });
		return;
	}

	const sessionId = req.params.sessionId;
	if (!sessionId) {
		errorResponse(res, { statusCode: 400, message: 'sessionId is required' });
		return;
	}

	const session = await sessionRepo.findById(sessionId);
	if (!session) {
		errorResponse(res, { statusCode: 404, message: 'Session not found' });
		return;
	}

	const isStudent = session.studentId === userId;
	const isTrainer = session.trainerId === userId;
	if (!isStudent && !isTrainer) {
		errorResponse(res, { statusCode: 403, message: 'Access denied to this session' });
		return;
	}

	const active = await journeyRepo.getActiveBySessionId(sessionId);
	successResponse(res, { statusCode: 200, message: 'Active journey', data: { journeyId: active?.id ?? null } });
});

/** Session-scoped derived trainer live-location status (student view). NOT stored; NOT user-level. */
export type JourneyStatusEnum = 'NOT_STARTED' | 'ON_THE_WAY' | 'ARRIVED' | 'ENDED';

/**
 * GET /sessions/:sessionId/journey-status
 * Returns derived status: ON_THE_WAY only when journey is ACTIVE; ARRIVED when last journey ended with reason=arrived; ENDED for completed/cancelled; NOT_STARTED when no journey.
 * Access: student or trainer who owns the session.
 */
export const getJourneyStatusForSession = asyncHandler(async (req: Request, res: Response): Promise<void> => {
	const userId = (req as any).userId;
	if (!userId) {
		errorResponse(res, { statusCode: 401, message: 'Authentication required' });
		return;
	}

	const sessionId = req.params.sessionId;
	if (!sessionId) {
		errorResponse(res, { statusCode: 400, message: 'sessionId is required' });
		return;
	}

	const session = await sessionRepo.findById(sessionId);
	if (!session) {
		errorResponse(res, { statusCode: 404, message: 'Session not found' });
		return;
	}

	const isStudent = session.studentId === userId;
	const isTrainer = session.trainerId === userId;
	if (!isStudent && !isTrainer) {
		errorResponse(res, { statusCode: 403, message: 'Access denied to this session' });
		return;
	}

	const active = await journeyRepo.getActiveBySessionId(sessionId);
	if (active) {
		successResponse(res, { statusCode: 200, message: 'Journey status', data: { status: 'ON_THE_WAY' as JourneyStatusEnum } });
		return;
	}

	const last = await journeyRepo.getLastBySessionId(sessionId);
	if (!last) {
		successResponse(res, { statusCode: 200, message: 'Journey status', data: { status: 'NOT_STARTED' as JourneyStatusEnum } });
		return;
	}

	if (last.endReason === 'arrived') {
		successResponse(res, { statusCode: 200, message: 'Journey status', data: { status: 'ARRIVED' as JourneyStatusEnum } });
		return;
	}

	successResponse(res, { statusCode: 200, message: 'Journey status', data: { status: 'ENDED' as JourneyStatusEnum } });
});
