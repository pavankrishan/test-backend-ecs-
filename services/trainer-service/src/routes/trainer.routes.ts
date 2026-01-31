import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '@kodingcaravan/shared';
import type { TrainerController } from '../controllers/trainer.controller';
import { requireAuth } from '../middlewares/authMiddleware';

const confirmLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).nullable().optional(),
  source: z.literal('gps_confirmed').optional().default('gps_confirmed'),
});

const allocationPreferenceSchema = z.object({
  acceptMore: z.boolean(),
});

export function createTrainerRoutes(controller: TrainerController): Router {
  const router = Router();

  router.get('/', controller.listTrainers);
  router.get('/:trainerId', controller.getOverview);
  router.put('/:trainerId/profile', controller.updateProfile);
  router.put('/:trainerId/performance', controller.updatePerformance);

  // Location confirmation endpoints (require authentication)
  router.post(
    '/confirm-location',
    requireAuth,
    validateRequest({
      body: confirmLocationSchema,
    }),
    controller.confirmLocation
  );

  router.get('/location/status', requireAuth, controller.checkLocationStatus);

  // Allocation preference endpoints (require authentication)
  router.post(
    '/allocations/preference',
    requireAuth,
    validateRequest({
      body: allocationPreferenceSchema,
    }),
    controller.setAllocationPreference
  );

  router.get('/allocations/preference', requireAuth, controller.getAllocationPreference);

  return router;
}

