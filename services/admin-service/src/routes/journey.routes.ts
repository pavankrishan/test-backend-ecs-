import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import * as JourneyController from '../controllers/journey.controller';
import { requireUserAuth } from '../middlewares/requireUserAuth';

const router: ExpressRouter = Router();

// POST /journeys/start — start journey, returns journeyId (trainer)
router.post('/journeys/start', requireUserAuth, JourneyController.startJourney);

// POST /journeys/:journeyId/location — update location, sequence required (trainer)
router.post('/journeys/:journeyId/location', requireUserAuth, JourneyController.updateLocation);

// POST /journeys/:journeyId/end — end journey (trainer)
router.post('/journeys/:journeyId/end', requireUserAuth, JourneyController.endJourney);

// POST /journeys/:journeyId/arrived — mark arrived (trainer)
router.post('/journeys/:journeyId/arrived', requireUserAuth, JourneyController.markArrived);

// GET /journeys/:journeyId/live — get live location (student only)
router.get('/journeys/:journeyId/live', requireUserAuth, JourneyController.getLiveLocation);

export default router;
