import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { DemandTrackingController } from '../controllers/demandTracking.controller';
import { requireUserAuth } from '../middlewares/requireUserAuth';
import { requireAdminAuth } from '../middlewares/requireAdminAuth';

const router: ExpressRouter = Router();

// User routes (authenticated students)
router.post('/waitlist', requireUserAuth, DemandTrackingController.registerWaitlist);
router.post('/purchase-blocked', requireUserAuth, DemandTrackingController.logPurchaseBlocked);
router.get('/waitlist/check', requireUserAuth, DemandTrackingController.checkWaitlist);

// Admin routes (analytics)
router.get('/analytics', requireAdminAuth, DemandTrackingController.getAnalytics);

export default router;
