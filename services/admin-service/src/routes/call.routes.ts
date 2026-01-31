import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import * as CallController from '../controllers/call.controller';
import { requireUserAuth } from '../middlewares/requireUserAuth';

const router: ExpressRouter = Router();

// Initiate call
router.post(
	'/initiate',
	requireUserAuth,
	CallController.initiateCall
);

// Exotel webhook (no auth required - Exotel calls this)
router.post(
	'/webhook',
	CallController.handleWebhook
);

// Get call history
router.get(
	'/history',
	requireUserAuth,
	CallController.getCallHistory
);

export default router;

