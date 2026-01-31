/**
 * Production-Grade Caching Layer for Doubt Service
 * 
 * Purpose: Reduce MongoDB load for read-heavy endpoints in high-traffic scenarios (600k+ users)
 * - Uses Redis for distributed caching across service instances
 * - Short TTL (30-60s) to balance freshness vs load reduction
 * - Gracefully degrades if Redis unavailable (no caching, direct DB)
 * 
 * Strategy:
 * - Cache key pattern: `doubt:${operation}:${params}`
 * - TTL: 30s for list queries, 60s for single document queries
 * - Invalidation: Manual on write operations (create/update/delete)
 */

import { getRedisClient } from '@kodingcaravan/shared/databases/redis/connection';
import logger from '@kodingcaravan/shared/config/logger';
import { redisGetWithTimeout, redisSetexWithTimeout, redisDelWithTimeout } from '@kodingcaravan/shared/utils/redisWithTimeout';

const CACHE_PREFIX = 'doubt:';
export const DEFAULT_LIST_TTL = 30; // 30 seconds for list queries
export const DEFAULT_DOCUMENT_TTL = 60; // 60 seconds for single document queries

/**
 * Get cached value from Redis (non-blocking - returns null if cache miss or Redis unavailable)
 */
export async function getCache<T>(key: string): Promise<T | null> {
	try {
		const cached = await redisGetWithTimeout(`${CACHE_PREFIX}${key}`, 1000);
		if (cached) {
			return JSON.parse(cached) as T;
		}
		return null;
	} catch (error: any) {
		// Cache miss or Redis unavailable - return null (graceful degradation)
		// Don't log unless in development (avoid noise in production)
		if (process.env.NODE_ENV === 'development') {
			logger.debug('Cache miss/unavailable', {
				key,
				error: error?.message || String(error),
				service: 'chat-service',
			});
		}
		return null;
	}
}

/**
 * Set cache value in Redis (non-blocking - silently fails if Redis unavailable)
 */
export async function setCache<T>(key: string, value: T, ttlSeconds: number = DEFAULT_LIST_TTL): Promise<void> {
	try {
		await redisSetexWithTimeout(`${CACHE_PREFIX}${key}`, ttlSeconds, JSON.stringify(value), 2000);
	} catch (error: any) {
		// Redis unavailable - silently fail (graceful degradation, no caching)
		// Don't log unless in development (avoid noise in production)
		if (process.env.NODE_ENV === 'development') {
			logger.debug('Cache failed to set key', {
				key,
				error: error?.message || String(error),
				service: 'chat-service',
			});
		}
	}
}

/**
 * Invalidate cache entries matching pattern (non-blocking)
 * Used when data is modified (create/update/delete operations)
 */
export async function invalidateCache(pattern: string): Promise<void> {
	try {
		const redis = getRedisClient();
		// Note: redis.keys() doesn't have timeout wrapper, but it's non-critical
		// If Redis is slow, cache invalidation can be delayed
		const keys = await redis.keys(`${CACHE_PREFIX}${pattern}*`);
		if (keys.length > 0) {
			await redisDelWithTimeout(keys, 2000);
		}
	} catch (error: any) {
		// Redis unavailable - silently fail (cache will expire naturally)
		if (process.env.NODE_ENV === 'development') {
			logger.debug('Cache failed to invalidate pattern', {
				pattern,
				error: error?.message || String(error),
				service: 'chat-service',
			});
		}
	}
}

/**
 * Build cache key for listDoubts query
 */
export function buildListCacheKey(filters: {
	studentId?: string;
	trainerId?: string;
	status?: string;
	subject?: string;
	page?: number;
	limit?: number;
}): string {
	const parts = ['list'];
	if (filters.studentId) parts.push(`student:${filters.studentId}`);
	if (filters.trainerId) parts.push(`trainer:${filters.trainerId}`);
	if (filters.status) parts.push(`status:${filters.status}`);
	if (filters.subject) parts.push(`subject:${filters.subject}`);
	parts.push(`page:${filters.page ?? 1}`);
	parts.push(`limit:${filters.limit ?? 20}`);
	return parts.join(':');
}

/**
 * Build cache key for getDoubtById query
 */
export function buildDoubtCacheKey(doubtId: string): string {
	return `doubt:${doubtId}`;
}

/**
 * Build cache key for getDoubtReplies query
 */
export function buildRepliesCacheKey(doubtId: string): string {
	return `replies:${doubtId}`;
}
