import { Router } from 'express';
import {
	createTrackingSession,
	stopTrackingSession,
	getActiveSession,
	createLocationUpdate,
	getLiveLocation,
	getMultipleLiveLocations,
	getLocationHistory,
	getTutoringSessionLocationHistory,
	checkLocationSafetyForSession,
} from '../controllers/locationTracking.controller';
import { requireUserAuth } from '../middlewares/requireUserAuth';
import type { Router as ExpressRouter } from 'express';

const router: ExpressRouter = Router();

// Start a location tracking session
router.post('/sessions', requireUserAuth, createTrackingSession);

// Stop a location tracking session
router.post('/sessions/:id/stop', requireUserAuth, stopTrackingSession);

// Get active tracking session for user
router.get('/sessions/active', requireUserAuth, getActiveSession);

// Send location update
router.post('/updates', requireUserAuth, createLocationUpdate);

// Get live location for a user
router.get('/live', requireUserAuth, getLiveLocation);

// Get multiple users' live locations
router.post('/live/batch', requireUserAuth, getMultipleLiveLocations);

// Get location history
router.get('/updates', requireUserAuth, getLocationHistory);

// Get location history for a specific tutoring session
router.get('/tutoring-sessions/:tutoringSessionId/history', requireUserAuth, getTutoringSessionLocationHistory);

// Check location safety for a session
router.post('/tutoring-sessions/:tutoringSessionId/safety-check', requireUserAuth, checkLocationSafetyForSession);

export default router;

