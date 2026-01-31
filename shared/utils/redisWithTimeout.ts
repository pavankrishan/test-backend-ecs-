/**
 * Redis Operations with Timeout Wrapper
 * 
 * Prevents Redis operations from hanging indefinitely.
 * All operations fail open (return null/false) to avoid breaking request flow.
 */

import { getRedisClient } from '../databases/redis/connection';
import logger from '../config/logger';

const redis = getRedisClient();

/**
 * Redis GET with timeout (fails open for cache)
 */
export async function redisGetWithTimeout(
	key: string,
	timeoutMs: number = 1000
): Promise<string | null> {
	try {
		return await Promise.race([
			redis.get(key),
			new Promise<null>((_, reject) =>
				setTimeout(() => reject(new Error('Redis timeout')), timeoutMs)
			),
		]);
	} catch (error) {
		logger.warn('Redis get timeout or error (failing open)', {
			key,
			timeoutMs,
			error: error instanceof Error ? error.message : String(error),
		});
		return null; // Fail open for cache
	}
}

/**
 * Redis SETEX with timeout (fails silently for cache writes)
 */
export async function redisSetexWithTimeout(
	key: string,
	seconds: number,
	value: string,
	timeoutMs: number = 2000
): Promise<boolean> {
	try {
		await Promise.race([
			redis.setex(key, seconds, value),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('Redis timeout')), timeoutMs)
			),
		]);
		return true;
	} catch (error) {
		logger.warn('Redis setex timeout or error (failing silently)', {
			key,
			timeoutMs,
			error: error instanceof Error ? error.message : String(error),
		});
		return false; // Fail silently for cache writes
	}
}

/**
 * Redis DEL with timeout (fails silently for cache invalidation)
 */
export async function redisDelWithTimeout(
	key: string | string[],
	timeoutMs: number = 1000
): Promise<number> {
	try {
		const delPromise = Array.isArray(key) 
			? redis.del(...key)
			: redis.del(key);
		
		return await Promise.race([
			delPromise,
			new Promise<number>((_, reject) =>
				setTimeout(() => reject(new Error('Redis timeout')), timeoutMs)
			),
		]);
	} catch (error) {
		logger.warn('Redis del timeout or error (failing silently)', {
			key: Array.isArray(key) ? key.join(',') : key,
			timeoutMs,
			error: error instanceof Error ? error.message : String(error),
		});
		return 0; // Fail silently - assume deletion succeeded
	}
}

/**
 * Redis EXISTS with timeout (fails open - returns false)
 */
export async function redisExistsWithTimeout(
	key: string,
	timeoutMs: number = 500
): Promise<boolean> {
	try {
		const result = await Promise.race([
			redis.exists(key),
			new Promise<number>((_, reject) =>
				setTimeout(() => reject(new Error('Redis timeout')), timeoutMs)
			),
		]);
		return result === 1;
	} catch (error) {
		logger.warn('Redis exists timeout or error (failing open)', {
			key,
			timeoutMs,
			error: error instanceof Error ? error.message : String(error),
		});
		return false; // Fail open - assume key doesn't exist
	}
}

/**
 * Redis INCR with timeout (fails open for rate limiting - allows request)
 */
export async function redisIncrWithTimeout(
	key: string,
	timeoutMs: number = 500
): Promise<number> {
	try {
		return await Promise.race([
			redis.incr(key),
			new Promise<number>((_, reject) =>
				setTimeout(() => reject(new Error('Redis timeout')), timeoutMs)
			),
		]);
	} catch (error) {
		logger.warn('Redis incr timeout or error (failing open)', {
			key,
			timeoutMs,
			error: error instanceof Error ? error.message : String(error),
		});
		return 0; // Fail open - allow request if rate limiting fails
	}
}

/**
 * Redis EXPIRE with timeout (fails silently)
 */
export async function redisExpireWithTimeout(
	key: string,
	seconds: number,
	timeoutMs: number = 500
): Promise<boolean> {
	try {
		const result = await Promise.race([
			redis.expire(key, seconds),
			new Promise<number>((_, reject) =>
				setTimeout(() => reject(new Error('Redis timeout')), timeoutMs)
			),
		]);
		return result === 1;
	} catch (error) {
		logger.warn('Redis expire timeout or error (failing silently)', {
			key,
			timeoutMs,
			error: error instanceof Error ? error.message : String(error),
		});
		return false; // Fail silently
	}
}

/**
 * Redis TTL with timeout (fails open - returns -1)
 */
export async function redisTtlWithTimeout(
	key: string,
	timeoutMs: number = 500
): Promise<number> {
	try {
		return await Promise.race([
			redis.ttl(key),
			new Promise<number>((_, reject) =>
				setTimeout(() => reject(new Error('Redis timeout')), timeoutMs)
			),
		]);
	} catch (error) {
		logger.warn('Redis ttl timeout or error (failing open)', {
			key,
			timeoutMs,
			error: error instanceof Error ? error.message : String(error),
		});
		return -1; // Fail open - return -1 (key doesn't exist or no expiry)
	}
}

/**
 * Redis SETNX with timeout (atomic set if not exists)
 * Returns true if key was set, false if key already exists
 * Used for atomic check-and-set operations to prevent race conditions
 * 
 * Note: Sets key with TTL in a single atomic operation
 * 
 * FAIL-CLOSED STRATEGY: For journey start, Redis failures must throw error
 * to prevent duplicate journeys when Redis is unavailable.
 */
export async function redisSetnxWithTimeout(
	key: string,
	value: string,
	ttlSeconds: number = 3600,
	timeoutMs: number = 2000
): Promise<boolean> {
	try {
		const result = await Promise.race([
			redis.set(key, value, 'EX', ttlSeconds, 'NX'), // SET key value EX ttlSeconds NX
			new Promise<string | null>((_, reject) =>
				setTimeout(() => reject(new Error('Redis timeout')), timeoutMs)
			),
		]);
		// Redis SET with NX returns 'OK' if set, null if key exists
		return result === 'OK';
	} catch (error) {
		logger.error('Redis setnx timeout or error (failing closed)', {
			key,
			timeoutMs,
			error: error instanceof Error ? error.message : String(error),
		});
		// Fail closed - throw error to prevent duplicate journeys when Redis is unavailable
		// This ensures we don't allow journey start if Redis is down (prevents state inconsistency)
		throw new Error('Redis unavailable - cannot start journey');
	}
}
