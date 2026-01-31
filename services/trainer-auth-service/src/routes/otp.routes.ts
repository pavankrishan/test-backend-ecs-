import { Router, type IRouter } from 'express';
import { validateRequest } from '@kodingcaravan/shared';
import { phoneOtpRequestSchema, phoneOtpVerifySchema } from '../schemas/authSchema';
import { TrainerAuthController } from '../controllers/trainerAuth.controller';

const router: IRouter = Router();

router.post(
	'/send',
	validateRequest({ body: phoneOtpRequestSchema }),
	TrainerAuthController.requestPhoneOtp
);
router.post(
	'/verify',
	validateRequest({ body: phoneOtpVerifySchema }),
	TrainerAuthController.verifyPhoneOtp
);

export default router;

