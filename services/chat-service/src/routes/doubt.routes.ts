import { Router } from 'express';
import type { DoubtController } from '../controllers/doubt.controller';

export function createDoubtRoutes(doubtController: DoubtController): Router {
  const router = Router();

  // Student endpoints
  router.post('/doubts', doubtController.createDoubt);
  router.get('/doubts', doubtController.listDoubts);
  router.get('/doubts/:doubtId', doubtController.getDoubt);
  router.patch('/doubts/:doubtId/status', doubtController.updateStatus);

  // Trainer endpoints
  router.get('/trainer/doubts', doubtController.getTrainerDoubts);
  router.post('/doubts/:doubtId/reply', doubtController.createReply);

  // Admin endpoints
  router.get('/admin/doubts', doubtController.getAdminDoubts);
  router.post('/doubts/:doubtId/reassign', doubtController.reassignDoubt);

  return router;
}

