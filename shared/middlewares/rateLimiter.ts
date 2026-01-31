/**
 * Rate Limiting Middleware
 * Prevents brute force attacks and API abuse
 * Uses Redis for distributed rate limiting across multiple ECS instances
 */

import { Request, Response, NextFunction } from 'express';
import { rateLimitConfig, type RateLimitSettings } from '../config/rateLimitConfig';
import { getRedisClient } from '../databases/redis/connection';
import logger from '../config/logger';
import { redisIncrWithTimeout, redisExpireWithTimeout, redisTtlWithTimeout } from '../utils/redisWithTimeout';

// Redis client for rate limiting (lazy initialization)
let redisClient: ReturnType<typeof getRedisClient> | null = null;

function getRedis(): ReturnType<typeof getRedisClient> {
	if (!redisClient) {
		try {
			redisClient = getRedisClient();
		} catch (error) {
			logger.error('Failed to initialize Redis for rate limiting', { error });
			throw new Error('Rate limiting requires Redis connection');
		}
	}
	return redisClient;
}

interface RateLimitOptions {
	windowMs?: number; // Time window in milliseconds
	max?: number; // Maximum requests per window
	message?: string;
	skipSuccessfulRequests?: boolean;
	skipFailedRequests?: boolean;
	keyGenerator?: (req: Request) => string;
}

const DEFAULT_OPTIONS: Required<Omit<RateLimitOptions, 'keyGenerator'>> & {
	keyGenerator: (req: Request) => string;
} = {
	windowMs: rateLimitConfig.apiWindowMs,
	max: rateLimitConfig.apiMaxAttempts,
	message: 'Too many requests, please try again later',
	skipSuccessfulRequests: false,
	skipFailedRequests: false,
	keyGenerator: (req: Request) => {
		// Use IP address and user ID if available
		const ip = req.ip || req.socket.remoteAddress || 'unknown';
		const userId = (req as any).user?.sub || '';
		return `${ip}:${userId}`;
	},
};

/**
 * Create rate limiter middleware
 * Uses Redis INCR with EXPIRE for atomic, distributed rate limiting
 */
export function rateLimiter(options: RateLimitOptions = {}) {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const { windowMs, max, message, keyGenerator } = opts;

	return async (req: Request, res: Response, next: NextFunction) => {
		try {
			const key = keyGenerator(req);
			const redisKey = `ratelimit:${key}`;

			// Use Redis INCR for atomic counter increment (with timeout - fails open)
			const count = await redisIncrWithTimeout(redisKey, 500);
			
			// If count is 0, Redis failed - allow request (fail open)
			if (count === 0) {
				next();
				return;
			}

			// Set expiration on first request (count === 1)
			if (count === 1) {
				await redisExpireWithTimeout(redisKey, Math.ceil(windowMs / 1000), 500);
			}

			// Get TTL to calculate retry-after (with timeout - fails open)
			const ttl = await redisTtlWithTimeout(redisKey, 500);

			if (count > max) {
				// Rate limit exceeded
				const retryAfter = ttl > 0 ? ttl : Math.ceil(windowMs / 1000);
				res.setHeader('Retry-After', retryAfter.toString());
				res.setHeader('X-RateLimit-Limit', max.toString());
				res.setHeader('X-RateLimit-Remaining', '0');
				res.setHeader('X-RateLimit-Reset', (Date.now() + retryAfter * 1000).toString());
				
				return res.status(429).json({
					success: false,
					message,
					retryAfter,
				});
			}

			// Set rate limit headers
			res.setHeader('X-RateLimit-Limit', max.toString());
			res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count).toString());
			res.setHeader('X-RateLimit-Reset', (Date.now() + (ttl > 0 ? ttl * 1000 : windowMs)).toString());

			next();
		} catch (error) {
			// If Redis fails, log error but allow request (fail open for availability)
			logger.error('Rate limiting Redis error', {
				error: error instanceof Error ? error.message : String(error),
				url: req.url,
				method: req.method,
			});
			// Fail open - allow request if rate limiting fails
			next();
		}
	};
}

/**
 * Auth-specific rate limiter (stricter limits)
 * Disabled in development mode, enabled in production
 */
export const authRateLimiter = process.env.NODE_ENV === 'production'
	? rateLimiter({
			windowMs: rateLimitConfig.authWindowMs,
			max: rateLimitConfig.authMaxAttempts,
			message: `Too many authentication attempts. Please try again after ${Math.ceil(rateLimitConfig.authWindowMs / 60000)} minutes.`,
			keyGenerator: (req: Request) => {
				// Use email/phone from request body for auth endpoints
				const body = req.body || {};
				const identifier = body.email || body.phone || body.username || 'unknown';
				const ip = req.ip || req.socket.remoteAddress || 'unknown';
				return `auth:${ip}:${identifier}`;
			},
		})
	: (req: Request, res: Response, next: NextFunction) => {
			// Skip rate limiting in development
			next();
		};

/**
 * OTP-specific rate limiter
 * Disabled in development mode
 */
export const otpRateLimiter = process.env.NODE_ENV === 'production'
	? rateLimiter({
			windowMs: rateLimitConfig.otpWindowMs,
			max: rateLimitConfig.otpMaxAttempts,
			message: `Please wait ${Math.ceil(rateLimitConfig.otpWindowMs / 1000)} seconds before requesting a new OTP code.`,
			keyGenerator: (req: Request) => {
				const body = req.body || {};
				const identifier = body.email || body.phone || 'unknown';
				return `otp:${identifier}`;
			},
		})
	: (req: Request, res: Response, next: NextFunction) => {
			// Skip rate limiting in development
			next();
		};

/**
 * General API rate limiter (fallback for unauthenticated requests)
 * Disabled in development mode
 */
export const apiRateLimiter = process.env.NODE_ENV === 'production'
	? rateLimiter({
			windowMs: rateLimitConfig.apiWindowMs,
			max: rateLimitConfig.apiMaxAttempts,
			message: 'Too many requests. Please slow down.',
		})
	: (req: Request, res: Response, next: NextFunction) => {
			// Skip rate limiting in development
			next();
		};

/**
 * PHASE 5: Role-based rate limiters
 * Disabled in development mode
 */
export const studentRateLimiter = process.env.NODE_ENV === 'production'
	? rateLimiter({
			windowMs: rateLimitConfig.studentWindowMs,
			max: rateLimitConfig.studentMaxAttempts,
			message: 'Too many requests. Please slow down.',
			keyGenerator: (req: Request) => {
				const userId = (req as any).userId || (req as any).user?.sub || 'anonymous';
				const ip = req.ip || req.socket.remoteAddress || 'unknown';
				return `student:${userId}:${ip}`;
			},
		})
	: (req: Request, res: Response, next: NextFunction) => {
			// Skip rate limiting in development
			next();
		};

export const trainerRateLimiter = process.env.NODE_ENV === 'production'
	? rateLimiter({
			windowMs: rateLimitConfig.trainerWindowMs,
			max: rateLimitConfig.trainerMaxAttempts,
			message: 'Too many requests. Please slow down.',
			keyGenerator: (req: Request) => {
				const userId = (req as any).userId || (req as any).user?.sub || 'anonymous';
				const ip = req.ip || req.socket.remoteAddress || 'unknown';
				return `trainer:${userId}:${ip}`;
			},
		})
	: (req: Request, res: Response, next: NextFunction) => {
			// Skip rate limiting in development
			next();
		};

export const adminRateLimiter = process.env.NODE_ENV === 'production'
	? rateLimiter({
			windowMs: rateLimitConfig.adminWindowMs,
			max: rateLimitConfig.adminMaxAttempts,
			message: 'Too many requests. Please slow down.',
			keyGenerator: (req: Request) => {
				const userId = (req as any).userId || (req as any).user?.sub || 'anonymous';
				const ip = req.ip || req.socket.remoteAddress || 'unknown';
				return `admin:${userId}:${ip}`;
			},
		})
	: (req: Request, res: Response, next: NextFunction) => {
			// Skip rate limiting in development
			next();
		};

/**
 * PHASE 5: Role-based rate limiting middleware
 * Applies appropriate rate limit based on user role
 * Disabled in development mode
 */
export function roleBasedRateLimiter(req: Request, res: Response, next: NextFunction): void {
	// Skip rate limiting in development mode
	if (process.env.NODE_ENV !== 'production') {
		next();
		return;
	}
	
	const role = (req as any).userRole || (req as any).user?.role;
	
	if (role === 'student') {
		studentRateLimiter(req, res, next);
	} else if (role === 'trainer') {
		trainerRateLimiter(req, res, next);
	} else if (role === 'admin') {
		adminRateLimiter(req, res, next);
	} else {
		// Fallback to general API rate limiter for unauthenticated requests
		apiRateLimiter(req, res, next);
	}
}