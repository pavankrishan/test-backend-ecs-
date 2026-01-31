import type { Pool, PoolClient } from 'pg';

import { createPostgresPool } from '@kodingcaravan/shared/databases/postgres/connection';
import { getRedisClient, disconnectRedis } from '@kodingcaravan/shared/databases/redis/connection';
import logger from '@kodingcaravan/shared/config/logger';

// Use ReturnType to get the Redis type from the shared package
type Redis = ReturnType<typeof getRedisClient>;

let pool: Pool | null = null;
let redis: Redis | null = null;

/**
 * Initialize (or return) the shared PostgreSQL pool for the student service.
 */
export async function initPostgres(): Promise<Pool> {
  if (pool) {
    return pool;
  }

  pool = createPostgresPool({
    max: 10,
    connectionTimeoutMillis: 20000, // Increase timeout to 20 seconds
  });
  
  // Set application_name via query after pool creation
  if (pool) {
    pool.on('connect', async (client) => {
      await client.query(`SET application_name = 'student-service'`);
    });
  }
  
  if (!pool) {
    throw new Error('Failed to create PostgreSQL pool');
  }

  // Retry logic with exponential backoff
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
      await pool.query('SELECT NOW()'); // simple connectivity check
      logger.info('PostgreSQL connected for Student Service', { service: 'student-service' });
      return pool;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if it's a connection error that might be transient
      const isConnectionError = lastError.message?.includes('Connection terminated') || 
                                lastError.message?.includes('ECONNRESET') ||
                                lastError.message?.includes('ECONNREFUSED') ||
                                (lastError as any).code === 'ECONNRESET' ||
                                (lastError as any).code === 'ECONNREFUSED';
      
      if (attempt < maxRetries && isConnectionError) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
        logger.warn(`PostgreSQL connection attempt ${attempt}/${maxRetries} failed, retrying`, { 
          service: 'student-service',
          attempt,
          maxRetries,
          delay
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        // Final attempt failed or non-connection error
        await pool.end().catch(() => undefined);
        pool = null;
        logger.error('Failed to initialize PostgreSQL after retries', { 
          service: 'student-service',
          attempts: maxRetries,
          error: lastError.message
        });
        throw lastError;
      }
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError || new Error('Failed to initialize PostgreSQL');
}

/**
 * Lazily obtain the PostgreSQL pool once it has been initialized.
 */
export function getPostgresPool(): Pool {
  if (!pool) {
    throw new Error('PostgreSQL pool not initialized. Call initPostgres() first.');
  }
  return pool;
}

/**
 * Execute a handler inside a PostgreSQL transaction.
 */
export async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
  const pg = await initPostgres();
  let client: PoolClient | null = null;
  let retries = 3;
  
  while (retries > 0) {
    try {
      client = await pg.connect();
      await client.query('BEGIN');
      const result = await handler(client);
      await client.query('COMMIT');
      return result;
    } catch (error: any) {
      // Check if it's a connection error that might be transient
      const isConnectionError = error?.message?.includes('Connection terminated') || 
                                error?.message?.includes('ECONNRESET') ||
                                error?.message?.includes('ECONNREFUSED') ||
                                error?.code === 'ECONNRESET' ||
                                error?.code === 'ECONNREFUSED' ||
                                error?.message?.includes('Client has encountered a connection error');
      
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          // Ignore rollback errors if connection is already dead
        }
        client.release();
        client = null;
      }
      
      // Retry on connection errors
      if (isConnectionError && retries > 1) {
        retries--;
        const delay = Math.min(1000 * Math.pow(2, 3 - retries), 5000);
        logger.warn('Database connection error, retrying', { 
          service: 'student-service',
          retries: 3 - retries,
          maxRetries: 3,
          delay
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      
      // Non-connection error or max retries reached
      throw error;
    } finally {
      if (client) {
        client.release();
      }
    }
  }
  
  throw new Error('Failed to execute transaction after retries');
}

/**
 * Initialize (or return) the shared Redis client.
 */
export function initRedis(): Redis {
  if (!redis) {
    redis = getRedisClient({
      lazyConnect: true,
      enableReadyCheck: false,
    });
    // Redis client ready - no logging needed (lazy connect)
  }
  return redis;
}

export function getRedis(): Redis {
  if (!redis) {
    return initRedis();
  }
  return redis;
}

/**
 * Initialize all data stores used by the service.
 */
export async function initDatabases(): Promise<void> {
  await initPostgres();
  initRedis();
}

/**
 * Gracefully close all active connections.
 */
export async function closeDatabases(): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  if (pool) {
    tasks.push(
      pool.end().catch((error: unknown) => {
        logger.error('Failed to close PostgreSQL pool for Student Service', { 
          service: 'student-service',
          error: error instanceof Error ? error.message : String(error)
        });
      }),
    );
    pool = null;
  }

  if (redis) {
    tasks.push(
      redis.quit().catch((error: unknown) => {
        logger.error('Failed to close Redis client for Student Service', { 
          service: 'student-service',
          error: error instanceof Error ? error.message : String(error)
        });
      }),
    );
    redis = null;
  }

  await Promise.all(tasks);
  await disconnectRedis().catch(() => undefined);
}

