import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { SubstitutionController } from '../controllers/substitution.controller';
import { requireAdminAuth } from '../middlewares/requireAdminAuth';

export function createSubstitutionRoutes(): Router {
  const router: ExpressRouter = Router();

  // All routes require admin authentication
  router.post('/', requireAdminAuth, SubstitutionController.create);
  router.get('/trainer/:trainerId', requireAdminAuth, SubstitutionController.getTrainerSubstitutions);
  router.get('/:id', requireAdminAuth, SubstitutionController.getById);
  router.delete('/:id', requireAdminAuth, SubstitutionController.delete);

  return router;
}

