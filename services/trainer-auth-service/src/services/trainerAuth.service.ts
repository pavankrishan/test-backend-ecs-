import bcrypt from 'bcryptjs';
import { addMinutes, isBefore } from 'date-fns';
import {
	signAccessToken,
	signRefreshToken,
	verifyRefreshToken,
	AppError,
	isAccountLocked,
	recordFailedAttempt,
	clearFailedAttempts,
	getRemainingAttempts,
} from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';
import {
	createSession,
	acquireRefreshLock,
	releaseRefreshLock,
	waitForRefreshLock,
	updateSessionActivity,
} from '@kodingcaravan/shared/utils/sessionManager';
import {
	createTrainer,
	deleteEmailOtp,
	findTrainerByEmail,
	findTrainerByGoogleId,
	findTrainerById,
	findTrainerByPhone,
	findTrainerByUsername,
	getEmailOtp,
	getTrainerProfile,
	incrementEmailOtpAttempts,
	linkGoogleAccount,
	revokeAllRefreshTokens,
	revokeRefreshToken,
	storeRefreshToken,
	updateTrainerAccount,
	updateTrainerVerification,
	upsertEmailOtp,
	upsertTrainerProfile,
	findRefreshToken,
	findRefreshTokenWithLock,
	updateTrainerPassword,
	type TrainerRecord,
	type TrainerProfileRecord,
} from '../models/trainerAuth.model';
import { withTransaction } from '../config/database';
import { generateNumericOtp, hashString } from '../utils/crypto';
import { sendMsg91Otp, verifyMsg91Otp, retryMsg91Otp } from '../integrations/msg91';
import { sendEmailOtp } from '../integrations/mailer';
import { verifyGoogleIdToken, exchangeCodeForIdToken } from '../integrations/googleAuth';

const OTP_EXPIRY_MINUTES = 10;
const PHONE_OTP_MAX_ATTEMPTS = 5;
const EMAIL_OTP_MAX_ATTEMPTS = 5;
// Validate bcrypt salt rounds - must be >= 12 for production security, >= 10 for development
const BCRYPT_ROUNDS = (() => {
	const rounds = Number(process.env.BCRYPT_SALT_ROUNDS || 12);
	const isProduction = process.env.NODE_ENV === 'production';
	const minRounds = isProduction ? 12 : 10;
	
	if (rounds < minRounds) {
		throw new Error(
			`BCRYPT_SALT_ROUNDS must be at least ${minRounds} for ${isProduction ? 'production' : 'development'} security. Current value: ${rounds}`
		);
	}
	return rounds;
})();

type TokenPair = {
	accessToken: string;
	refreshToken: string;
};

function issueTokens(trainer: TrainerRecord): TokenPair {
	const payload = {
		sub: trainer.id,
		role: 'trainer',
		phone: trainer.phone,
		email: trainer.email,
	};

	return {
		accessToken: signAccessToken(payload),
		refreshToken: signRefreshToken(payload),
	};
}

function normalizePhone(phone: string): string {
	return phone.replace(/\D/g, '');
}

function normalizeOtpInput(raw: string): string {
	return raw.replace(/\s+/g, '').trim();
}

export async function registerWithEmail(input: {
	email: string;
	password: string;
	username: string;
	phone?: string | null;
}): Promise<{ trainerId: string }> {
	const email = input.email.toLowerCase().trim();
	const username = input.username.toLowerCase().trim();
	const phone = input.phone ? normalizePhone(input.phone) : null;

	const [existingEmail, existingUsername, existingPhone] = await Promise.all([
		findTrainerByEmail(email),
		findTrainerByUsername(username),
		phone ? findTrainerByPhone(phone) : Promise.resolve(null),
	]);

	if (existingEmail) {
		if (existingEmail.isEmailVerified) {
			throw new AppError('Email already registered', 409);
		}

		const otpCode = generateNumericOtp();
		const otpHash = hashString(otpCode);
		const expiresAt = addMinutes(new Date(), OTP_EXPIRY_MINUTES);

		logger.debug('Email OTP generated for trainer registration', {
			email: email.substring(0, 3) + '***',
			trainerId: existingEmail.id,
			service: 'trainer-auth-service',
		});
		await upsertEmailOtp(existingEmail.id, otpHash, expiresAt);
		await sendEmailOtp(email, otpCode);

		return { trainerId: existingEmail.id };
	}
	if (existingUsername) {
		throw new AppError('Username already taken', 409);
	}
	if (existingPhone && phone) {
		throw new AppError('Phone already in use', 409);
	}

	const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
	const otpCode = generateNumericOtp();
	const otpHash = hashString(otpCode);
	const expiresAt = addMinutes(new Date(), OTP_EXPIRY_MINUTES);

	const trainer = await withTransaction(async (client) => {
		const created = await createTrainer(
			{
				email,
				username,
				passwordHash,
				phone,
			},
			client
		);

		await upsertEmailOtp(created.id, otpHash, expiresAt, client);
		return created;
	});

	logger.debug('Email OTP generated for new trainer', {
		email: email.substring(0, 3) + '***',
		trainerId: trainer.id,
		service: 'trainer-auth-service',
	});
	await sendEmailOtp(email, otpCode);

	return { trainerId: trainer.id };
}

export async function resendEmailOtp(email: string): Promise<void> {
	const trainer = await findTrainerByEmail(email.toLowerCase());
	if (!trainer) {
		throw new AppError('Account not found', 404);
	}
	if (trainer.isEmailVerified) {
		throw new AppError('Email already verified', 400);
	}

	const otpCode = generateNumericOtp();
	const otpHash = hashString(otpCode);
	const expiresAt = addMinutes(new Date(), OTP_EXPIRY_MINUTES);

	logger.debug('Email OTP resend for trainer', {
		email: trainer.email?.substring(0, 3) + '***',
		trainerId: trainer.id,
		service: 'trainer-auth-service',
	});
	await upsertEmailOtp(trainer.id, otpHash, expiresAt);
	await sendEmailOtp(trainer.email!, otpCode);
}

export async function verifyEmailOtpForTrainer(email: string, otp: string): Promise<void> {
	const trainer = await findTrainerByEmail(email.toLowerCase());
	if (!trainer) {
		throw new AppError('Account not found', 404);
	}
	if (!trainer.email) {
		throw new AppError('Email not linked to account', 400);
	}
	if (trainer.isEmailVerified) {
		await deleteEmailOtp(trainer.id);
		return;
	}

	const record = await getEmailOtp(trainer.id);
	if (!record) {
		throw new AppError('Verification code not found or expired', 400);
	}
	if (record.attemptCount >= EMAIL_OTP_MAX_ATTEMPTS) {
		throw new AppError('Maximum verification attempts exceeded', 429);
	}
	if (isBefore(record.expiresAt, new Date())) {
		await deleteEmailOtp(trainer.id);
		throw new AppError('Verification code expired', 400);
	}

	const hashed = hashString(otp);
	if (hashed !== record.codeHash) {
		await incrementEmailOtpAttempts(trainer.id);
		throw new AppError('Invalid verification code', 400);
	}

	await withTransaction(async (client) => {
		await updateTrainerVerification(
			trainer.id,
			{
				isEmailVerified: true,
			},
			client
		);
		await deleteEmailOtp(trainer.id, client);
	});
}

export async function loginWithEmailPassword(
	email: string,
	password: string,
	meta: { ip?: string; userAgent?: string }
): Promise<{ tokens: TokenPair; trainer: TrainerRecord; sessionId: string }> {
	const trainer = await findTrainerByEmail(email.toLowerCase());
	if (!trainer || !trainer.passwordHash) {
		// Record failed attempt even if user doesn't exist (prevent user enumeration)
		if (trainer) {
			recordFailedAttempt(trainer.id);
			logger.warn('Login failed - invalid credentials', {
				email: email.toLowerCase(),
				trainerId: trainer.id,
				ip: meta.ip,
				service: 'trainer-auth-service',
			});
		} else {
			logger.warn('Login failed - account not found', {
				email: email.toLowerCase(),
				ip: meta.ip,
				service: 'trainer-auth-service',
			});
		}
		throw new AppError('Invalid credentials', 401);
	}

	// Check if account is locked
	const lockStatus = isAccountLocked(trainer.id);
	if (lockStatus.locked) {
		const minutesRemaining = Math.ceil(
			(lockStatus.lockedUntil!.getTime() - Date.now()) / (60 * 1000)
		);
		logger.warn('Login failed - account locked', {
			email: email.toLowerCase(),
			trainerId: trainer.id,
			minutesRemaining,
			ip: meta.ip,
			service: 'trainer-auth-service',
		});
		throw new AppError(
			`Account locked due to too many failed login attempts. Please try again after ${minutesRemaining} minutes.`,
			423
		);
	}

	const match = await bcrypt.compare(password, trainer.passwordHash);
	if (!match) {
		recordFailedAttempt(trainer.id);
		const remaining = getRemainingAttempts(trainer.id);
		logger.warn('Login failed - password mismatch', {
			email: email.toLowerCase(),
			trainerId: trainer.id,
			remainingAttempts: remaining,
			ip: meta.ip,
			service: 'trainer-auth-service',
		});
		if (remaining > 0) {
			throw new AppError(`Invalid credentials. ${remaining} attempt(s) remaining.`, 401);
		}
		throw new AppError('Invalid credentials', 401);
	}

	if (!trainer.isEmailVerified) {
		throw new AppError('Email not verified', 403);
	}

	// Clear failed attempts on successful login
	clearFailedAttempts(trainer.id);

	logger.info('Login successful', {
		email: email.toLowerCase(),
		trainerId: trainer.id,
		ip: meta.ip,
		service: 'trainer-auth-service',
	});

	const tokens = issueTokens(trainer);
	await persistRefreshToken(trainer.id, tokens.refreshToken, meta);
	await updateTrainerVerification(trainer.id, { lastLoginAt: new Date() });

	// Create Redis session
	const sessionId = await createSession(trainer.id, 'trainer', meta);

	return { tokens, trainer, sessionId };
}

export async function requestPasswordReset(emailInput: string): Promise<void> {
	const email = emailInput.toLowerCase().trim();
	const trainer = await findTrainerByEmail(email);

	// Do not reveal whether account exists to the client
	if (!trainer || !trainer.passwordHash) {
		return;
	}

	if (!trainer.isEmailVerified) {
		throw new AppError('Please verify your email before resetting your password', 400);
	}

	const otpCode = generateNumericOtp();
	const otpHash = hashString(otpCode);
	const expiresAt = addMinutes(new Date(), OTP_EXPIRY_MINUTES);

	logger.info('Password reset OTP generated', {
		email: email.substring(0, 3) + '***',
		trainerId: trainer.id,
		service: 'trainer-auth-service',
	});
	await upsertEmailOtp(trainer.id, otpHash, expiresAt);
	await sendEmailOtp(email, otpCode);
}

export async function resetPasswordWithOtp(input: {
	email: string;
	otp: string;
	newPassword: string;
}): Promise<void> {
	const email = input.email.toLowerCase().trim();
	const trainer = await findTrainerByEmail(email);

	if (!trainer || !trainer.passwordHash) {
		throw new AppError('Invalid reset request', 400);
	}

	const record = await getEmailOtp(trainer.id);
	if (!record) {
		throw new AppError('Reset code not found or expired', 400);
	}
	if (record.attemptCount >= EMAIL_OTP_MAX_ATTEMPTS) {
		throw new AppError('Maximum verification attempts exceeded', 429);
	}
	if (isBefore(record.expiresAt, new Date())) {
		await deleteEmailOtp(trainer.id);
		throw new AppError('Reset code expired', 400);
	}

	const hashed = hashString(input.otp.trim());
	if (hashed !== record.codeHash) {
		await incrementEmailOtpAttempts(trainer.id);
		throw new AppError('Invalid reset code', 400);
	}

	const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);

	await withTransaction(async (client) => {
		await updateTrainerPassword(trainer.id, passwordHash, client);
		await deleteEmailOtp(trainer.id, client);
		await revokeAllRefreshTokens(trainer.id, client);
	});
}

export async function changePassword(
	trainerId: string,
	currentPassword: string,
	newPassword: string
): Promise<void> {
	const trainer = await findTrainerById(trainerId);
	if (!trainer || !trainer.passwordHash) {
		throw new AppError('Password-based login is not enabled for this account', 400);
	}

	const match = await bcrypt.compare(currentPassword, trainer.passwordHash);
	if (!match) {
		throw new AppError('Current password is incorrect', 400);
	}

	const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

	await withTransaction(async (client) => {
		await updateTrainerPassword(trainer.id, passwordHash, client);
		await revokeAllRefreshTokens(trainer.id, client);
	});
}

export async function requestPhoneOtp(phoneInput: string): Promise<{ devOtp?: string }> {
	const phone = normalizePhone(phoneInput);
	if (phone.length < 10) {
		throw new AppError('Invalid phone number', 400);
	}

	// MSG91 generates and sends OTP - no need to generate or store locally
	const result = await sendMsg91Otp(phone);

	if (result.provider === 'local' || process.env.NODE_ENV !== 'production') {
		logger.debug('Phone OTP for dev mode - OTP will be generated by MSG91', {
			phone: phone.substring(0, 4) + '****',
			service: 'trainer-auth-service',
		});
		// In dev mode, we can't return a dev OTP since MSG91 generates it
		return {};
	}

	logger.info('Code dispatched via Msg91', {
		phone: phone.substring(0, 4) + '****',
		provider: result.provider,
		requestId: result.requestId ?? 'n/a',
		service: 'trainer-auth-service',
	});

	return {};
}

export async function verifyPhoneOtp(
	phoneInput: string,
	otp: string,
	meta: { ip?: string; userAgent?: string }
): Promise<{ tokens: TokenPair; trainer: TrainerRecord; sessionId: string }> {
	const phone = normalizePhone(phoneInput);
	const sanitizedOtp = normalizeOtpInput(otp);
	if (!/^\d{4,6}$/.test(sanitizedOtp)) {
		throw new AppError('Invalid code format', 400);
	}

	// Verify OTP using MSG91's verify endpoint
	const verifyResult = await verifyMsg91Otp(phone, sanitizedOtp);
	if (!verifyResult.success) {
		throw new AppError(verifyResult.error || 'Invalid or expired OTP', 400);
	}

	let trainer = await findTrainerByPhone(phone);
	if (!trainer) {
		trainer = await createTrainer({ phone });
	}

	await withTransaction(async (client) => {
		await updateTrainerVerification(
			trainer!.id,
			{ isPhoneVerified: true, lastLoginAt: new Date() },
			client
		);
	});

	trainer = {
		...trainer,
		isPhoneVerified: true,
		lastLoginAt: new Date(),
	};

	const tokens = issueTokens(trainer);
	await persistRefreshToken(trainer.id, tokens.refreshToken, meta);

	// Create Redis session
	const sessionId = await createSession(trainer.id, 'trainer', meta);

	return { tokens, trainer, sessionId };
}

/**
 * Retry/resend OTP using MSG91 retry endpoint
 */
export async function retryPhoneOtp(
	phoneInput: string,
	retryType: 'text' | 'voice' = 'text'
): Promise<void> {
	const phone = normalizePhone(phoneInput);
	if (phone.length < 10) {
		throw new AppError('Invalid phone number', 400);
	}

	const result = await retryMsg91Otp(phone, retryType);
	if (!result.success) {
		throw new AppError(result.error || 'Failed to resend OTP', 400);
	}
}

/**
 * TEMPORARY: Native Google Sign-In endpoint
 * Accepts verified user info from mobile app (email, name, etc.)
 * Backend does NOT verify Google tokens - trusts mobile app verification
 * 
 * @deprecated This is temporary. Use authenticateWithGoogleWeb for production.
 */
export async function authenticateWithGoogleNative(
	userInfo: {
		email: string;
		name?: string;
		provider: 'google';
	},
	meta: { ip?: string; userAgent?: string }
): Promise<{ tokens: TokenPair; trainer: TrainerRecord; sessionId: string }> {
	// Validate input
	if (!userInfo.email || !userInfo.email.includes('@')) {
		throw new AppError('Valid email is required', 400);
	}

	const email = userInfo.email.toLowerCase().trim();
	
	// Find or create user by EMAIL (primary identity)
	// Do NOT rely on Google UID - email is the source of truth
	let trainer = await findTrainerByEmail(email);
	const isNewTrainer = !trainer;

	if (!trainer) {
		// Create new trainer with email as primary identifier
		trainer = await createTrainer({
			email,
			username: email.split('@')[0] || null,
			// Do NOT set googleId - we don't trust it from mobile
			// auth_provider will be set via update
		});
	}

	// Update auth_provider to mark as native (temporary)
	// This allows tracking migration later
	await updateTrainerAccount(trainer.id, {
		authProvider: 'google_native',
	});

	const updated = await updateTrainerVerification(trainer.id, {
		isEmailVerified: true,
		lastLoginAt: new Date(),
	});

	if (updated) {
		trainer = updated;
	}

	const tokens = issueTokens(trainer);
	await persistRefreshToken(trainer.id, tokens.refreshToken, meta);

	// Create Redis session
	const sessionId = await createSession(trainer.id, 'trainer', meta);

	return { tokens, trainer: { ...trainer, isEmailVerified: true }, sessionId };
}

/**
 * FINAL: Web OAuth Google Sign-In endpoint
 * Handles OAuth code exchange server-side and verifies ID token
 * This is the production-ready implementation
 */
export async function authenticateWithGoogleWeb(
	code: string,
	redirectUri: string,
	codeVerifier?: string,
	meta: { ip?: string; userAgent?: string } = {}
): Promise<{ tokens: TokenPair; trainer: TrainerRecord; sessionId: string }> {
	// Step 1: Exchange authorization code for ID token (server-side)
	const idToken = await exchangeCodeForIdToken(code, redirectUri, codeVerifier);

	// Step 2: Verify ID token with Google
	const payload = await verifyGoogleIdToken(idToken);
	if (!payload || !payload.email || !payload.sub) {
		throw new AppError('Unable to verify Google account', 401);
	}

	// Step 3: Find or create user by EMAIL (primary identity)
	// Email is the source of truth, not Google UID
	const email = payload.email.toLowerCase();
	let trainer = await findTrainerByEmail(email);
	const isNewTrainer = !trainer;

	if (!trainer) {
		// Create new trainer
		trainer = await createTrainer({
			email,
			username: email.split('@')[0] || null,
			googleId: payload.sub, // Store Google UID for reference only
		});
	} else if (!trainer.googleId) {
		// Link Google account to existing email-based account
		const linked = await linkGoogleAccount(trainer.id, payload.sub);
		if (linked) {
			trainer = linked;
		}
	}

	// Update auth_provider to mark as web (final)
	await updateTrainerAccount(trainer.id, {
		authProvider: 'google_web',
	});

	const updated = await updateTrainerVerification(trainer.id, {
		isEmailVerified: true,
		lastLoginAt: new Date(),
	});

	if (updated) {
		trainer = updated;
	}

	const tokens = issueTokens(trainer);
	await persistRefreshToken(trainer.id, tokens.refreshToken, meta);

	// Create Redis session
	const sessionId = await createSession(trainer.id, 'trainer', meta);

	return { tokens, trainer: { ...trainer, isEmailVerified: true }, sessionId };
}

/**
 * Legacy endpoint - kept for backward compatibility
 * Uses ID token verification (works for both native and web)
 * 
 * @deprecated Prefer authenticateWithGoogleNative or authenticateWithGoogleWeb
 */
export async function authenticateWithGoogle(
	idToken: string,
	meta: { ip?: string; userAgent?: string }
): Promise<{ tokens: TokenPair; trainer: TrainerRecord; sessionId: string }> {
	const payload = await verifyGoogleIdToken(idToken);
	if (!payload || !payload.email || !payload.sub) {
		throw new AppError('Unable to verify Google account', 401);
	}

	const email = payload.email.toLowerCase();
	let trainer =
		(await findTrainerByGoogleId(payload.sub)) || (await findTrainerByEmail(email));

	if (!trainer) {
		trainer = await createTrainer({
			email,
			username: email.split('@')[0] || null,
			googleId: payload.sub,
		});
	} else if (!trainer.googleId) {
		const linked = await linkGoogleAccount(trainer.id, payload.sub);
		if (linked) {
			trainer = linked;
		}
	}

	const updated = await updateTrainerVerification(trainer.id, {
		isEmailVerified: true,
		lastLoginAt: new Date(),
	});

	if (updated) {
		trainer = updated;
	}

	const tokens = issueTokens(trainer);
	await persistRefreshToken(trainer.id, tokens.refreshToken, meta);

	// Create Redis session
	const sessionId = await createSession(trainer.id, 'trainer', meta);

	return { tokens, trainer: { ...trainer, isEmailVerified: true }, sessionId };
}

export async function persistRefreshToken(
	trainerId: string,
	refreshToken: string,
	meta: { ip?: string; userAgent?: string }
): Promise<void> {
	const payload = verifyRefreshToken<{ exp: number }>(refreshToken);
	const expiresAt = new Date(payload.exp * 1000);
	const tokenHash = hashString(refreshToken);
	await storeRefreshToken(trainerId, tokenHash, expiresAt, meta);
}

export async function refreshSession(
	refreshToken: string,
	meta: { ip?: string; userAgent?: string; sessionId?: string }
): Promise<{ tokens: TokenPair; trainer: TrainerRecord; sessionId: string }> {
	let payload: any;
	try {
		payload = verifyRefreshToken(refreshToken);
	} catch (error) {
		logger.warn('Refresh token verification failed', {
			error: error instanceof Error ? error.message : String(error),
			ip: meta.ip,
			service: 'trainer-auth-service',
		});
		throw new AppError('Invalid refresh token', 401);
	}

	const trainerId = payload.sub as string;
	
	// Get or create session ID
	let sessionId = meta.sessionId;
	if (!sessionId) {
		// Try to find existing session for this user
		// For now, create a new session if none exists
		sessionId = await createSession(trainerId, 'trainer', meta);
	}

	// Acquire distributed refresh lock to prevent concurrent refreshes
	const lockAcquired = await acquireRefreshLock(sessionId);
	if (!lockAcquired) {
		// Another refresh is in progress - wait for it to complete
		const lockReleased = await waitForRefreshLock(sessionId, 5000);
		if (!lockReleased) {
			throw new AppError('Refresh in progress, please retry', 429);
		}
		// Lock released, try to acquire again
		const retryAcquired = await acquireRefreshLock(sessionId);
		if (!retryAcquired) {
			throw new AppError('Refresh in progress, please retry', 429);
		}
	}

	try {
		// Use transaction to ensure atomicity
		const result = await withTransaction(async (client) => {
			// First verify trainer exists
			const trainer = await findTrainerById(trainerId, client);
			if (!trainer) {
				// Return 401 instead of 404 since this is an authentication issue
				throw new AppError('Account not found', 401);
			}

			const tokenHash = hashString(refreshToken);
			
			// Lock the token row to prevent concurrent refresh attempts
			const stored = await findRefreshTokenWithLock(tokenHash, client);
			if (!stored) {
				throw new AppError('Refresh token not found', 401);
			}
			if (stored.revokedAt) {
				// Token was revoked - check if it was recently revoked (within last 5 seconds)
				// This might indicate a race condition where another refresh succeeded
				const revokedTime = stored.revokedAt.getTime();
				const now = Date.now();
				const timeSinceRevocation = now - revokedTime;
				
				if (timeSinceRevocation < 5000) {
					// Token was recently revoked - might be a race condition
					// Check if there's a newer active token for this user
					const newerTokenResult = await client.query<{ token_hash: string; created_at: Date }>(
						`
							SELECT token_hash, created_at
							FROM trainer_refresh_tokens
							WHERE trainer_id = $1
								AND revoked_at IS NULL
								AND expires_at > NOW()
								AND created_at > $2
							ORDER BY created_at DESC
							LIMIT 1
						`,
						[trainerId, stored.revokedAt]
					);
					
					if (newerTokenResult.rows.length > 0) {
						// There's a newer token - this was likely a race condition
						// Return a more helpful error message
						throw new AppError('Refresh token was already used. Please use the latest refresh token.', 401);
					}
				}
				// Token was revoked (either old revocation or no newer token found)
				throw new AppError('Refresh token revoked', 401);
			}
			if (isBefore(stored.expiresAt, new Date())) {
				throw new AppError('Refresh token expired', 401);
			}

			// CRITICAL FIX: Issue new tokens FIRST, then revoke old token
			// This prevents race conditions where concurrent refreshes see the token as revoked
			// before the new token is stored
			const tokens = issueTokens(trainer);
			
			// Persist new refresh token FIRST using the transaction client
			const tokenPayload = verifyRefreshToken<{ exp: number }>(tokens.refreshToken);
			const expiresAt = new Date(tokenPayload.exp * 1000);
			const newTokenHash = hashString(tokens.refreshToken);
			await storeRefreshToken(
				trainer.id, 
				newTokenHash, 
				expiresAt, 
				{ userAgent: meta.userAgent || null, ipAddress: meta.ip || null }, 
				client
			);

			// NOW revoke old token (after new one is safely stored)
			// This ensures that even if another refresh call happens concurrently,
			// it will either:
			// 1. See the old token as still valid (if it got the lock first)
			// 2. See the new token as valid (if it happens after this completes)
			await revokeRefreshToken(tokenHash, client);

			return { tokens, trainer };
		}).catch((error: any) => {
			// Handle database connection errors gracefully
			if (error?.code === 'ENOTFOUND' || 
			    error?.message?.includes('getaddrinfo') ||
			    error?.message?.includes('ECONNREFUSED') ||
			    error?.message?.includes('connection')) {
				// Database connection error - return 503 Service Unavailable
				// This indicates a temporary infrastructure issue, not an auth failure
				throw new AppError('Service temporarily unavailable. Please try again.', 503);
			}
			// Re-throw AppError instances (like 401 errors) as-is
			if (error instanceof AppError) {
				throw error;
			}
			// For other errors, wrap in AppError
			throw new AppError(error?.message || 'Failed to refresh session', 500);
		});

		// Update Redis session TTL and last activity (non-critical, don't fail if this errors)
		try {
			await updateSessionActivity(sessionId);
		} catch (redisError) {
			// Log but don't fail the refresh if Redis is unavailable
			if (process.env.NODE_ENV !== 'production') {
				logger.warn('Failed to update session activity in Redis', {
					error: redisError instanceof Error ? redisError.message : String(redisError),
					sessionId,
					service: 'trainer-auth-service',
				});
			}
		}

		return { ...result, sessionId };
	} finally {
		await releaseRefreshLock(sessionId);
	}
}

export async function logout(refreshToken: string): Promise<void> {
	const tokenHash = hashString(refreshToken);
	await revokeRefreshToken(tokenHash);
}

export async function logoutAllSessions(trainerId: string): Promise<void> {
	await revokeAllRefreshTokens(trainerId);
}

export async function updateProfile(
	trainerId: string,
	profile: {
		fullName?: string;
		age?: number;
		gender?: string;
		address?: string;
		expertise?: string;
		experienceYears?: number;
		extra?: Record<string, unknown>;
		email?: string;
		phone?: string;
	}
): Promise<void> {
	const trainer = await findTrainerById(trainerId);
	if (!trainer) {
		throw new AppError('Account not found', 404);
	}

	// Update email if provided and different
	if (profile.email && profile.email.toLowerCase().trim() !== trainer.email?.toLowerCase().trim()) {
		const newEmail = profile.email.toLowerCase().trim();
		// Check if email is already taken by another trainer
		const existingTrainer = await findTrainerByEmail(newEmail);
		if (existingTrainer && existingTrainer.id !== trainerId) {
			throw new AppError('Email is already registered', 409);
		}
		// Update email in trainer account (will need to be verified again)
		await updateTrainerAccount(trainerId, { email: newEmail, isEmailVerified: false });
	}

	// Update phone if provided and different
	if (profile.phone && normalizePhone(profile.phone) !== normalizePhone(trainer.phone || '')) {
		const newPhone = normalizePhone(profile.phone);
		if (newPhone.length < 10) {
			throw new AppError('Invalid phone number', 400);
		}
		// Check if phone is already taken by another trainer
		const existingTrainer = await findTrainerByPhone(newPhone);
		if (existingTrainer && existingTrainer.id !== trainerId) {
			throw new AppError('Phone number is already registered', 409);
		}
		// Update phone in trainer account (will need to be verified again)
		await updateTrainerAccount(trainerId, { phone: newPhone, isPhoneVerified: false });
	}

	// Update profile (excluding email and phone which are handled above)
	const { email, phone, ...profileData } = profile;
	await upsertTrainerProfile(trainerId, profileData);
}

export async function getProfile(trainerId: string): Promise<TrainerProfileRecord | null> {
	try {
		const trainer = await findTrainerById(trainerId);
		if (!trainer) {
			logger.warn('Trainer not found for getProfile', {
				trainerId,
				service: 'trainer-auth-service',
			});
			throw new AppError('Account not found', 404);
		}
		
		const profile = await getTrainerProfile(trainerId);
		
		// If profile doesn't exist, return a minimal profile with approval status
		if (!profile) {
			logger.debug('Profile not found for trainer, returning minimal profile', {
				trainerId,
				service: 'trainer-auth-service',
			});
			return {
				id: '',
				trainerId,
				fullName: null,
				age: null,
				gender: null,
				address: null,
				expertise: null,
				specialties: null,
				experienceYears: null,
				extra: null,
				approvalStatus: trainer.approvalStatus,
				createdAt: trainer.createdAt,
				updatedAt: trainer.updatedAt,
				phone: trainer.phone, // Include phone from trainer account
			};
		}
		
		// Ensure approvalStatus is included even if JOIN didn't work
		if (!profile.approvalStatus && trainer.approvalStatus) {
			profile.approvalStatus = trainer.approvalStatus;
		}
		
		// Include phone from trainer account in profile response
		return {
			...profile,
			phone: trainer.phone,
		};
	} catch (error: any) {
		logger.error('Error fetching profile for trainer', {
			error: error?.message || String(error),
			code: error?.code,
			detail: error?.detail,
			stack: error?.stack,
			trainerId,
			service: 'trainer-auth-service',
		});
		
		// If it's already an AppError, re-throw it
		if (error instanceof AppError) {
			throw error;
		}
		
		// Wrap database errors in AppError to preserve the message
		const errorMessage = error?.message || 'Failed to fetch profile';
		throw new AppError(errorMessage, 500);
	}
}

