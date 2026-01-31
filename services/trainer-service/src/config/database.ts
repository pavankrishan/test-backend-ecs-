import type { Pool, PoolClient } from 'pg';
import { createPostgresPool } from '@kodingcaravan/shared/databases/postgres/connection';
import logger from '@kodingcaravan/shared/config/logger';

let pool: Pool | null = null;

export async function initPostgres(): Promise<Pool> {
  if (pool) {
    return pool;
  }

  pool = createPostgresPool({
    max: 10,
    connectionTimeoutMillis: 15000, // Increase timeout to 15 seconds
  });
  
  // Set application_name via query after pool creation
  if (pool) {
    pool.on('connect', async (client) => {
      await client.query(`SET application_name = 'trainer-service'`);
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
      await pool.query('SELECT NOW()');
      logger.info('PostgreSQL connected', { service: 'trainer-service' });
      return pool;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
        logger.warn('PostgreSQL connection attempt failed, retrying', { 
          service: 'trainer-service',
          attempt,
          maxRetries,
          delay
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        // Final attempt failed
        if (pool) {
          await pool.end().catch(() => undefined);
        }
        pool = null;
        logger.error('PostgreSQL connection failed after retries', { 
          service: 'trainer-service',
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

export function getPostgresPool(): Pool {
  if (!pool) {
    throw new Error('PostgreSQL pool not initialized. Call initPostgres() first.');
  }
  return pool;
}

export async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
  const pg = await initPostgres();
  const client = await pg.connect();

  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closeConnections(): Promise<void> {
  if (pool) {
    await pool.end().catch((error: unknown) => {
      logger.error('Failed to close Trainer Service PostgreSQL pool', { 
        service: 'trainer-service',
        error: error instanceof Error ? error.message : String(error)
      });
    });
    pool = null;
  }
}

