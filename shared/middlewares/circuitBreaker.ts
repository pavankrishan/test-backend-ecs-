/**
 * PHASE 5: Circuit Breaker Middleware
 * 
 * Prevents cascade failures by opening circuit when downstream services fail.
 * Uses opossum library for circuit breaker pattern.
 * 
 * Usage:
 * ```typescript
 * import { createCircuitBreaker } from '@kodingcaravan/shared/middlewares/circuitBreaker';
 * 
 * const breaker = createCircuitBreaker('admin-service');
 * const result = await breaker.fire(() => callAdminService());
 * ```
 */

import CircuitBreaker from 'opossum';
import logger from '../config/logger';

export interface CircuitBreakerOptions {
  timeout?: number; // Request timeout in ms
  errorThresholdPercentage?: number; // Open circuit after this % of errors
  resetTimeout?: number; // Try again after this many ms
  rollingCountTimeout?: number; // Time window for error counting
  rollingCountBuckets?: number; // Number of buckets in time window
  name?: string; // Service name for logging
}

const DEFAULT_OPTIONS: Required<Omit<CircuitBreakerOptions, 'name'>> & { name?: string } = {
  timeout: 10000, // 10 seconds
  errorThresholdPercentage: 50, // Open after 50% errors
  resetTimeout: 60000, // Try again after 60 seconds
  rollingCountTimeout: 60000, // 1 minute window
  rollingCountBuckets: 10, // 10 buckets (6 seconds each)
};

/**
 * PHASE 5: Create a circuit breaker for a service
 */
export function createCircuitBreaker<T>(
  serviceName: string,
  fn: () => Promise<T>,
  options: CircuitBreakerOptions = {}
): CircuitBreaker<[], T> {
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
    name: serviceName,
  };

  const breaker = new CircuitBreaker<[], T>(fn, {
    timeout: opts.timeout,
    errorThresholdPercentage: opts.errorThresholdPercentage,
    resetTimeout: opts.resetTimeout,
    rollingCountTimeout: opts.rollingCountTimeout,
    rollingCountBuckets: opts.rollingCountBuckets,
  });

  // Event handlers
  breaker.on('open', () => {
    logger.warn('[CircuitBreaker] Circuit opened', {
      service: serviceName,
      state: 'open',
    });
  });

  breaker.on('halfOpen', () => {
    logger.info('[CircuitBreaker] Circuit half-open', {
      service: serviceName,
      state: 'halfOpen',
    });
  });

  breaker.on('close', () => {
    logger.info('[CircuitBreaker] Circuit closed', {
      service: serviceName,
      state: 'closed',
    });
  });

  breaker.on('failure', (error: Error) => {
    logger.error('[CircuitBreaker] Request failed', {
      service: serviceName,
      error: error.message,
    });
  });

  breaker.on('success', () => {
    logger.debug('[CircuitBreaker] Request succeeded', {
      service: serviceName,
    });
  });

  return breaker;
}

/**
 * PHASE 5: Circuit breaker for HTTP requests
 */
export function createHttpCircuitBreaker(serviceName: string, options: CircuitBreakerOptions = {}) {
  const breaker = new CircuitBreaker<[string, any], any>(
    async (url: string, requestOptions: any) => {
      const axios = (await import('axios')).default;
      const response = await axios(url, {
        ...requestOptions,
        timeout: options.timeout || DEFAULT_OPTIONS.timeout,
      });
      return response.data;
    },
    {
      timeout: options.timeout || DEFAULT_OPTIONS.timeout,
      errorThresholdPercentage: options.errorThresholdPercentage || DEFAULT_OPTIONS.errorThresholdPercentage,
      resetTimeout: options.resetTimeout || DEFAULT_OPTIONS.resetTimeout,
      rollingCountTimeout: options.rollingCountTimeout || DEFAULT_OPTIONS.rollingCountTimeout,
      rollingCountBuckets: options.rollingCountBuckets || DEFAULT_OPTIONS.rollingCountBuckets,
    }
  );

  // Event handlers
  breaker.on('open', () => {
    logger.warn('[CircuitBreaker] Circuit opened', {
      service: serviceName,
      state: 'open',
    });
  });

  breaker.on('halfOpen', () => {
    logger.info('[CircuitBreaker] Circuit half-open', {
      service: serviceName,
      state: 'halfOpen',
    });
  });

  breaker.on('close', () => {
    logger.info('[CircuitBreaker] Circuit closed', {
      service: serviceName,
      state: 'closed',
    });
  });

  breaker.on('failure', (error: Error) => {
    logger.error('[CircuitBreaker] Request failed', {
      service: serviceName,
      error: error.message,
    });
  });

  breaker.on('success', () => {
    logger.debug('[CircuitBreaker] Request succeeded', {
      service: serviceName,
    });
  });

  return breaker;
}

/**
 * PHASE 5: Get circuit breaker status
 */
export function getCircuitBreakerStatus(breaker: CircuitBreaker<any, any>): {
  state: 'open' | 'halfOpen' | 'closed';
  failures: number;
  fires: number;
  cacheHits: number;
  cacheMisses: number;
} {
  const stats = breaker.stats;
  
  // Determine state from boolean properties (opossum provides opened, closed, halfOpen)
  const breakerAny = breaker as any;
  let state: 'open' | 'halfOpen' | 'closed' = 'closed';
  if (breakerAny.opened === true) {
    state = 'open';
  } else if (breakerAny.halfOpen === true) {
    state = 'halfOpen';
  } else {
    state = 'closed';
  }
  
  return {
    state,
    failures: stats?.failures || 0,
    fires: stats?.fires || 0,
    cacheHits: stats?.cacheHits || 0,
    cacheMisses: stats?.cacheMisses || 0,
  };
}
