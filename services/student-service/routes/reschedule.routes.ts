import { Router } from 'express';
import type { RequestRescheduleController } from '../controllers/requestReschedule.controller';

export function createRescheduleRoutes(controller: RequestRescheduleController): Router {
  const router = Router();

  router.get('/', controller.listRequests);
  router.post('/', controller.createRequest);
  router.get('/:id', controller.getRequest);
  router.patch('/:id', controller.updateRequest);
  router.patch('/:id/status', controller.updateStatus);

  return router;
}

