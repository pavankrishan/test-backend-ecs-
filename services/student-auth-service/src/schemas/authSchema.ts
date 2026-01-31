import { z } from 'zod';

export const registerSchema = z.object({
	email: z.string().email(),
	password: z
		.string()
		.min(8, 'Password must be at least 8 characters')
		.regex(/[A-Z]/, 'Password must contain an uppercase letter')
		.regex(/[a-z]/, 'Password must contain a lowercase letter')
		.regex(/\d/, 'Password must contain a number'),
	username: z
		.string()
		.min(3)
		.max(30)
		.regex(/^[a-zA-Z0-9_.-]+$/, 'Username can only contain letters, numbers, and _.-')
		.optional()
		.transform((val: string | undefined) => (val ? val.trim() : undefined)),
	phone: z
		.string()
		.optional()
		.transform((val: string | undefined) => (val ? val.trim() : undefined)),
});

export const resendEmailOtpSchema = z.object({
	email: z.string().email(),
});

export const verifyEmailSchema = z.object({
	email: z.string().trim().email(),
	otp: z
		.string()
		.trim()
		.regex(/^\d{4,6}$/, 'OTP must be 4-6 digits'),
});

export const loginSchema = z.object({
	email: z.string().email(),
	password: z.string().min(8),
});

export const phoneOtpRequestSchema = z.object({
	phone: z.string().trim().min(6).max(15),
});

export const phoneOtpVerifySchema = z.object({
	phone: z.string().trim().min(6).max(15),
	otp: z
		.string()
		.trim()
		.regex(/^\d{4,6}$/, 'OTP must be 4-6 digits'),
});

export const phoneOtpRetrySchema = z.object({
	phone: z.string().trim().min(6).max(15),
	retryType: z.enum(['text', 'voice']).optional().default('text'),
});

export const refreshSchema = z.object({
	refreshToken: z.string().min(10).optional(), // Optional for web clients (uses cookies), required for mobile
});

export const logoutSchema = z.object({
	refreshToken: z.string().min(10),
});

export const profileSchema = z.object({
	fullName: z.string().min(2),
	age: z.coerce.number().int().min(13).max(100),
	gender: z.enum(['male', 'female', 'other']),
	address: z.string().min(5),
	extra: z.record(z.any()).optional(),
});

export const googleAuthSchema = z.object({
	idToken: z.string().min(20),
});

// Native Google auth schema (temporary - accepts user info from mobile)
export const googleNativeAuthSchema = z.object({
	email: z.string().email(),
	name: z.string().optional(),
	provider: z.literal('google'),
});

// Web OAuth Google auth schema (final - accepts OAuth code)
export const googleWebAuthSchema = z.object({
	code: z.string().min(10),
	redirectUri: z.string().url(),
	codeVerifier: z.string().optional(),
});

export const forgotPasswordSchema = z.object({
	email: z.string().email(),
});

export const resetPasswordWithOtpSchema = z.object({
	email: z.string().email(),
	otp: z
		.string()
		.trim()
		.regex(/^\d{4,6}$/, 'OTP must be 4-6 digits'),
	newPassword: z
		.string()
		.min(8, 'Password must be at least 8 characters')
		.regex(/[A-Z]/, 'Password must contain an uppercase letter')
		.regex(/[a-z]/, 'Password must contain a lowercase letter')
		.regex(/\d/, 'Password must contain a number'),
});

export const changePasswordSchema = z.object({
	currentPassword: z.string().min(8),
	newPassword: z
		.string()
		.min(8, 'Password must be at least 8 characters')
		.regex(/[A-Z]/, 'Password must contain an uppercase letter')
		.regex(/[a-z]/, 'Password must contain a lowercase letter')
		.regex(/\d/, 'Password must contain a number'),
});

