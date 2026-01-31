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
	createStudent,
	deleteEmailOtp,
	findRefreshToken,
	findStudentByEmail,
	findStudentByGoogleId,
	findStudentById,
	findStudentByPhone,
	findStudentByUsername,
	getEmailOtp,
	incrementEmailOtpAttempts,
	linkGoogleAccount,
	getStudentProfile,
	updateStudentIdentity,
	updateStudentPassword,
	revokeAllRefreshTokens,
	revokeRefreshToken,
	storeRefreshToken,
	findRefreshTokenWithLock,
	updateStudentVerification,
	upsertEmailOtp,
	type StudentRecord,
	type StudentProfileRecord,
} from '../models/student.model';
import { withTransaction } from '../config/database';
import { generateNumericOtp, hashString } from '../utils/crypto';
import { sendMsg91Otp, verifyMsg91Otp, retryMsg91Otp } from '../integrations/msg91';
import { sendEmailOtp } from '../integrations/mailer';
import { verifyGoogleIdToken, exchangeCodeForIdToken } from '../integrations/googleAuth';
import {
	createSession,
	updateSessionActivity,
	deleteSession,
	acquireRefreshLock,
	releaseRefreshLock,
	waitForRefreshLock,
} from '@kodingcaravan/shared/utils/sessionManager';

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

// Registration bonus coins - will be fetched from payment service (which reads from database)
// Fallback to env var or default 10 if payment service is unavailable
async function getRegistrationCoins(): Promise<number> {
	try {
		const { httpGet, isSuccessResponse, parseJsonResponse } = await import('@kodingcaravan/shared');
		
		// Resolve payment service URL with Docker detection
		let paymentServiceUrl: string;
		if (process.env.PAYMENT_SERVICE_URL) {
			paymentServiceUrl = process.env.PAYMENT_SERVICE_URL;
		} else {
			const servicesHost = process.env.SERVICES_HOST;
			const port = process.env.PAYMENT_SERVICE_PORT || '3007';
			
			// Check if we're in Docker
			const isDocker = 
				process.env.DOCKER === 'true' || 
				process.env.IN_DOCKER === 'true' ||
				process.env.DOCKER_CONTAINER === 'true';
			
			// Check for /.dockerenv file (Docker indicator) - only on Linux
			let detectedDocker = isDocker;
			if (!detectedDocker && process.platform === 'linux') {
				try {
					const fs = require('fs');
					detectedDocker = fs.existsSync('/.dockerenv');
				} catch {
					// Ignore errors - not critical
				}
			}
			
			// Priority 1: Custom SERVICES_HOST provided
			if (servicesHost && servicesHost !== 'http://localhost' && servicesHost !== 'localhost') {
				const trimmedHost = servicesHost.endsWith('/') ? servicesHost.slice(0, -1) : servicesHost;
				paymentServiceUrl = `${trimmedHost}:${port}`;
			}
			// Priority 2: Docker environment - use service names for inter-container communication
			else if (detectedDocker) {
				paymentServiceUrl = `http://payment-service:${port}`;
			}
			// Priority 3: Local development (not Docker) - use localhost
			else {
				paymentServiceUrl = `http://localhost:${port}`;
			}
		}
		
		const configUrl = `${paymentServiceUrl}/api/v1/payments/coins/configuration`;
		const response = await httpGet(configUrl, { timeout: 5000 });
		
		if (isSuccessResponse(response.statusCode)) {
			const configData = parseJsonResponse<{ data?: Array<{ key: string; value: number }> }>(response.data);
			const registrationConfig = Array.isArray(configData.data) 
				? configData.data.find(c => c.key === 'registration')
				: null;
			
			if (registrationConfig && registrationConfig.value > 0) {
				return registrationConfig.value;
			}
		}
	} catch (error) {
		logger.warn('Failed to get registration coins from payment service', {
			error: error instanceof Error ? error.message : String(error),
			service: 'student-auth-service',
		});
	}
	
	// Fallback to env var or default
	const envValue = process.env.COIN_REWARD_REGISTRATION;
	if (envValue) {
		const parsed = Number(envValue);
		if (Number.isFinite(parsed) && parsed > 0) {
			return Math.floor(parsed);
		}
	}
	
	return 10; // Default fallback
}

type TokenPair = {
	accessToken: string;
	refreshToken: string;
};

type RegisterWithEmailResult = {
	studentId: string;
	status: 'created' | 'otp_resent';
};

function issueTokens(student: StudentRecord): TokenPair {
	const payload = {
		sub: student.id,
		role: 'student',
		phone: student.phone,
		email: student.email,
	};

	const accessToken = signAccessToken(payload);
	const refreshToken = signRefreshToken(payload);

	return { accessToken, refreshToken };
}

function normalizePhone(phone: string): string {
	return phone.replace(/\D/g, '');
}

function normalizeOtpInput(raw: string): string {
	return raw.replace(/\s+/g, '').trim();
}

/**
 * Award registration bonus coins to a new student
 * This is called when a student completes registration for the first time
 */
async function awardRegistrationCoins(studentId: string): Promise<void> {
	const maxRetries = 3;
	const retryDelay = 1000; // 1 second
	
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			// Get registration coins from payment service (reads from database)
			const registrationCoins = await getRegistrationCoins();
			
			const { httpPost, isSuccessResponse, parseJsonResponse } = await import('@kodingcaravan/shared');
			
			// Resolve payment service URL with Docker detection
			let paymentServiceUrl: string;
			if (process.env.PAYMENT_SERVICE_URL) {
				paymentServiceUrl = process.env.PAYMENT_SERVICE_URL;
			} else {
				const servicesHost = process.env.SERVICES_HOST;
				const port = process.env.PAYMENT_SERVICE_PORT || '3007';
				
				// Check if we're in Docker
				const isDocker = 
					process.env.DOCKER === 'true' || 
					process.env.IN_DOCKER === 'true' ||
					process.env.DOCKER_CONTAINER === 'true';
				
				// Check for /.dockerenv file (Docker indicator) - only on Linux
				let detectedDocker = isDocker;
				if (!detectedDocker && process.platform === 'linux') {
					try {
						const fs = require('fs');
						detectedDocker = fs.existsSync('/.dockerenv');
					} catch {
						// Ignore errors - not critical
					}
				}
				
				// Priority 1: Custom SERVICES_HOST provided
				if (servicesHost && servicesHost !== 'http://localhost' && servicesHost !== 'localhost') {
					const trimmedHost = servicesHost.endsWith('/') ? servicesHost.slice(0, -1) : servicesHost;
					paymentServiceUrl = `${trimmedHost}:${port}`;
				}
				// Priority 2: Docker environment - use service names for inter-container communication
				else if (detectedDocker) {
					paymentServiceUrl = `http://payment-service:${port}`;
				}
				// Priority 3: Local development (not Docker) - use localhost
				else {
					paymentServiceUrl = `http://localhost:${port}`;
				}
			}
			
			const awardUrl = `${paymentServiceUrl}/api/v1/payments/coins/adjust`;
			
			const requestBody = {
				studentId,
				amount: registrationCoins,
				type: 'registration_bonus',
				description: 'Welcome bonus for new registration',
				metadata: { source: 'registration' },
			};

			logger.info('Attempting to award registration coins to student', {
				studentId,
				registrationCoins,
				attempt,
				maxRetries,
				paymentServiceUrl,
				service: 'student-auth-service',
			});

			const response = await httpPost(awardUrl, requestBody, { timeout: 10000 });

			if (isSuccessResponse(response.statusCode)) {
				// Try to parse response data to get wallet balance
				let responseData: any = null;
				try {
					responseData = parseJsonResponse(response.data);
				} catch (e) {
					// Response might not be JSON, try direct parse
					try {
						responseData = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
					} catch (e2) {
						logger.warn('Could not parse response data', {
							responseDataType: typeof response.data,
							studentId,
							service: 'student-auth-service',
						});
					}
				}
				
				const walletBalance = responseData?.data?.wallet?.balance ?? responseData?.wallet?.balance ?? 'unknown';
				logger.info('✅ Successfully awarded registration coins to new student', {
					studentId,
					registrationCoins,
					walletBalance,
					attempt,
					service: 'student-auth-service',
				});
				
				// Log full response in dev mode for debugging
				if (process.env.NODE_ENV === 'development') {
					logger.debug('Registration coins award response', {
						responseData,
						studentId,
						service: 'student-auth-service',
					});
				}
				return; // Success - exit retry loop
			} else {
				logger.warn('Failed to award registration coins - non-success status', {
					statusCode: response.statusCode,
					statusMessage: response.statusMessage,
					studentId,
					attempt,
					maxRetries,
					service: 'student-auth-service',
				});
				
				// Don't retry on client errors (4xx) except 408 (timeout) and 429 (rate limit)
				if (response.statusCode >= 400 && response.statusCode < 500 && 
					response.statusCode !== 408 && response.statusCode !== 429) {
					logger.error('❌ Failed to award registration coins - client error, not retrying', {
						statusCode: response.statusCode,
						studentId,
						service: 'student-auth-service',
					});
					return;
				}
				
				// Retry on server errors (5xx) or specific client errors
				if (attempt < maxRetries) {
					logger.info(`Retrying coin award (attempt ${attempt + 1}/${maxRetries})...`, {
						studentId,
						delay: retryDelay,
						service: 'student-auth-service',
					});
					await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
					continue;
				}
			}
		} catch (error: any) {
			const isLastAttempt = attempt === maxRetries;
			const errorCode = error?.code;
			const errorMessage = error?.message || String(error);
			
			// Log error with attempt info
			logger.error(isLastAttempt ? '❌ Failed to award registration coins after all retries' : '⚠️ Error awarding registration coins, will retry', {
				error: errorMessage,
				stack: error?.stack,
				code: errorCode,
				studentId,
				attempt,
				maxRetries,
				service: 'student-auth-service',
			});
			
			// Don't retry on certain errors (e.g., invalid student ID)
			if (errorCode === 'ECONNREFUSED' || errorCode === 'ETIMEDOUT' || errorCode === 'ENOTFOUND') {
				if (attempt < maxRetries) {
					logger.info(`Payment service unavailable, retrying (attempt ${attempt + 1}/${maxRetries})...`, {
						studentId,
						errorCode,
						delay: retryDelay * attempt,
						service: 'student-auth-service',
					});
					await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
					continue;
				} else {
					logger.error('❌ Payment service unavailable after all retries. Check if payment service is running.', {
						studentId,
						paymentServiceUrl: process.env.PAYMENT_SERVICE_URL || 
							`http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.PAYMENT_SERVICE_PORT || 3007}`,
						service: 'student-auth-service',
					});
				}
			}
			
			// If last attempt, log final failure
			if (isLastAttempt) {
				logger.error('❌ CRITICAL: Registration coins were NOT awarded to student', {
					studentId,
					error: errorMessage,
					code: errorCode,
					service: 'student-auth-service',
					action: 'Please manually award coins or check payment service logs',
				});
			}
		}
	}
}

export async function registerWithEmail(input: {
	email: string;
	password: string;
	username?: string | null;
	phone?: string | null;
}): Promise<RegisterWithEmailResult> {
	logger.info('registerWithEmail called', {
		email: input.email,
		hasUsername: !!input.username,
		hasPhone: !!input.phone,
		service: 'student-auth-service',
	});
	const email = input.email.toLowerCase().trim();
	
	// Auto-generate username if not provided
	let username: string = '';
	if (input.username && input.username.trim().length > 0) {
		username = input.username.toLowerCase().trim();
	} else {
		// Generate username from email: user@example.com -> user_12345
		const emailPrefix = email.split('@')[0] || 'student';
		// Clean email prefix to only allow valid username characters
		const cleanPrefix = emailPrefix.replace(/[^a-z0-9]/g, '_').substring(0, 20);
		let attempts = 0;
		let generatedUsername = '';
		
		// Ensure username is unique
		do {
			const randomSuffix = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
			generatedUsername = `${cleanPrefix}_${randomSuffix}`;
			attempts++;
			
			// Check if username exists
			const existing = await findStudentByUsername(generatedUsername);
			if (!existing) {
				username = generatedUsername;
				break;
			}
		} while (attempts < 10); // Max 10 attempts to find unique username
		
		// Fallback if all attempts failed (very unlikely)
		if (!username) {
			const timestamp = Date.now().toString().slice(-6);
			username = `student_${timestamp}`;
		}
	}
	
	const hasPhoneInput = typeof input.phone === 'string' && input.phone.trim().length > 0;
	const phone = hasPhoneInput ? normalizePhone(input.phone!) : null;
	const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

	const existingEmail = await findStudentByEmail(email);

	if (existingEmail) {
		if (existingEmail.isEmailVerified) {
			throw new AppError('Email already registered', 409);
		}

		const [usernameOwner, phoneOwner] = await Promise.all([
			existingEmail.username !== username ? findStudentByUsername(username) : Promise.resolve(null),
			hasPhoneInput && existingEmail.phone !== phone ? findStudentByPhone(phone!) : Promise.resolve(null),
		]);

		if (usernameOwner && usernameOwner.id !== existingEmail.id) {
			throw new AppError('Username already taken', 409);
		}

		if (phoneOwner && phoneOwner.id !== existingEmail.id) {
			throw new AppError('Phone already in use', 409);
		}

		const otpCode = generateNumericOtp();
		const otpHash = hashString(otpCode);
		const expiresAt = addMinutes(new Date(), OTP_EXPIRY_MINUTES);

		await withTransaction(async (client) => {
			const identityUpdates: Parameters<typeof updateStudentIdentity>[1] = {};

			if (existingEmail.username !== username) {
				identityUpdates.username = username;
			}

			if (hasPhoneInput && existingEmail.phone !== phone) {
				identityUpdates.phone = phone;
			}

			if (Object.keys(identityUpdates).length) {
				await updateStudentIdentity(existingEmail.id, identityUpdates, client);
			}

			await updateStudentPassword(existingEmail.id, passwordHash, client);
			// Revoke all refresh tokens when password is changed
			await revokeAllRefreshTokens(existingEmail.id);
			await upsertEmailOtp(existingEmail.id, otpHash, expiresAt, client);
		});

		await sendEmailOtp(email, otpCode);

		return { studentId: existingEmail.id, status: 'otp_resent' };
	}

	const [existingUsername, existingPhone] = await Promise.all([
		findStudentByUsername(username),
		hasPhoneInput && phone ? findStudentByPhone(phone) : Promise.resolve(null),
	]);

	if (existingUsername) {
		throw new AppError('Username already taken', 409);
	}
	if (existingPhone && phone) {
		throw new AppError('Phone already in use', 409);
	}

	const otpCode = generateNumericOtp();
	const otpHash = hashString(otpCode);
	const expiresAt = addMinutes(new Date(), OTP_EXPIRY_MINUTES);

	const student = await withTransaction(async (client) => {
		const created = await createStudent(
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

	await sendEmailOtp(email, otpCode);

	return { studentId: student.id, status: 'created' };
}

export async function resendEmailOtp(email: string): Promise<void> {
	const student = await findStudentByEmail(email.toLowerCase());
	if (!student) {
		throw new AppError('Account not found', 404);
	}
	if (student.isEmailVerified) {
		throw new AppError('Email already verified', 400);
	}

	const otpCode = generateNumericOtp();
	const otpHash = hashString(otpCode);
	const expiresAt = addMinutes(new Date(), OTP_EXPIRY_MINUTES);

	await upsertEmailOtp(student.id, otpHash, expiresAt);
	await sendEmailOtp(student.email!, otpCode);
}

export async function verifyEmailOtpForStudent(email: string, otp: string): Promise<void> {
	const student = await findStudentByEmail(email.toLowerCase());
	if (!student) {
		throw new AppError('Account not found', 404);
	}
	if (!student.email) {
		throw new AppError('Email not linked to account', 400);
	}
	if (student.isEmailVerified) {
		await deleteEmailOtp(student.id);
		return;
	}

	const record = await getEmailOtp(student.id);
	if (!record) {
		throw new AppError('Verification code not found or expired', 400);
	}
	if (record.attemptCount >= EMAIL_OTP_MAX_ATTEMPTS) {
		throw new AppError('Maximum verification attempts exceeded', 429);
	}
	if (isBefore(record.expiresAt, new Date())) {
		await deleteEmailOtp(student.id);
		throw new AppError('Verification code expired', 400);
	}

	const hashed = hashString(otp);
	if (hashed !== record.codeHash) {
		await incrementEmailOtpAttempts(student.id);
		throw new AppError('Invalid verification code', 400);
	}

	const wasEmailVerified = student.isEmailVerified;

	await withTransaction(async (client) => {
		await updateStudentVerification(
			student.id,
			{
				isEmailVerified: true,
			},
			client
		);
		await deleteEmailOtp(student.id, client);
	});

	// Award registration bonus coins if this is the first time email is verified
	if (!wasEmailVerified) {
		await awardRegistrationCoins(student.id);
	}
}

export async function loginWithEmailPassword(
	email: string,
	password: string,
	meta: { ip?: string; userAgent?: string }
): Promise<{ tokens: TokenPair; student: StudentRecord; sessionId: string }> {
	const student = await findStudentByEmail(email.toLowerCase());
	if (!student || !student.passwordHash) {
		// Record failed attempt even if user doesn't exist (prevent user enumeration)
		if (student) {
			recordFailedAttempt(student.id);
			logger.warn('Login failed - invalid credentials', {
				email: email.toLowerCase(),
				studentId: student.id,
				ip: meta.ip,
				service: 'student-auth-service',
			});
		} else {
			logger.warn('Login failed - account not found', {
				email: email.toLowerCase(),
				ip: meta.ip,
				service: 'student-auth-service',
			});
		}
		throw new AppError('Invalid credentials', 401);
	}

	// Check if account is locked
	const lockStatus = isAccountLocked(student.id);
	if (lockStatus.locked) {
		const minutesRemaining = Math.ceil(
			(lockStatus.lockedUntil!.getTime() - Date.now()) / (60 * 1000)
		);
		logger.warn('Login failed - account locked', {
			email: email.toLowerCase(),
			studentId: student.id,
			minutesRemaining,
			ip: meta.ip,
			service: 'student-auth-service',
		});
		throw new AppError(
			`Account locked due to too many failed login attempts. Please try again after ${minutesRemaining} minutes.`,
			423
		);
	}

	const match = await bcrypt.compare(password, student.passwordHash);
	if (!match) {
		recordFailedAttempt(student.id);
		const remaining = getRemainingAttempts(student.id);
		logger.warn('Login failed - password mismatch', {
			email: email.toLowerCase(),
			studentId: student.id,
			remainingAttempts: remaining,
			ip: meta.ip,
			service: 'student-auth-service',
		});
		if (remaining > 0) {
			throw new AppError(`Invalid credentials. ${remaining} attempt(s) remaining.`, 401);
		}
		throw new AppError('Invalid credentials', 401);
	}

	if (!student.isEmailVerified) {
		throw new AppError('Email not verified', 403);
	}

	// Clear failed attempts on successful login
	clearFailedAttempts(student.id);

	logger.info('Login successful', {
		email: email.toLowerCase(),
		studentId: student.id,
		ip: meta.ip,
		service: 'student-auth-service',
	});

	const tokens = issueTokens(student);
	await persistRefreshToken(student.id, tokens.refreshToken, meta);
	await updateStudentVerification(student.id, { lastLoginAt: new Date() });

	// Create Redis session
	const sessionId = await createSession(student.id, 'student', meta);

	return { tokens, student, sessionId };
}

export async function requestPasswordReset(emailInput: string): Promise<void> {
	const email = emailInput.toLowerCase().trim();
	const student = await findStudentByEmail(email);

	// Do not reveal whether account exists to the client
	if (!student || !student.passwordHash) {
		return;
	}

	if (!student.isEmailVerified) {
		throw new AppError('Please verify your email before resetting your password', 400);
	}

	const otpCode = generateNumericOtp();
	const otpHash = hashString(otpCode);
	const expiresAt = addMinutes(new Date(), OTP_EXPIRY_MINUTES);

	await upsertEmailOtp(student.id, otpHash, expiresAt);
	await sendEmailOtp(email, otpCode);
}

export async function resetPasswordWithOtp(input: {
	email: string;
	otp: string;
	newPassword: string;
}): Promise<void> {
	const email = input.email.toLowerCase().trim();
	const student = await findStudentByEmail(email);

	if (!student || !student.passwordHash) {
		throw new AppError('Invalid reset request', 400);
	}

	const record = await getEmailOtp(student.id);
	if (!record) {
		throw new AppError('Reset code not found or expired', 400);
	}
	if (record.attemptCount >= EMAIL_OTP_MAX_ATTEMPTS) {
		throw new AppError('Maximum verification attempts exceeded', 429);
	}
	if (isBefore(record.expiresAt, new Date())) {
		await deleteEmailOtp(student.id);
		throw new AppError('Reset code expired', 400);
	}

	const hashed = hashString(input.otp.trim());
	if (hashed !== record.codeHash) {
		await incrementEmailOtpAttempts(student.id);
		throw new AppError('Invalid reset code', 400);
	}

	const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);

	await withTransaction(async (client) => {
		await updateStudentPassword(student.id, passwordHash, client);
		await deleteEmailOtp(student.id, client);
		await revokeAllRefreshTokens(student.id, client);
	});
}

export async function changePassword(
	studentId: string,
	currentPassword: string,
	newPassword: string
): Promise<void> {
	const student = await findStudentById(studentId);
	if (!student || !student.passwordHash) {
		throw new AppError('Password-based login is not enabled for this account', 400);
	}

	const match = await bcrypt.compare(currentPassword, student.passwordHash);
	if (!match) {
		throw new AppError('Current password is incorrect', 400);
	}

	const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

	await withTransaction(async (client) => {
		await updateStudentPassword(student.id, passwordHash, client);
		await revokeAllRefreshTokens(student.id, client);
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
			service: 'student-auth-service',
		});
		// In dev mode, we can't return a dev OTP since MSG91 generates it
		return {};
	}

	logger.info('Code dispatched via Msg91', {
		phone: phone.substring(0, 4) + '****',
		provider: result.provider,
		requestId: result.requestId ?? 'n/a',
		service: 'student-auth-service',
	});

	return {};
}

export async function verifyPhoneOtp(
	phoneInput: string,
	otp: string,
	meta: { ip?: string; userAgent?: string }
): Promise<{ tokens: TokenPair; student: StudentRecord; sessionId: string }> {
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

	let student = await findStudentByPhone(phone);
	const isNewStudent = !student;
	if (!student) {
		student = await createStudent({ phone });
	}

	await withTransaction(async (client) => {
		await updateStudentVerification(
			student!.id,
			{ isPhoneVerified: true, lastLoginAt: new Date() },
			client
		);
	});

	student = {
		...student,
		isPhoneVerified: true,
		lastLoginAt: new Date(),
	};

	// Award registration bonus coins for new student registration
	if (isNewStudent) {
		await awardRegistrationCoins(student.id);
	}

	const tokens = issueTokens(student);
	await persistRefreshToken(student.id, tokens.refreshToken, meta);

	// Create Redis session
	const sessionId = await createSession(student.id, 'student', meta);

	return { tokens, student, sessionId };
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
): Promise<{ tokens: TokenPair; student: StudentRecord; sessionId: string }> {
	// Validate input
	if (!userInfo.email || !userInfo.email.includes('@')) {
		throw new AppError('Valid email is required', 400);
	}

	const email = userInfo.email.toLowerCase().trim();
	
	// Find or create user by EMAIL (primary identity)
	// Do NOT rely on Google UID - email is the source of truth
	let student = await findStudentByEmail(email);
	const isNewStudent = !student;

	if (!student) {
		// Create new student with email as primary identifier
		student = await createStudent({
			email,
			username: email.split('@')[0] || null,
			// Do NOT set googleId - we don't trust it from mobile
			// auth_provider will be set via update
		});
	}

	// Update auth_provider to mark as native (temporary)
	// This allows tracking migration later
	await updateStudentIdentity(student.id, {
		authProvider: 'google_native',
	});

	const updated = await updateStudentVerification(student.id, {
		isEmailVerified: true,
		lastLoginAt: new Date(),
	});

	if (updated) {
		student = updated;
	}

	// Award registration bonus coins for new student registration
	if (isNewStudent) {
		await awardRegistrationCoins(student.id);
	}

	const tokens = issueTokens(student);
	await persistRefreshToken(student.id, tokens.refreshToken, meta);

	// Create Redis session
	const sessionId = await createSession(student.id, 'student', meta);

	return { tokens, student: { ...student, isEmailVerified: true }, sessionId };
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
): Promise<{ tokens: TokenPair; student: StudentRecord; sessionId: string }> {
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
	let student = await findStudentByEmail(email);
	const isNewStudent = !student;

	if (!student) {
		// Create new student
		student = await createStudent({
			email,
			username: email.split('@')[0] || null,
			googleId: payload.sub, // Store Google UID for reference only
		});
	} else if (!student.googleId) {
		// Link Google account to existing email-based account
		const linked = await linkGoogleAccount(student.id, payload.sub);
		if (linked) {
			student = linked;
		}
	}

	// Update auth_provider to mark as web (final)
	await updateStudentIdentity(student.id, {
		authProvider: 'google_web',
	});

	const updated = await updateStudentVerification(student.id, {
		isEmailVerified: true,
		lastLoginAt: new Date(),
	});

	if (updated) {
		student = updated;
	}

	// Award registration bonus coins for new student registration
	if (isNewStudent) {
		await awardRegistrationCoins(student.id);
	}

	const tokens = issueTokens(student);
	await persistRefreshToken(student.id, tokens.refreshToken, meta);

	// Create Redis session
	const sessionId = await createSession(student.id, 'student', meta);

	return { tokens, student: { ...student, isEmailVerified: true }, sessionId };
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
): Promise<{ tokens: TokenPair; student: StudentRecord; sessionId: string }> {
	const payload = await verifyGoogleIdToken(idToken);
	if (!payload || !payload.email || !payload.sub) {
		throw new AppError('Unable to verify Google account', 401);
	}

	const email = payload.email.toLowerCase();
	let student =
		(await findStudentByGoogleId(payload.sub)) || (await findStudentByEmail(email));

	const isNewStudent = !student;
	if (!student) {
		student = await createStudent({
			email,
			username: email.split('@')[0] || null,
			googleId: payload.sub,
		});
	} else if (!student.googleId) {
		const linked = await linkGoogleAccount(student.id, payload.sub);
		if (linked) {
			student = linked;
		}
	}

	const updated = await updateStudentVerification(student.id, {
		isEmailVerified: true,
		lastLoginAt: new Date(),
	});

	if (updated) {
		student = updated;
	}

	// Award registration bonus coins for new student registration
	if (isNewStudent) {
		await awardRegistrationCoins(student.id);
	}

	const tokens = issueTokens(student);
	await persistRefreshToken(student.id, tokens.refreshToken, meta);

	// Create Redis session
	const sessionId = await createSession(student.id, 'student', meta);

	return { tokens, student: { ...student, isEmailVerified: true }, sessionId };
}

export async function persistRefreshToken(
	studentId: string,
	refreshToken: string,
	meta: { ip?: string; userAgent?: string }
): Promise<void> {
	const payload = verifyRefreshToken<{ exp: number }>(refreshToken);
	const expiresAt = new Date(payload.exp * 1000);
	const tokenHash = hashString(refreshToken);
	await storeRefreshToken(studentId, tokenHash, expiresAt, meta);
}

export async function refreshSession(
	refreshToken: string,
	meta: { ip?: string; userAgent?: string; sessionId?: string }
): Promise<{ tokens: TokenPair; student: StudentRecord; sessionId: string }> {
	let payload: any;
	try {
		payload = verifyRefreshToken(refreshToken);
	} catch (error) {
		logger.warn('Refresh token verification failed', {
			error: error instanceof Error ? error.message : String(error),
			ip: meta.ip,
			service: 'student-auth-service',
		});
		throw new AppError('Invalid refresh token', 401);
	}

	const studentId = payload.sub as string;
	
	// Get or create session ID
	let sessionId = meta.sessionId;
	if (!sessionId) {
		// Try to find existing session for this user
		// For now, create a new session if none exists
		sessionId = await createSession(studentId, 'student', meta);
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
				// First verify student exists
				const student = await findStudentById(studentId, client);
				if (!student) {
					// Return 401 instead of 404 since this is an authentication issue
					throw new AppError('Account not found', 401);
				}

				const tokenHash = hashString(refreshToken);
				
				// Lock the token row to prevent concurrent refresh attempts
				const stored = await findRefreshTokenWithLock(tokenHash, client);
				if (!stored || stored.revokedAt) {
					throw new AppError('Refresh token revoked', 401);
				}
				if (isBefore(stored.expiresAt, new Date())) {
					throw new AppError('Refresh token expired', 401);
				}

				// CRITICAL FIX: Issue new tokens FIRST, then revoke old token
				// This prevents race conditions where concurrent refreshes see the token as revoked
				// before the new token is stored
				const tokens = issueTokens(student);
				
				// Persist new refresh token FIRST using the transaction client
				const tokenPayload = verifyRefreshToken<{ exp: number }>(tokens.refreshToken);
				const expiresAt = new Date(tokenPayload.exp * 1000);
				const newTokenHash = hashString(tokens.refreshToken);
				await storeRefreshToken(
					student.id, 
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

				return { tokens, student };
			});

		// Update session activity (sliding TTL)
		await updateSessionActivity(sessionId);

		return { ...result, sessionId };
	} finally {
		// Always release the lock (non-blocking if Redis unavailable)
		try {
			await releaseRefreshLock(sessionId);
		} catch (error: any) {
			// Non-blocking: If Redis fails during lock release, log but don't throw
			if (process.env.NODE_ENV === 'development') {
				logger.warn('Failed to release refresh lock', {
					error: error?.message || String(error),
					sessionId,
					service: 'student-auth-service',
				});
			}
		}
	}
}

export async function logout(refreshToken: string, sessionId?: string): Promise<void> {
	const tokenHash = hashString(refreshToken);
	await revokeRefreshToken(tokenHash);
	
	// Delete Redis session if sessionId provided
	if (sessionId) {
		await deleteSession(sessionId);
	}
}

export async function logoutAllSessions(studentId: string): Promise<void> {
	await revokeAllRefreshTokens(studentId);
	
	// Delete all Redis sessions for this user
	const { deleteAllUserSessions } = await import('@kodingcaravan/shared/utils/sessionManager');
	await deleteAllUserSessions(studentId);
}

/**
 * Profile ownership: student-service is the single source of truth for student_profiles.
 * Auth does NOT write to student_profiles. This endpoint proxies to student-service
 * so existing API (PUT /api/v1/students/auth/profile) remains valid without dual writes.
 */
export async function updateProfile(
	studentId: string,
	profile: {
		fullName?: string;
		age?: number;
		gender?: string;
		address?: string;
		extra?: Record<string, unknown>;
	},
	authHeader?: string
): Promise<void> {
	const student = await findStudentById(studentId);
	if (!student) {
		throw new AppError('Account not found', 404);
	}

	const baseUrl = resolveStudentServiceUrl();
	const url = `${baseUrl}/api/students/${studentId}/profile`;
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (authHeader) {
		headers['Authorization'] = authHeader;
	}

	const { httpPut, isSuccessResponse, parseJsonResponse } = await import('@kodingcaravan/shared');
	const response = await httpPut(url, profile, { headers, timeout: 15000 });

	if (!isSuccessResponse(response.statusCode)) {
		let message = 'Profile update failed';
		if (response.data) {
			try {
				const body = parseJsonResponse<{ message?: string }>(response.data);
				if (body?.message) message = body.message;
			} catch {
				// ignore
			}
		}
		throw new AppError(message, response.statusCode);
	}
}

function resolveStudentServiceUrl(): string {
	if (process.env.STUDENT_SERVICE_URL) {
		return process.env.STUDENT_SERVICE_URL.replace(/\/$/, '');
	}
	const port = process.env.STUDENT_SERVICE_PORT || process.env.STUDENT_SERVICE_SERVICE_PORT || '3003';
	let isDocker =
		process.env.DOCKER === 'true' ||
		process.env.IN_DOCKER === 'true' ||
		process.env.DOCKER_CONTAINER === 'true';
	if (process.platform === 'linux' && !isDocker) {
		try {
			const fs = require('fs');
			if (fs.existsSync('/.dockerenv')) isDocker = true;
		} catch {
			// ignore
		}
	}
	const servicesHost = process.env.SERVICES_HOST;
	if (servicesHost && servicesHost !== 'http://localhost' && servicesHost !== 'localhost') {
		const trimmed = servicesHost.replace(/\/$/, '');
		return `${trimmed}:${port}`;
	}
	if (isDocker) {
		return `http://student-service:${port}`;
	}
	return `http://localhost:${port}`;
}

export async function getProfile(studentId: string): Promise<StudentProfileRecord | null> {
	const student = await findStudentById(studentId);
	if (!student) {
		throw new AppError('Account not found', 404);
	}
	return getStudentProfile(studentId);
}

