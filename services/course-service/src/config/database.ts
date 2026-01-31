/**
 * Database Configuration for Course Service
 * Uses PostgreSQL for course metadata and MongoDB for course content
 * 
 * CRITICAL: Uses mongoose singleton from config/mongoose.ts
 * This ensures all models use the same mongoose instance that gets connected
 */

import mongoose from './mongoose';
import { createPostgresPool } from '@kodingcaravan/shared/databases/postgres/connection';
import { getRedisClient } from '@kodingcaravan/shared/databases/redis/connection';
import logger from '@kodingcaravan/shared/config/logger';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import type { ConnectOptions } from 'mongoose';

let postgresPool: Pool | null = null;
let mongoConnection: typeof import('mongoose') | null = null;
let redisClient: Redis | null = null;

// Singleton MongoDB initialization promise
// Ensures only ONE initialization happens, even with concurrent calls
let mongoInitPromise: Promise<typeof import('mongoose')> | null = null;

/**
 * Initialize PostgreSQL connection
 */
export async function initPostgres(): Promise<Pool> {
  if (postgresPool) {
    return postgresPool;
  }

  postgresPool = createPostgresPool({
    max: 10,
    connectionTimeoutMillis: 20000, // Increase timeout to 20 seconds
  });
  
  // Set application_name via query after pool creation
  if (postgresPool) {
    postgresPool.on('connect', async (client) => {
      await client.query(`SET application_name = 'course-service'`);
    });
  }
  
  if (!postgresPool) {
    throw new Error('Failed to create PostgreSQL pool');
  }
  
  // Retry logic with exponential backoff
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await postgresPool.query('SELECT NOW()');
      logger.info('PostgreSQL connected', { service: 'course-service' });
      return postgresPool;
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
        logger.warn('PostgreSQL connection attempt failed, retrying', { 
          service: 'course-service',
          attempt,
          maxRetries,
          delay
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        // Final attempt failed or non-connection error
        if (postgresPool) {
          await postgresPool.end().catch(() => undefined);
        }
        postgresPool = null;
        logger.error('PostgreSQL connection failed after retries', { 
          service: 'course-service',
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
 * Initialize MongoDB connection (SINGLETON)
 * Uses mongoose.connect() directly on the singleton instance
 * No retries - throws immediately on failure
 */
export async function initMongo(): Promise<typeof import('mongoose')> {
  // If connection exists and is healthy, return immediately
  if (mongoConnection && mongoose.connection.readyState === 1 && mongoose.connection.db) {
    try {
      await mongoose.connection.db.admin().ping();
      return mongoose;
    } catch {
      // Ping failed, connection stale - clear and reconnect
      mongoConnection = null;
    }
  }

  // If initialization is already in progress, await the existing promise
  if (mongoInitPromise) {
    return mongoInitPromise;
  }

  // Create singleton initialization promise
  mongoInitPromise = (async () => {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      throw new Error('MONGO_URI environment variable is required');
    }

    const dbName = process.env.MONGO_DB_NAME;

    // Connection options - optimized for production
    const options: ConnectOptions = {
      appName: 'course-service',
      maxPoolSize: 50,
      minPoolSize: 5,
      waitQueueTimeoutMS: 5000,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
      connectTimeoutMS: 10000,
      maxIdleTimeMS: 30000,
      retryWrites: true,
      w: 'majority',
      ...(dbName ? { dbName } : {}),
    };

    try {
      // Connect using mongoose singleton - this is the same instance all models use
      // mongoose.connect() resolves when connection is established
      // Timeout is handled by connectTimeoutMS and serverSelectionTimeoutMS options
      await mongoose.connect(uri, options);

      // Verify connection is ready - mongoose.connect() should have established it
      if (mongoose.connection.readyState !== 1) {
        throw new Error(
          `MongoDB connection not ready. State: ${mongoose.connection.readyState} (1=connected)`
        );
      }

      if (!mongoose.connection.db) {
        throw new Error('MongoDB connection.db is undefined');
      }

      // Verify with ping to ensure connection is truly ready
      await mongoose.connection.db.admin().ping();

      mongoConnection = mongoose;
      mongoInitPromise = null;

      return mongoose;
    } catch (error) {
      mongoInitPromise = null;
      mongoConnection = null;
      throw error;
    }
  })();

  return mongoInitPromise;
}

/**
 * Initialize Redis connection
 */
export function initRedis(): Redis {
  if (redisClient) {
    return redisClient;
  }

  redisClient = getRedisClient();
  logger.info('Redis connected', { service: 'course-service' });
  return redisClient;
}

/**
 * Get PostgreSQL pool
 */
export function getPostgresPool(): Pool {
  if (!postgresPool) {
    throw new Error('PostgreSQL not initialized. Call initPostgres() first.');
  }
  return postgresPool;
}

/**
 * Get MongoDB connection, ensuring it's ready
 * CRITICAL: With bufferCommands=false, connection MUST be ready before returning
 * Verifies: readyState === 1 AND db exists
 * Throws immediately if connection is not ready
 */
export async function getMongoConnection(): Promise<typeof import('mongoose')> {
  // Fast path: connection exists and is healthy
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    try {
      await mongoose.connection.db.admin().ping();
      return mongoose;
    } catch {
      // Ping failed, connection stale - will reconnect below
      mongoConnection = null;
    }
  }

  // Initialize connection (singleton - concurrent callers await same promise)
  const connection = await initMongo();

  // Final verification - connection must be ready for model operations
  if (connection.connection.readyState !== 1 || !connection.connection.db) {
    throw new Error(
      `MongoDB connection not ready. State: ${connection.connection.readyState}, hasDb: ${!!connection.connection.db}`
    );
  }

  return connection;
}

/**
 * Get Redis client
 */
export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = initRedis();
  }
  return redisClient;
}

/**
 * Initialize all databases
 */
export async function initDatabases(): Promise<void> {
  await Promise.all([
    initPostgres(),
    initMongo(),
  ]);
  initRedis();
}

/**
 * Get MongoDB connection state (for health checks)
 * Does NOT trigger initialization
 */
export function getMongoState(): { readyState: number; connected: boolean } {
  if (!mongoConnection || !mongoConnection.connection) {
    return { readyState: 0, connected: false };
  }
  return {
    readyState: mongoConnection.connection.readyState,
    connected: mongoConnection.connection.readyState === 1 && !!mongoConnection.connection.db,
  };
}

/**
 * Close all database connections
 */
export async function closeDatabases(): Promise<void> {
  const promises: Promise<any>[] = [];

  // Clear init promise
  mongoInitPromise = null;

  if (postgresPool) {
    promises.push(postgresPool.end());
    postgresPool = null;
  }

  if (mongoose.connection.readyState !== 0) {
    promises.push(mongoose.disconnect());
    mongoConnection = null;
  }

  if (redisClient) {
    promises.push(redisClient.quit());
    redisClient = null;
  }

  await Promise.all(promises);
  logger.info('All database connections closed', { service: 'course-service' });
}

