import { Router, type IRouter } from 'express';
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
import { trainerApplicationSchema } from '../schemas/applicationSchema';
import { trainerApplicationSchemaRefactored } from '../schemas/applicationSchema.refactored';
import { TrainerAuthController } from '../controllers/trainerAuth.controller';
import { requireAuth } from '../middlewares/authMiddleware';

const router: IRouter = Router();

router.post(
	'/register',
	authRateLimiter,
	validateRequest({ body: registerSchema }),
	TrainerAuthController.register
);
router.post(
	'/email/resend',
	otpRateLimiter,
	validateRequest({ body: resendEmailOtpSchema }),
	TrainerAuthController.resendEmailOtp
);
router.post(
	'/email/verify',
	authRateLimiter,
	validateRequest({ body: verifyEmailSchema }),
	TrainerAuthController.verifyEmail
);
router.post(
	'/login',
	authRateLimiter,
	validateRequest({ body: loginSchema }),
	TrainerAuthController.login
);
router.post(
	'/otp/request',
	otpRateLimiter,
	validateRequest({ body: phoneOtpRequestSchema }),
	TrainerAuthController.requestPhoneOtp
);
router.post(
	'/otp/verify',
	authRateLimiter,
	validateRequest({ body: phoneOtpVerifySchema }),
	TrainerAuthController.verifyPhoneOtp
);
router.post(
	'/otp/retry',
	otpRateLimiter,
	validateRequest({ body: phoneOtpRetrySchema }),
	TrainerAuthController.retryPhoneOtp
);
// Legacy endpoint (kept for backward compatibility)
router.post(
	'/google',
	authRateLimiter,
	validateRequest({ body: googleAuthSchema }),
	TrainerAuthController.googleAuth
);

// TEMPORARY: Native Google Sign-In (mobile app sends verified user info)
router.post(
	'/google/native',
	authRateLimiter,
	validateRequest({ body: googleNativeAuthSchema }),
	TrainerAuthController.googleNativeAuth
);

// FINAL: Web OAuth Google Sign-In (server-side code exchange)
router.post(
	'/google/web',
	authRateLimiter,
	validateRequest({ body: googleWebAuthSchema }),
	TrainerAuthController.googleWebAuth
);
router.post(
	'/refresh',
	validateRequest({ body: refreshSchema }),
	TrainerAuthController.refresh
);
router.post(
	'/logout',
	validateRequest({ body: logoutSchema }),
	TrainerAuthController.logout
);
router.post('/logout-all', requireAuth, TrainerAuthController.logoutAll);
router.post(
	'/password/forgot',
	authRateLimiter,
	validateRequest({ body: forgotPasswordSchema }),
	TrainerAuthController.forgotPassword
);
router.post(
	'/password/reset',
	authRateLimiter,
	validateRequest({ body: resetPasswordWithOtpSchema }),
	TrainerAuthController.resetPassword
);
router.post(
	'/password/change',
	requireAuth,
	validateRequest({ body: changePasswordSchema }),
	TrainerAuthController.changePassword
);
router.get('/profile', requireAuth, TrainerAuthController.getProfile);
router.put(
	'/profile',
	requireAuth,
	validateRequest({ body: profileSchema as any }),
	TrainerAuthController.updateProfile
);
router.post(
	'/apply',
	validateRequest({ body: trainerApplicationSchema }),
	TrainerAuthController.submitApplication
);

// Refactored enterprise-grade application endpoint
router.post(
	'/apply/refactored',
	validateRequest({ body: trainerApplicationSchemaRefactored }),
	TrainerAuthController.submitApplicationRefactored
);

// Availability preview endpoint
router.post(
	'/apply/preview-availability',
	TrainerAuthController.previewAvailability
);

// Pincode lookup endpoint (public - no auth required)
// Used for auto-fill during application
router.get(
	'/pincodes/:pincode',
	TrainerAuthController.resolvePincode
);

// Available courses endpoint (public - no auth required)
// Used to populate course selection in application form
router.get(
	'/apply/available-courses',
	TrainerAuthController.getAvailableCourses
);

export default router;

