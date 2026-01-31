/**
 * Events Routes
 * 
 * API routes for event polling (fallback when WebSocket unavailable).
 */

import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { EventsController } from '../controllers/events.controller';
import { requireUserAuth } from '../middlewares/requireUserAuth';

export function createEventsRoutes(): Router {
  const router: ExpressRouter = Router();
  
  // Get recent events (for polling fallback)
  router.get(
    '/recent',
    requireUserAuth,
    EventsController.getRecentEvents
  );
  
  return router;
}

