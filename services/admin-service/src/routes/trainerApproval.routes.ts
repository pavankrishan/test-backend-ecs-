import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { TrainerApprovalController } from '../controllers/trainerApproval.controller';
import { requireAdminAuth } from '../middlewares/requireAdminAuth';

const router: ExpressRouter = Router();

// All routes require admin authentication
// IMPORTANT: More specific routes must come before generic routes
router.get('/statistics', requireAdminAuth, TrainerApprovalController.getStatistics);
router.post('/:trainerId/approve', requireAdminAuth, TrainerApprovalController.approveTrainer);
router.post('/:trainerId/reject', requireAdminAuth, TrainerApprovalController.rejectTrainer);
router.get('/:trainerId', requireAdminAuth, TrainerApprovalController.getTrainerById);
router.get('/', requireAdminAuth, TrainerApprovalController.getTrainersByStatus);

export default router;

