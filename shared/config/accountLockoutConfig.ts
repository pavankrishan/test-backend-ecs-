/**
 * Account Lockout Configuration
 * Centralized configuration with environment variable support
 */

export interface AccountLockoutConfig {
	maxAttempts: number;
	lockoutDurationMs: number;
	cleanupIntervalMs: number;
	maxAttemptAgeMs: number;
}

export const accountLockoutConfig: AccountLockoutConfig = {
	maxAttempts: Number(process.env.ACCOUNT_LOCKOUT_MAX_ATTEMPTS) || 5,
	lockoutDurationMs: Number(process.env.ACCOUNT_LOCKOUT_DURATION_MS) || 30 * 60 * 1000, // 30 minutes
	cleanupIntervalMs: Number(process.env.ACCOUNT_LOCKOUT_CLEANUP_INTERVAL_MS) || 60 * 60 * 1000, // 1 hour
	maxAttemptAgeMs: Number(process.env.ACCOUNT_LOCKOUT_MAX_ATTEMPT_AGE_MS) || 2 * 60 * 60 * 1000, // 2 hours
};

