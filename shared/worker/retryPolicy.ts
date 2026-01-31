/**
 * Retry Policy
 * 
 * Configurable retry logic with exponential backoff.
 * Enforces max retry limits to prevent infinite loops.
 */

import logger from '../config/logger';

export interface RetryPolicyConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryPolicyConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  multiplier: 2,
};

/**
 * Calculate retry delay using exponential backoff
 */
export function calculateRetryDelay(attempt: number, config: RetryPolicyConfig): number {
  const delay = config.initialDelayMs * Math.pow(config.multiplier, attempt);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Execute operation with retry logic
 * 
 * Retries on failure up to maxAttempts times.
 * Uses exponential backoff between retries.
 * Throws error if all retries exhausted.
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  config: RetryPolicyConfig = DEFAULT_RETRY_CONFIG,
  context: { correlationId?: string; eventId?: string; operation?: string } = {}
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      const result = await operation();
      
      if (attempt > 0) {
        logger.info('[RetryPolicy] Operation succeeded after retry', {
          attempt: attempt + 1,
          maxAttempts: config.maxAttempts,
          ...context,
        });
      }

      return result;
    } catch (error: any) {
      lastError = error;

      if (attempt < config.maxAttempts - 1) {
        const delay = calculateRetryDelay(attempt, config);
        logger.warn('[RetryPolicy] Operation failed, retrying', {
          attempt: attempt + 1,
          maxAttempts: config.maxAttempts,
          delayMs: delay,
          error: error.message,
          ...context,
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        logger.error('[RetryPolicy] Operation failed after all retries', {
          attempts: config.maxAttempts,
          error: error.message,
          stack: error.stack,
          ...context,
        });
      }
    }
  }

  // All retries exhausted
  throw lastError || new Error('Operation failed after retries');
}

