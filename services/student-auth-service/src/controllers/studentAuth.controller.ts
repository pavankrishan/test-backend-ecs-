import { Request, Response, NextFunction } from 'express';
import { successResponse, AppError } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';
import {
	registerWithEmail,
	resendEmailOtp,
	verifyEmailOtpForStudent,
	loginWithEmailPassword,
	requestPhoneOtp,
	verifyPhoneOtp,
	retryPhoneOtp,
	refreshSession,
	logout,
	logoutAllSessions,
	updateProfile,
	authenticateWithGoogle,
	authenticateWithGoogleNative,
	authenticateWithGoogleWeb,
	getProfile,
	requestPasswordReset,
	resetPasswordWithOtp,
	changePassword,
} from '../services/studentAuth.service';
import type { StudentRecord } from '../models/student.model';

function studentToResponse(student: StudentRecord) {
	return {
		id: student.id,
		email: student.email,
		username: student.username,
		phone: student.phone,
		isEmailVerified: student.isEmailVerified,
		isPhoneVerified: student.isPhoneVerified,
		googleId: student.googleId,
		lastLoginAt: student.lastLoginAt,
		createdAt: student.createdAt,
		updatedAt: student.updatedAt,
	};
}

export class StudentAuthController {
	static async register(req: Request, res: Response, next: NextFunction) {
		try {
			logger.info('Registration request received', {
				email: req.body?.email,
				hasUsername: !!req.body?.username,
				hasPhone: !!req.body?.phone,
				correlationId: (req as any).correlationId,
				service: 'student-auth-service',
			});
			const result = await registerWithEmail(req.body);
			const isNewAccount = result.status === 'created';
			logger.info('Registration successful', {
				studentId: result.studentId,
				status: result.status,
				isNewAccount,
				email: req.body?.email,
				correlationId: (req as any).correlationId,
				service: 'student-auth-service',
			});
			return successResponse(res, {
				statusCode: isNewAccount ? 201 : 200,
				message: isNewAccount
					? 'Registration successful. Please verify your email.'
					: 'Account pending verification. A new OTP has been sent.',
				data: { studentId: result.studentId, status: result.status },
			});
		} catch (error) {
			logger.error('Registration error', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				email: req.body?.email,
				correlationId: (req as any).correlationId,
				service: 'student-auth-service',
			});
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
			await verifyEmailOtpForStudent(email, otp);
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
		
		// Debug logging for mobile detection (development only)
		if (process.env.NODE_ENV !== 'production') {
			logger.debug('Login request - client type detection', {
				clientTypeHeader: req.headers['x-client-type'],
				clientType,
				isMobile,
				willIncludeRefreshToken: isMobile,
				correlationId: (req as any).correlationId,
				service: 'student-auth-service',
			});
		}

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
				user: studentToResponse(result.student),
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
				user: studentToResponse(result.student),
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
				user: studentToResponse(result.student),
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
					user: studentToResponse(result.student),
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
					user: studentToResponse(result.student),
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
			// Get refresh token from cookie (preferred for web) or body (required for mobile)
			const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
			const sessionId = req.cookies?.sessionId;

			if (!refreshToken) {
				throw new AppError('Refresh token required. Please provide refreshToken in request body (mobile) or cookie (web).', 401);
			}

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
		const sameSite = isProduction ? 'strict' : 'lax';
		
		// Always update refresh token cookie (for web clients)
		res.cookie('refreshToken', result.tokens.refreshToken, {
			httpOnly: true,
			secure: isProduction, // Only secure in production (HTTPS required)
			sameSite: sameSite,
			maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
			path: '/',
		});

		// Update session ID cookie if new session was created
		if (result.sessionId) {
			res.cookie('sessionId', result.sessionId, {
				httpOnly: true,
				secure: isProduction, // Only secure in production (HTTPS required)
				sameSite: sameSite,
				maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
				path: '/',
			});
		}

		// Security: Only send refreshToken in response body for mobile clients
		// Web clients must use HttpOnly cookies only
		return successResponse(res, {
			message: 'Session refreshed',
			data: {
				user: studentToResponse(result.student),
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
			const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
			const sessionId = req.cookies?.sessionId;

			if (refreshToken) {
				await logout(refreshToken, sessionId);
			}

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
			const authHeader = typeof req.headers?.authorization === 'string' ? req.headers.authorization : undefined;
			await updateProfile(authUser.id, req.body, authHeader);
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
			return successResponse(res, {
				message: 'Profile fetched',
				data: profile,
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
}

