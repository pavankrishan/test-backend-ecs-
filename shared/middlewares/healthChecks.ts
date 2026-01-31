/**
 * Health Check Middleware
 * Provides /health (liveness) and /ready (readiness) endpoints
 * /ready checks database and Redis connectivity
 */

import { Request, Response } from 'express';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import logger from '../config/logger';

interface HealthCheckOptions {
	serviceName: string;
	postgresPool?: Pool;
	redisClient?: Redis;
	mongoConnection?: any; // mongoose connection
}

/**
 * Check PostgreSQL connection health
 */
async function checkPostgres(pool?: Pool): Promise<'ok' | 'error'> {
	if (!pool) {
		return 'ok'; // Service doesn't use PostgreSQL
	}

	try {
		const result = await pool.query('SELECT 1 as health');
		if (result.rows && result.rows.length > 0) {
			return 'ok';
		}
		return 'error';
	} catch (error) {
		logger.warn('PostgreSQL health check failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		return 'error';
	}
}

/**
 * Check Redis connection health
 */
async function checkRedis(redis?: Redis): Promise<'ok' | 'error'> {
	if (!redis) {
		return 'ok'; // Service doesn't use Redis
	}

	try {
		await redis.ping();
		return 'ok';
	} catch (error) {
		logger.warn('Redis health check failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		return 'error';
	}
}

/**
 * Check MongoDB connection health
 */
async function checkMongo(mongoConnection?: any): Promise<'ok' | 'error'> {
	if (!mongoConnection) {
		return 'ok'; // Service doesn't use MongoDB
	}

	try {
		// Check if mongoose connection is ready
		if (mongoConnection.readyState === 1) {
			// Try a simple operation
			await mongoConnection.db.admin().ping();
			return 'ok';
		}
		return 'error';
	} catch (error) {
		logger.warn('MongoDB health check failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		return 'error';
	}
}

/**
 * Create health check endpoints
 * /health - liveness probe (always returns 200 if service is running)
 * /ready - readiness probe (returns 503 if dependencies are unhealthy)
 */
export function createHealthCheckEndpoints(options: HealthCheckOptions) {
	const { serviceName, postgresPool, redisClient, mongoConnection } = options;

	/**
	 * Liveness probe - service is alive if it responds
	 */
	const healthHandler = (_req: Request, res: Response) => {
		res.status(200).json({
			status: 'ok',
			service: serviceName,
			timestamp: new Date().toISOString(),
		});
	};

	/**
	 * Readiness probe - service is ready if all dependencies are healthy
	 */
	const readyHandler = async (_req: Request, res: Response) => {
		const checks = {
			postgres: await checkPostgres(postgresPool),
			redis: await checkRedis(redisClient),
			mongo: await checkMongo(mongoConnection),
		};

		const allHealthy = Object.values(checks).every((status) => status === 'ok');

		if (allHealthy) {
			res.status(200).json({
				ready: true,
				service: serviceName,
				checks,
				timestamp: new Date().toISOString(),
			});
		} else {
			res.status(503).json({
				ready: false,
				service: serviceName,
				checks,
				timestamp: new Date().toISOString(),
			});
		}
	};

	return {
		healthHandler,
		readyHandler,
	};
}
