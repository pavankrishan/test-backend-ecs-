import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { validateRequest } from '@kodingcaravan/shared';
import { phoneOtpRequestSchema, phoneOtpVerifySchema } from '../schemas/authSchema';
import { StudentAuthController } from '../controllers/studentAuth.controller';

const router: ExpressRouter = Router();

router.post(
	'/send',
	validateRequest({ body: phoneOtpRequestSchema }),
	StudentAuthController.requestPhoneOtp
);
router.post(
	'/verify',
	validateRequest({ body: phoneOtpVerifySchema }),
	StudentAuthController.verifyPhoneOtp
);

export default router;
