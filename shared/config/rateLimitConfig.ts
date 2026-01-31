/**
 * Rate Limiting Configuration
 * Centralized configuration with environment variable support
 */

export interface RateLimitSettings {
	authWindowMs: number;
	authMaxAttempts: number;
	otpWindowMs: number;
	otpMaxAttempts: number;
	apiWindowMs: number;
	apiMaxAttempts: number;
	// PHASE 5: Role-based rate limits
	studentWindowMs: number;
	studentMaxAttempts: number;
	trainerWindowMs: number;
	trainerMaxAttempts: number;
	adminWindowMs: number;
	adminMaxAttempts: number;
	cleanupIntervalMs: number;
}

export const rateLimitConfig: RateLimitSettings = {
	authWindowMs: Number(process.env.RATE_LIMIT_AUTH_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
	authMaxAttempts: Number(process.env.RATE_LIMIT_AUTH_MAX_ATTEMPTS) || 5,
	otpWindowMs: Number(process.env.RATE_LIMIT_OTP_WINDOW_MS) || 60 * 1000, // 1 minute
	otpMaxAttempts: Number(process.env.RATE_LIMIT_OTP_MAX_ATTEMPTS) || 1,
	apiWindowMs: Number(process.env.RATE_LIMIT_API_WINDOW_MS) || 60 * 1000, // 1 minute
	apiMaxAttempts: Number(process.env.RATE_LIMIT_API_MAX_ATTEMPTS) || 60,
	// PHASE 5: Role-based rate limits
	studentWindowMs: Number(process.env.RATE_LIMIT_STUDENT_WINDOW_MS) || 60 * 1000, // 1 minute
	studentMaxAttempts: Number(process.env.RATE_LIMIT_STUDENT_MAX_ATTEMPTS) || 100, // 100 requests/min
	trainerWindowMs: Number(process.env.RATE_LIMIT_TRAINER_WINDOW_MS) || 60 * 1000, // 1 minute
	trainerMaxAttempts: Number(process.env.RATE_LIMIT_TRAINER_MAX_ATTEMPTS) || 200, // 200 requests/min
	adminWindowMs: Number(process.env.RATE_LIMIT_ADMIN_WINDOW_MS) || 60 * 1000, // 1 minute
	adminMaxAttempts: Number(process.env.RATE_LIMIT_ADMIN_MAX_ATTEMPTS) || 500, // 500 requests/min
	cleanupIntervalMs: Number(process.env.RATE_LIMIT_CLEANUP_INTERVAL_MS) || 5 * 60 * 1000, // 5 minutes
};

