import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { RescheduleController } from '../controllers/reschedule.controller';
import { requireAdminAuth } from '../middlewares/requireAdminAuth';
import { requireUserAuth } from '../middlewares/requireUserAuth';

const router: ExpressRouter = Router();

// Public routes (students and trainers can create reschedule requests)
router.post('/', requireUserAuth, RescheduleController.create);

// Admin-only routes
router.post('/:id/approve', requireAdminAuth, RescheduleController.approve);
router.post('/:id/reject', requireAdminAuth, RescheduleController.reject);
router.get('/', requireAdminAuth, RescheduleController.getAll);

// User routes (students and trainers can update/cancel their own requests)
router.put('/:id', requireUserAuth, RescheduleController.update);
router.post('/:id/cancel', requireUserAuth, RescheduleController.cancel);

// Admin and authenticated user routes
router.get('/:id', requireUserAuth, RescheduleController.getById);
router.get('/session/:sessionId', requireUserAuth, RescheduleController.getBySession);

export default router;



