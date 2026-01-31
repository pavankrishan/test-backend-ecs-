/**
 * Retry Queue Configuration
 * Centralized configuration with environment variable support
 */

export interface RetryConfig {
	maxRetries: number;
	initialDelayMs: number;
	maxDelayMs: number;
	backoffMultiplier: number;
	maxConcurrentJobs: number;
	maxDeadLetterSize: number;
	maxJobAgeMs: number;
	processIntervalMs: number;
	cleanupIntervalMs: number;
}

export const retryConfig: RetryConfig = {
	maxRetries: Number(process.env.RETRY_MAX_RETRIES) || 3,
	initialDelayMs: Number(process.env.RETRY_INITIAL_DELAY_MS) || 1000,
	maxDelayMs: Number(process.env.RETRY_MAX_DELAY_MS) || 30000,
	backoffMultiplier: Number(process.env.RETRY_BACKOFF_MULTIPLIER) || 2,
	maxConcurrentJobs: Number(process.env.RETRY_MAX_CONCURRENT_JOBS) || 5,
	maxDeadLetterSize: Number(process.env.RETRY_MAX_DEAD_LETTER_SIZE) || 1000,
	maxJobAgeMs: Number(process.env.RETRY_MAX_JOB_AGE_MS) || 24 * 60 * 60 * 1000, // 24 hours
	processIntervalMs: Number(process.env.RETRY_PROCESS_INTERVAL_MS) || 5000,
	cleanupIntervalMs: Number(process.env.RETRY_CLEANUP_INTERVAL_MS) || 60 * 60 * 1000, // 1 hour
};

