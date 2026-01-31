import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { validateRequest, authRateLimiter, otpRateLimiter } from '@kodingcaravan/shared';
import {
	registerSchema,
	resendEmailOtpSchema,
	verifyEmailSchema,
	loginSchema,
	phoneOtpRequestSchema,
	phoneOtpVerifySchema,
	phoneOtpRetrySchema,
	refreshSchema,
	logoutSchema,
	profileSchema,
	googleAuthSchema,
	googleNativeAuthSchema,
	googleWebAuthSchema,
	forgotPasswordSchema,
	resetPasswordWithOtpSchema,
	changePasswordSchema,
} from '../schemas/authSchema';
import { StudentAuthController } from '../controllers/studentAuth.controller';
import { requireAuth } from '../middlewares/authMiddleware';

const router: ExpressRouter = Router();

router.post(
	'/register',
	authRateLimiter,
	validateRequest({ body: registerSchema }),
	StudentAuthController.register
);
router.post(
	'/email/resend',
	otpRateLimiter,
	validateRequest({ body: resendEmailOtpSchema }),
	StudentAuthController.resendEmailOtp
);
router.post(
	'/email/verify',
	authRateLimiter,
	validateRequest({ body: verifyEmailSchema }),
	StudentAuthController.verifyEmail
);
router.post(
	'/login',
	authRateLimiter,
	validateRequest({ body: loginSchema }),
	StudentAuthController.login
);
router.post(
	'/otp/request',
	otpRateLimiter,
	validateRequest({ body: phoneOtpRequestSchema }),
	StudentAuthController.requestPhoneOtp
);
router.post(
	'/otp/verify',
	authRateLimiter,
	validateRequest({ body: phoneOtpVerifySchema }),
	StudentAuthController.verifyPhoneOtp
);
router.post(
	'/otp/retry',
	otpRateLimiter,
	validateRequest({ body: phoneOtpRetrySchema }),
	StudentAuthController.retryPhoneOtp
);
// Legacy endpoint (kept for backward compatibility)
router.post(
	'/google',
	authRateLimiter,
	validateRequest({ body: googleAuthSchema }),
	StudentAuthController.googleAuth
);

// TEMPORARY: Native Google Sign-In (mobile app sends verified user info)
router.post(
	'/google/native',
	authRateLimiter,
	validateRequest({ body: googleNativeAuthSchema }),
	StudentAuthController.googleNativeAuth
);

// FINAL: Web OAuth Google Sign-In (server-side code exchange)
router.post(
	'/google/web',
	authRateLimiter,
	validateRequest({ body: googleWebAuthSchema }),
	StudentAuthController.googleWebAuth
);
router.post(
	'/refresh',
	validateRequest({ body: refreshSchema }),
	StudentAuthController.refresh
);
router.post(
	'/logout',
	validateRequest({ body: logoutSchema }),
	StudentAuthController.logout
);
router.post('/logout-all', requireAuth, StudentAuthController.logoutAll);
router.post(
	'/password/forgot',
	authRateLimiter,
	validateRequest({ body: forgotPasswordSchema }),
	StudentAuthController.forgotPassword
);
router.post(
	'/password/reset',
	authRateLimiter,
	validateRequest({ body: resetPasswordWithOtpSchema }),
	StudentAuthController.resetPassword
);
router.post(
	'/password/change',
	requireAuth,
	validateRequest({ body: changePasswordSchema }),
	StudentAuthController.changePassword
);
router.get('/profile', requireAuth, StudentAuthController.getProfile);
router.put(
	'/profile',
	requireAuth,
	validateRequest({ body: profileSchema }),
	StudentAuthController.updateProfile
);

export default router;

