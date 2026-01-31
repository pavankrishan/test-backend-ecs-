import { Request, Response, NextFunction } from 'express';
import { successResponse, AppError } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';
import {
	registerWithEmail,
	resendEmailOtp,
	verifyEmailOtpForTrainer,
	loginWithEmailPassword,
	requestPhoneOtp,
	verifyPhoneOtp,
	retryPhoneOtp,
	refreshSession,
	logout,
	logoutAllSessions,
	updateProfile,
	getProfile,
	authenticateWithGoogle,
	authenticateWithGoogleNative,
	authenticateWithGoogleWeb,
	requestPasswordReset,
	resetPasswordWithOtp,
	changePassword,
} from '../services/trainerAuth.service';
import { processTrainerApplication } from '../services/application.service';
import { processTrainerApplicationRefactored, getAvailabilityPreview, getAvailableCourses } from '../services/application.service.refactored';
import { trainerApplicationSchema } from '../schemas/applicationSchema';
import { trainerApplicationSchemaRefactored } from '../schemas/applicationSchema.refactored';
import { getPool } from '../config/database';
import type { TrainerRecord } from '../models/trainerAuth.model';
import { pincodeService } from '../services/pincode.service';

function trainerToResponse(trainer: TrainerRecord) {
	return {
		id: trainer.id,
		email: trainer.email,
		username: trainer.username,
		phone: trainer.phone,
		isEmailVerified: trainer.isEmailVerified,
		isPhoneVerified: trainer.isPhoneVerified,
		googleId: trainer.googleId,
		lastLoginAt: trainer.lastLoginAt,
		createdAt: trainer.createdAt,
		updatedAt: trainer.updatedAt,
	};
}

export class TrainerAuthController {
	static async register(req: Request, res: Response, next: NextFunction) {
		try {
			const { trainerId } = await registerWithEmail(req.body);
			return successResponse(res, {
				statusCode: 201,
				message: 'Registration successful. Please verify your email.',
				data: { trainerId },
			});
		} catch (error) {
			next(error);
		}
	}

	static async resendEmailOtp(req: Request, res: Response, next: NextFunction) {
		try {
			await resendEmailOtp(req.body.email);
			return successResponse(res, {
				message: 'Verification email sent',
			});
		} catch (error) {
			next(error);
		}
	}

	static async verifyEmail(req: Request, res: Response, next: NextFunction) {
		try {
			const { email, otp } = req.body;
			await verifyEmailOtpForTrainer(email, otp);
			return successResponse(res, {
				message: 'Email verified successfully',
			});
		} catch (error) {
			next(error);
		}
	}

	static async login(req: Request, res: Response, next: NextFunction) {
		try {
			const { email, password } = req.body;
			const result = await loginWithEmailPassword(email, password, {
				...(req.ip && { ip: req.ip }),
				userAgent: req.headers['user-agent'] || '',
			});

		// Platform-aware token delivery
		const clientTypeHeader = req.headers['x-client-type'];
		const clientType = (Array.isArray(clientTypeHeader) ? clientTypeHeader[0] : clientTypeHeader)?.toLowerCase() || 'web';
		const isMobile = clientType === 'mobile';
		const isProduction = process.env.NODE_ENV === 'production';

		// Always set refresh token in HttpOnly, Secure cookie (for web clients)
		res.cookie('refreshToken', result.tokens.refreshToken, {
			httpOnly: true,
			secure: isProduction,
			sameSite: isProduction ? 'strict' : 'lax',
			maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
			path: '/',
		});

		// Set session ID cookie
		if (result.sessionId) {
			res.cookie('sessionId', result.sessionId, {
				httpOnly: true,
				secure: isProduction,
				sameSite: isProduction ? 'strict' : 'lax',
				maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
				path: '/',
			});
		}

		// Security: Only send refreshToken in response body for mobile clients
		// Web clients must use HttpOnly cookies only
		return successResponse(res, {
			message: 'Login successful',
			data: {
				user: trainerToResponse(result.trainer),
				tokens: {
					accessToken: result.tokens.accessToken,
					...(isMobile && { refreshToken: result.tokens.refreshToken }), // Mobile only
				},
			},
		});
		} catch (error) {
			next(error);
		}
	}

	static async requestPhoneOtp(req: Request, res: Response, next: NextFunction) {
		try {
			const result = await requestPhoneOtp(req.body.phone);
			return successResponse(res, {
				message: 'OTP sent to phone',
				...(result.devOtp
					? {
							data: {
								devOtp: result.devOtp,
							},
					  }
					: {}),
			});
		} catch (error) {
			next(error);
		}
	}

	static async verifyPhoneOtp(req: Request, res: Response, next: NextFunction) {
		try {
			const { phone, otp } = req.body;
			const result = await verifyPhoneOtp(phone, otp, {
				...(req.ip && { ip: req.ip }),
				userAgent: req.headers['user-agent'] || '',
			});

		// Platform-aware token delivery
		const clientTypeHeader = req.headers['x-client-type'];
		const clientType = (Array.isArray(clientTypeHeader) ? clientTypeHeader[0] : clientTypeHeader)?.toLowerCase() || 'web';
		const isMobile = clientType === 'mobile';
		const isProduction = process.env.NODE_ENV === 'production';

		// Always set refresh token in HttpOnly, Secure cookie (for web clients)
		res.cookie('refreshToken', result.tokens.refreshToken, {
			httpOnly: true,
			secure: isProduction,
			sameSite: isProduction ? 'strict' : 'lax',
			maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
			path: '/',
		});

		// Set session ID cookie
		if (result.sessionId) {
			res.cookie('sessionId', result.sessionId, {
				httpOnly: true,
				secure: isProduction,
				sameSite: isProduction ? 'strict' : 'lax',
				maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
				path: '/',
			});
		}

		// Security: Only send refreshToken in response body for mobile clients
		// Web clients must use HttpOnly cookies only
		return successResponse(res, {
			message: 'Phone verified successfully',
			data: {
				user: trainerToResponse(result.trainer),
				tokens: {
					accessToken: result.tokens.accessToken,
					...(isMobile && { refreshToken: result.tokens.refreshToken }), // Mobile only
				},
			},
		});
		} catch (error) {
			next(error);
		}
	}

	static async retryPhoneOtp(req: Request, res: Response, next: NextFunction) {
		try {
			const { phone, retryType } = req.body;
			await retryPhoneOtp(phone, retryType || 'text');
			return successResponse(res, {
				message: 'OTP resent successfully',
			});
		} catch (error) {
			next(error);
		}
	}

	/**
	 * Legacy endpoint - kept for backward compatibility
	 * @deprecated Use googleNativeAuth or googleWebAuth
	 */
	static async googleAuth(req: Request, res: Response, next: NextFunction) {
		try {
			const { idToken } = req.body;
			const result = await authenticateWithGoogle(idToken, {
				...(req.ip && { ip: req.ip }),
				userAgent: req.headers['user-agent'] || '',
			});

		// Platform-aware token delivery
		const clientTypeHeader = req.headers['x-client-type'];
		const clientType = (Array.isArray(clientTypeHeader) ? clientTypeHeader[0] : clientTypeHeader)?.toLowerCase() || 'web';
		const isMobile = clientType === 'mobile';
		const isProduction = process.env.NODE_ENV === 'production';

		// Always set refresh token in HttpOnly, Secure cookie (for web clients)
		res.cookie('refreshToken', result.tokens.refreshToken, {
			httpOnly: true,
			secure: isProduction,
			sameSite: isProduction ? 'strict' : 'lax',
			maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
			path: '/',
		});

		// Set session ID cookie
		if (result.sessionId) {
			res.cookie('sessionId', result.sessionId, {
				httpOnly: true,
				secure: isProduction,
				sameSite: isProduction ? 'strict' : 'lax',
				maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
				path: '/',
			});
		}

		// Security: Only send refreshToken in response body for mobile clients
		// Web clients must use HttpOnly cookies only
		return successResponse(res, {
			message: 'Logged in with Google',
			data: {
				user: trainerToResponse(result.trainer),
				tokens: {
					accessToken: result.tokens.accessToken,
					...(isMobile && { refreshToken: result.tokens.refreshToken }), // Mobile only
				},
			},
		});
		} catch (error) {
			next(error);
		}
	}

	/**
	 * TEMPORARY: Native Google Sign-In endpoint
	 * Accepts verified user info from mobile app
	 * Backend trusts mobile app's Google verification
	 */
	static async googleNativeAuth(req: Request, res: Response, next: NextFunction) {
		try {
			const { email, name, provider } = req.body;
			const result = await authenticateWithGoogleNative(
				{ email, name, provider },
				{
					...(req.ip && { ip: req.ip }),
					userAgent: req.headers['user-agent'] || '',
				}
			);

			const clientTypeHeader = req.headers['x-client-type'];
			const clientType = (Array.isArray(clientTypeHeader) ? clientTypeHeader[0] : clientTypeHeader)?.toLowerCase() || 'mobile';
			const isMobile = clientType === 'mobile';
			const isProduction = process.env.NODE_ENV === 'production';

			// Always set refresh token in HttpOnly, Secure cookie (for web clients)
			res.cookie('refreshToken', result.tokens.refreshToken, {
				httpOnly: true,
				secure: isProduction,
				sameSite: isProduction ? 'strict' : 'lax',
				maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
				path: '/',
			});

			// Set session ID cookie
			if (result.sessionId) {
				res.cookie('sessionId', result.sessionId, {
					httpOnly: true,
					secure: isProduction,
					sameSite: isProduction ? 'strict' : 'lax',
					maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
					path: '/',
				});
			}

			return successResponse(res, {
				message: 'Logged in with Google (Native)',
				data: {
					user: trainerToResponse(result.trainer),
					tokens: {
						accessToken: result.tokens.accessToken,
						...(isMobile && { refreshToken: result.tokens.refreshToken }), // Mobile only
					},
				},
			});
		} catch (error) {
			next(error);
		}
	}

	/**
	 * FINAL: Web OAuth Google Sign-In endpoint
	 * Handles OAuth code exchange server-side
	 * Production-ready implementation
	 */
	static async googleWebAuth(req: Request, res: Response, next: NextFunction) {
		try {
			const { code, redirectUri, codeVerifier } = req.body;
			const result = await authenticateWithGoogleWeb(
				code,
				redirectUri,
				codeVerifier,
				{
					...(req.ip && { ip: req.ip }),
					userAgent: req.headers['user-agent'] || '',
				}
			);

			const clientTypeHeader = req.headers['x-client-type'];
		const clientType = (Array.isArray(clientTypeHeader) ? clientTypeHeader[0] : clientTypeHeader)?.toLowerCase() || 'web';
			const isMobile = clientType === 'mobile';
			const isProduction = process.env.NODE_ENV === 'production';

			// Always set refresh token in HttpOnly, Secure cookie (for web clients)
			res.cookie('refreshToken', result.tokens.refreshToken, {
				httpOnly: true,
				secure: isProduction,
				sameSite: isProduction ? 'strict' : 'lax',
				maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
				path: '/',
			});

			// Set session ID cookie
			if (result.sessionId) {
				res.cookie('sessionId', result.sessionId, {
					httpOnly: true,
					secure: isProduction,
					sameSite: isProduction ? 'strict' : 'lax',
					maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
					path: '/',
				});
			}

			return successResponse(res, {
				message: 'Logged in with Google (Web OAuth)',
				data: {
					user: trainerToResponse(result.trainer),
					tokens: {
						accessToken: result.tokens.accessToken,
						...(isMobile && { refreshToken: result.tokens.refreshToken }), // Mobile only
					},
				},
			});
		} catch (error) {
			next(error);
		}
	}

	static async refresh(req: Request, res: Response, next: NextFunction) {
		try {
			// Get refresh token from cookie (preferred) or body (fallback)
			const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;
			if (!refreshToken) {
				throw new AppError('Refresh token required', 401);
			}

			const sessionId = req.cookies?.sessionId;
			const result = await refreshSession(refreshToken, {
				...(req.ip && { ip: req.ip }),
				userAgent: req.headers['user-agent'] || '',
				...(sessionId && { sessionId }),
			});

		// Platform-aware token delivery
		const clientTypeHeader = req.headers['x-client-type'];
		const clientType = (Array.isArray(clientTypeHeader) ? clientTypeHeader[0] : clientTypeHeader)?.toLowerCase() || 'web';
		const isMobile = clientType === 'mobile';
		const isProduction = process.env.NODE_ENV === 'production';

		// Always update refresh token cookie (for web clients)
		res.cookie('refreshToken', result.tokens.refreshToken, {
			httpOnly: true,
			secure: isProduction,
			sameSite: isProduction ? 'strict' : 'lax',
			maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
			path: '/',
		});

		// Update session ID cookie
		if (result.sessionId) {
			res.cookie('sessionId', result.sessionId, {
				httpOnly: true,
				secure: isProduction,
				sameSite: isProduction ? 'strict' : 'lax',
				maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
				path: '/',
			});
		}

		// Security: Only send refreshToken in response body for mobile clients
		// Web clients must use HttpOnly cookies only
		return successResponse(res, {
			message: 'Session refreshed',
			data: {
				user: trainerToResponse(result.trainer),
				tokens: {
					accessToken: result.tokens.accessToken,
					...(isMobile && { refreshToken: result.tokens.refreshToken }), // Mobile only
				},
			},
		});
		} catch (error) {
			next(error);
		}
	}

	static async logout(req: Request, res: Response, next: NextFunction) {
		try {
			// Get refresh token from cookie (preferred) or body (fallback)
			const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;
			if (!refreshToken) {
				// If no token, just clear cookies and return success
				res.clearCookie('refreshToken', { path: '/' });
				res.clearCookie('sessionId', { path: '/' });
				return successResponse(res, {
					message: 'Logged out successfully',
				});
			}

			await logout(refreshToken);
			
			// Clear cookies
			res.clearCookie('refreshToken', { path: '/' });
			res.clearCookie('sessionId', { path: '/' });
			return successResponse(res, {
				message: 'Logged out successfully',
			});
		} catch (error) {
			next(error);
		}
	}

	static async logoutAll(req: Request, res: Response, next: NextFunction) {
		try {
			const authUser = (req as any).authUser;
			if (!authUser) {
				throw new AppError('Authentication required', 401);
			}
			await logoutAllSessions(authUser.id);
			
			// Clear cookies
			res.clearCookie('refreshToken', { path: '/' });
			res.clearCookie('sessionId', { path: '/' });
			return successResponse(res, {
				message: 'All sessions revoked',
			});
		} catch (error) {
			next(error);
		}
	}

	static async updateProfile(req: Request, res: Response, next: NextFunction) {
		try {
			const authUser = (req as any).authUser;
			if (!authUser) {
				throw new AppError('Authentication required', 401);
			}
			await updateProfile(authUser.id, req.body);
			return successResponse(res, {
				message: 'Profile updated',
			});
		} catch (error) {
			next(error);
		}
	}

	static async getProfile(req: Request, res: Response, next: NextFunction) {
		try {
			const authUser = (req as any).authUser;
			if (!authUser) {
				throw new AppError('Authentication required', 401);
			}
			const profile = await getProfile(authUser.id);
			
			// If profile doesn't exist, return null instead of throwing error
			// This allows frontend to handle the case gracefully
			return successResponse(res, {
				message: 'Profile fetched',
				data: profile || null,
			});
		} catch (error: any) {
			logger.error('getProfile error', {
				error: error?.message || String(error),
				stack: error?.stack,
				userId: (req as any).authUser?.id,
				correlationId: (req as any).correlationId,
				service: 'trainer-auth-service',
			});
			next(error);
		}
	}

	static async submitApplication(req: Request, res: Response, next: NextFunction) {
		try {
			const applicationData = trainerApplicationSchema.parse(req.body);
			const result = await processTrainerApplication(applicationData);

			// TODO: Submit documents to verification service
			// For now, documents need to be submitted separately via /api/trainers/verification
			// You could enhance this to also handle document submission here

			return successResponse(res, {
				statusCode: 201,
				message: result.message,
				data: {
					trainerId: result.trainerId,
					status: result.status,
					nextSteps: [
						'Submit required documents for verification',
						'Wait for admin approval',
						'Complete face verification setup',
					],
				},
			});
		} catch (error) {
			next(error);
		}
	}

	/**
	 * Submit refactored trainer application (Enterprise-grade)
	 * POST /api/v1/trainers/auth/apply/refactored
	 */
	static async submitApplicationRefactored(req: Request, res: Response, next: NextFunction) {
		try {
			// Parse and validate input
			// Note: dateOfBirth is automatically coerced from string to Date by z.coerce.date()
			const applicationData = trainerApplicationSchemaRefactored.parse(req.body);

			// Process application
			const pool = getPool();
			const result = await processTrainerApplicationRefactored(applicationData, pool);

			return successResponse(res, {
				statusCode: 201,
				message: result.message,
				data: {
					trainerId: result.trainerId,
					applicationId: result.applicationId,
					status: result.status,
					nextSteps: [
						'Application submitted successfully',
						'Documents are being verified',
						'Wait for admin review and city/zone assignment',
					],
				},
			});
		} catch (error) {
			next(error);
		}
	}

	/**
	 * Get availability preview (generates slots based on shift type)
	 * POST /api/v1/trainers/auth/apply/preview-availability
	 * Business Rule: Only full-time trainers with fixed shifts
	 */
	static async previewAvailability(req: Request, res: Response, next: NextFunction) {
		try {
			const { shiftType } = req.body;

			if (!shiftType || !['morning', 'evening'].includes(shiftType)) {
				throw new AppError('Shift type is required and must be either morning or evening', 400);
			}

			const slots = getAvailabilityPreview(shiftType as 'morning' | 'evening');

			return successResponse(res, {
				statusCode: 200,
				message: 'Availability preview generated',
				data: {
					slots,
					count: slots.length,
				},
			});
		} catch (error) {
			next(error);
		}
	}

	static async forgotPassword(req: Request, res: Response, next: NextFunction) {
		try {
			const { email } = req.body;
			await requestPasswordReset(email);
			return successResponse(res, {
				message: 'If an account exists for that email, a reset code has been sent.',
			});
		} catch (error) {
			next(error);
		}
	}

	static async resetPassword(req: Request, res: Response, next: NextFunction) {
		try {
			const { email, otp, newPassword } = req.body;
			await resetPasswordWithOtp({ email, otp, newPassword });
			return successResponse(res, {
				message: 'Password reset successfully. You can now log in with your new password.',
			});
		} catch (error) {
			next(error);
		}
	}

	static async changePassword(req: Request, res: Response, next: NextFunction) {
		try {
			const authUser = (req as any).authUser;
			if (!authUser) {
				throw new AppError('Authentication required', 401);
			}
			const { currentPassword, newPassword } = req.body;
			await changePassword(authUser.id, currentPassword, newPassword);
			return successResponse(res, {
				message: 'Password updated successfully. You will need to sign in again.',
			});
		} catch (error) {
			next(error);
		}
	}

	/**
	 * Resolve pincode to city information
	 * Public endpoint - no authentication required
	 * Used for auto-fill during trainer application
	 */
	static async resolvePincode(req: Request, res: Response, next: NextFunction) {
		try {
			const { pincode } = req.params;

			if (!pincode) {
				throw new AppError('Pincode is required', 400);
			}

			const result = await pincodeService.resolvePincode(pincode);

			if (!result) {
				return successResponse(res, {
					statusCode: 404,
					message: 'Pincode not found',
					data: null,
				});
			}

			return successResponse(res, {
				statusCode: 200,
				message: 'Pincode resolved successfully',
				data: result,
			});
		} catch (error) {
			next(error);
		}
	}

	/**
	 * Get available active courses for trainer application
	 * Public endpoint - no authentication required
	 * Used to populate course selection in application form
	 */
	static async getAvailableCourses(req: Request, res: Response, next: NextFunction) {
		try {
			const pool = getPool();
			const courses = await getAvailableCourses(pool);

			if (process.env.NODE_ENV !== 'production') {
				logger.debug('getAvailableCourses - courses found', {
					coursesCount: courses.length,
					correlationId: (req as any).correlationId,
					service: 'trainer-auth-service',
				});
			}

			return successResponse(res, {
				statusCode: 200,
				message: 'Available courses retrieved successfully',
				data: courses.map(course => ({
					id: course.id,
					name: course.name,
					title: course.title,
					code: course.code,
				})),
			});
		} catch (error) {
			if (process.env.NODE_ENV !== 'production') {
				logger.error('getAvailableCourses error', {
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					correlationId: (req as any).correlationId,
					service: 'trainer-auth-service',
				});
			}
			next(error);
		}
	}
}

