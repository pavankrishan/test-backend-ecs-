import { Router } from 'express';
import type { SubstitutionController } from '../controllers/substitution.controller';
import { requireAuth } from '../middlewares/authMiddleware';

export function createSubstitutionRoutes(controller: SubstitutionController): Router {
  const router = Router();

  // All routes require authentication
  router.get('/original', requireAuth, controller.getOriginalSubstitutions);
  router.get('/substitute', requireAuth, controller.getSubstituteSubstitutions);

  return router;
}

