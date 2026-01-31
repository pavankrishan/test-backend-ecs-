import { Router } from 'express';
import { validateRequest } from '@kodingcaravan/shared';
import { PaymentController } from '../controllers/payment.controller';
import {
	createPaymentSchema,
	confirmPaymentSchema,
	confirmPaymentParamsSchema,
	paymentIdParamsSchema,
	studentIdParamsSchema,
	courseCompletionRewardSchema,
	referralRewardSchema,
	adjustCoinsSchema,
	redeemCoinsSchema,
	createSessionBookingPaymentSchema,
	updateCoinConfigurationSchema,
} from '../schemas/paymentSchemas';

const router: Router = Router();

router.get('/health', PaymentController.health);

router.post('/', validateRequest({ body: createPaymentSchema }), PaymentController.createPayment);

router.post(
	'/:paymentId/confirm',
	validateRequest({ params: confirmPaymentParamsSchema, body: confirmPaymentSchema }),
	PaymentController.confirmPayment
);

router.get(
	'/wallet/:studentId',
	validateRequest({ params: studentIdParamsSchema }),
	PaymentController.getWallet
);

router.get(
	'/wallet/:studentId/transactions',
	validateRequest({ params: studentIdParamsSchema }),
	PaymentController.getWalletTransactions
);

router.get(
	'/student/:studentId',
	validateRequest({ params: studentIdParamsSchema }),
	PaymentController.getPaymentsForStudent
);

router.get(
	'/:paymentId',
	validateRequest({ params: paymentIdParamsSchema }),
	PaymentController.getPayment
);

router.get(
	'/:paymentId/status',
	validateRequest({ params: paymentIdParamsSchema }),
	PaymentController.verifyPurchaseStatus
);

router.post(
	'/coins/course-completion',
	validateRequest({ body: courseCompletionRewardSchema }),
	PaymentController.awardCourseCompletion
);

router.post(
	'/coins/referral',
	validateRequest({ body: referralRewardSchema }),
	PaymentController.awardReferral
);

router.post(
	'/coins/adjust',
	validateRequest({ body: adjustCoinsSchema }),
	PaymentController.adjustCoins
);

router.post(
	'/coins/redeem',
	validateRequest({ body: redeemCoinsSchema }),
	PaymentController.redeemCoins
);

router.post(
	'/session-booking',
	validateRequest({ body: createSessionBookingPaymentSchema }),
	PaymentController.createSessionBookingPayment
);

// Coin configuration endpoints (admin access recommended)
router.get('/coins/configuration', PaymentController.getCoinConfiguration);
router.put(
	'/coins/configuration',
	validateRequest({ body: updateCoinConfigurationSchema }),
	PaymentController.updateCoinConfiguration
);

// Webhook is handled in app.ts with raw body middleware

export default router;

