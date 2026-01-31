import { Router } from 'express';
import type { AnalyticsController } from '../controllers/analytics.controller';

export function createAnalyticsRoutes(controller: AnalyticsController): Router {
  const router = Router();

  router.post('/events', controller.recordEvent);
  router.post('/events/bulk', controller.bulkRecordEvents);

  router.get('/events', controller.listEvents);
  router.get('/events/:eventId', controller.getEventById);

  router.get('/metrics/event-types', controller.getEventTypeMetrics);
  router.get('/metrics/courses', controller.getTopCourses);
  router.get('/metrics/trends', controller.getEventTrends);

  router.get('/users/:userId/timeline', controller.getUserTimeline);

  return router;
}

