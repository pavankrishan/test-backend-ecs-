import { Router } from 'express';
import type { VerificationController } from '../controllers/verification.controller';

export function createVerificationRoutes(controller: VerificationController): Router {
  const router = Router();

  router.get('/pending', controller.listPending);
  router.post('/', controller.submitDocument);
  router.get('/:documentId', controller.getDocument);
  router.patch('/:documentId', controller.updateDocument);
  router.get('/trainer/:trainerId', controller.listTrainerDocuments);

  return router;
}

