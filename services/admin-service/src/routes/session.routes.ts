import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { SessionController } from '../controllers/session.controller';
import * as JourneyController from '../controllers/journey.controller';
import { requireAdminAuth } from '../middlewares/requireAdminAuth';
import { requireUserAuth } from '../middlewares/requireUserAuth';

const router: ExpressRouter = Router();

// Public routes (for trainers and students)
// Get active journey for session (student or trainer who owns the session)
router.get(
	'/sessions/:sessionId/active-journey',
	requireUserAuth,
	JourneyController.getActiveJourneyForSession
);

// Session-scoped derived trainer live-location status (NOT_STARTED | ON_THE_WAY | ARRIVED | ENDED)
router.get(
	'/sessions/:sessionId/journey-status',
	requireUserAuth,
	JourneyController.getJourneyStatusForSession
);

// Start session - requires trainer auth
router.post(
	'/sessions/:sessionId/start',
	requireUserAuth,
	SessionController.startSession
);

// Verify student OTP and start session - requires trainer auth
router.post(
	'/sessions/:sessionId/verify-otp',
	requireUserAuth,
	SessionController.verifyStudentOtp
);

// End session - requires trainer auth
router.post(
	'/sessions/:sessionId/end',
	requireUserAuth,
	SessionController.endSession
);

// Confirm session - requires student auth
router.post(
	'/sessions/:sessionId/confirm',
	requireUserAuth,
	SessionController.confirmSession
);

// Get session - accessible by authenticated users
router.get(
	'/sessions/:sessionId',
	requireUserAuth,
	SessionController.getSession
);

// Admin routes
// Create session - requires admin auth
router.post(
	'/sessions',
	requireAdminAuth,
	SessionController.createSession
);

// Get student sessions - accessible by admin or student
router.get(
	'/sessions/student/:studentId',
	requireUserAuth,
	SessionController.getStudentSessions
);

// Get trainer sessions - accessible by admin or trainer
router.get(
	'/sessions/trainer/:trainerId',
	requireUserAuth,
	SessionController.getTrainerSessions
);

// Get LiveKit token for joining live class - accessible by authenticated users
router.post(
	'/sessions/:sessionId/livekit-token',
	requireUserAuth,
	SessionController.getLiveKitToken
);

export default router;

