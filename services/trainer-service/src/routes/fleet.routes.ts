import { Router } from 'express';
import type { FleetController } from '../controllers/fleet.controller';

export function createFleetRoutes(controller: FleetController): Router {
  const router = Router();

  router.get('/', controller.listAvailable);
  router.get('/:trainerId', controller.getLocation);
  router.put('/:trainerId', controller.updateLocation);

  return router;
}

