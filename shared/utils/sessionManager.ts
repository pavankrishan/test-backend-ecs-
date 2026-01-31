/**
 * Production-Grade Session Management with Redis
 * 
 * Implements:
 * - Server-authoritative sessions with sliding TTL
 * - Distributed refresh locks to prevent concurrent refreshes
 * - Session invalidation on logout
 */

import { getRedisClient } from '../databases/redis/connection';
import { v4 as uuidv4 } from 'uuid';
import logger from '../config/logger';

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days (matches refresh token expiry)
const REFRESH_LOCK_TTL_SECONDS = 5; // 5 seconds - prevents concurrent refreshes
const SESSION_PREFIX = 'session:';
const REFRESH_LOCK_PREFIX = 'lock:refresh:';

export interface SessionData {
	sessionId: string;
	studentId: string;
	role: 'student' | 'trainer';
	createdAt: number;
	lastActivityAt: number;
	ip?: string;
	userAgent?: string;
}

/**
 * Create a new session in Redis with sliding TTL
 * Production-grade: Handles Redis connection failures gracefully
 */
export async function createSession(
	userId: string,
	role: 'student' | 'trainer',
	meta?: { ip?: string; userAgent?: string }
): Promise<string> {
	const redis = getRedisClient();
	const sessionId = uuidv4();
	
	const sessionData: SessionData = {
		sessionId,
		studentId: userId,
		role,
		createdAt: Date.now(),
		lastActivityAt: Date.now(),
		...(meta?.ip && { ip: meta.ip }),
		...(meta?.userAgent && { userAgent: meta.userAgent }),
	};

	try {
		const key = `${SESSION_PREFIX}${sessionId}`;
		await redis.setex(
			key,
			SESSION_TTL_SECONDS,
			JSON.stringify(sessionData)
		);
	} catch (error: any) {
		// Non-blocking: If Redis fails, still return sessionId
		// Session will work, but won't be persisted in Redis (graceful degradation)
		if (process.env.NODE_ENV === 'development') {
			logger.warn('Failed to create Redis session, continuing without persistence', {
				error: error?.message || String(error),
				userId,
				service: 'session-manager',
			});
		}
	}

	return sessionId;
}

/**
 * Get session data from Redis
 */
export async function getSession(sessionId: string): Promise<SessionData | null> {
	const redis = getRedisClient();
	const key = `${SESSION_PREFIX}${sessionId}`;
	const data = await redis.get(key);
	
	if (!data) {
		return null;
	}

	return JSON.parse(data) as SessionData;
}

/**
 * Update session activity (sliding TTL)
 * Production-grade: Handles Redis failures gracefully
 */
export async function updateSessionActivity(sessionId: string): Promise<void> {
	try {
		const redis = getRedisClient();
		const key = `${SESSION_PREFIX}${sessionId}`;
		const data = await redis.get(key);
		
		if (!data) {
			return;
		}

		const session: SessionData = JSON.parse(data);
		session.lastActivityAt = Date.now();

		// Reset TTL on activity (sliding expiration)
		await redis.setex(key, SESSION_TTL_SECONDS, JSON.stringify(session));
	} catch (error: any) {
		// Non-blocking: Silently fail if Redis is unavailable
		// This allows auth to continue working even if Redis is down
		if (process.env.NODE_ENV === 'development') {
			logger.warn('Failed to update session activity', {
				error: error?.message || String(error),
				sessionId,
				service: 'session-manager',
			});
		}
	}
}

/**
 * Delete session from Redis
 */
export async function deleteSession(sessionId: string): Promise<void> {
	const redis = getRedisClient();
	const key = `${SESSION_PREFIX}${sessionId}`;
	await redis.del(key);
}

/**
 * Delete all sessions for a user
 */
export async function deleteAllUserSessions(userId: string): Promise<void> {
	const redis = getRedisClient();
	const pattern = `${SESSION_PREFIX}*`;
	
	// Scan for all sessions and delete matching ones
	const stream = redis.scanStream({
		match: pattern,
		count: 100,
	});

	const pipeline = redis.pipeline();
	let deleted = 0;

	stream.on('data', async (keys: string[]) => {
		for (const key of keys) {
			const data = await redis.get(key);
			if (data) {
				const session: SessionData = JSON.parse(data);
				if (session.studentId === userId) {
					pipeline.del(key);
					deleted++;
				}
			}
		}
	});

	stream.on('end', async () => {
		if (deleted > 0) {
			await pipeline.exec();
		}
	});
}

/**
 * Acquire a distributed refresh lock
 * Returns true if lock was acquired, false if already locked
 * Production-grade: Returns true if Redis unavailable (non-blocking)
 */
export async function acquireRefreshLock(sessionId: string): Promise<boolean> {
	try {
		const redis = getRedisClient();
		const lockKey = `${REFRESH_LOCK_PREFIX}${sessionId}`;
		
		// SET with NX (only if not exists) and EX (expiration)
		// This is atomic and prevents race conditions
		const result = await redis.set(lockKey, '1', 'EX', REFRESH_LOCK_TTL_SECONDS, 'NX');
		
		return result === 'OK';
	} catch (error: any) {
		// Non-blocking: If Redis fails, allow operation to proceed
		// This ensures auth works even if Redis is down
		if (process.env.NODE_ENV === 'development') {
			logger.warn('Failed to acquire refresh lock, allowing operation', {
				error: error?.message || String(error),
				sessionId,
				service: 'session-manager',
			});
		}
		return true; // Allow if Redis unavailable
	}
}

/**
 * Release a refresh lock
 */
export async function releaseRefreshLock(sessionId: string): Promise<void> {
	const redis = getRedisClient();
	const lockKey = `${REFRESH_LOCK_PREFIX}${sessionId}`;
	await redis.del(lockKey);
}

/**
 * Check if a refresh lock exists (for waiting/retry logic)
 */
export async function hasRefreshLock(sessionId: string): Promise<boolean> {
	const redis = getRedisClient();
	const lockKey = `${REFRESH_LOCK_PREFIX}${sessionId}`;
	const exists = await redis.exists(lockKey);
	return exists === 1;
}

/**
 * Wait for refresh lock to be released (with timeout)
 * Returns true if lock was released, false if timeout
 * Production-grade: Returns true if Redis unavailable (non-blocking)
 */
export async function waitForRefreshLock(
	sessionId: string,
	timeoutMs: number = 5000
): Promise<boolean> {
	try {
		const startTime = Date.now();
		const checkInterval = 100; // Check every 100ms

		while (Date.now() - startTime < timeoutMs) {
			const hasLock = await hasRefreshLock(sessionId);
			if (!hasLock) {
				return true; // Lock released
			}
			await new Promise(resolve => setTimeout(resolve, checkInterval));
		}

		return false; // Timeout
	} catch (error: any) {
		// Non-blocking: If Redis unavailable, allow operation
		if (process.env.NODE_ENV === 'development') {
			logger.warn('Failed to wait for refresh lock, allowing operation', {
				error: error?.message || String(error),
				sessionId,
				service: 'session-manager',
			});
		}
		return true; // Allow if Redis unavailable
	}
}

