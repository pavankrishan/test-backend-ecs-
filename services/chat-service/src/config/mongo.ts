import mongoose, { ConnectOptions } from 'mongoose';
import { connectMongo, disconnectMongo } from '@kodingcaravan/shared/databases/mongo/connection';
import logger from '@kodingcaravan/shared/config/logger';

// CRITICAL: Disable Mongoose buffering IMMEDIATELY when module loads
// This must be done BEFORE any models are defined or queries are executed
// Otherwise Mongoose will buffer operations and timeout
mongoose.set('bufferCommands', false);

let connection: typeof mongoose | null = null;

export async function initMongo(overrides: Partial<ConnectOptions> = {}): Promise<typeof mongoose> {
  // If connection exists and is healthy, return it
  if (connection && connection.connection.readyState === 1) {
    logger.debug('Using existing MongoDB connection', {
      readyState: 1,
      service: 'chat-service',
    });
    return connection;
  }

  // If connection is stale or disconnected, clear it and reconnect
  if (connection && connection.connection.readyState !== 1) {
    logger.warn('Existing MongoDB connection is not ready, reconnecting', {
      readyState: connection.connection.readyState,
      service: 'chat-service',
    });
    connection = null;
  }

  // Check if MONGO_URI is set
  if (!process.env.MONGO_URI) {
    const error = new Error('MONGO_URI environment variable is not set. Please set MONGO_URI in your .env file.');
    logger.error('MONGO_URI environment variable is not set', {
      service: 'chat-service',
    });
    throw error;
  }

  // CRITICAL: Disable Mongoose buffering BEFORE connecting
  // This prevents "buffering timed out" errors - operations will fail immediately if connection isn't ready
  // Note: bufferCommands is already set in shared connection module, but set it here again to be safe
  mongoose.set('bufferCommands', false);
  logger.debug('Disabled Mongoose buffering to prevent timeout errors', {
    service: 'chat-service',
  });

  logger.info('Initializing connection to MongoDB', {
    service: 'chat-service',
  });
  
  try {
    // Production-grade pool settings optimized for read-heavy Doubt service (600k+ users)
    // Lower pool size prevents connection contention, waitQueueTimeoutMS ensures fail-fast
    connection = await connectMongo({
      appName: 'chat-service',
      maxPoolSize: 50, // 50: Optimized for read-heavy workload (reduced from 100 to prevent contention)
      minPoolSize: 5, // 5: Lower minimum reduces idle overhead (reduced from 10)
      waitQueueTimeoutMS: 5000, // 5s: Critical - fail fast if pool exhausted (prevents request buildup)
      serverSelectionTimeoutMS: 10000, // 10s: Faster failure detection (reduced from 30s for fail-fast)
      socketTimeoutMS: 20000, // 20s: Prevent hanging connections (reduced from 45s)
      connectTimeoutMS: 10000, // 10s: Fast connection attempts (reduced from 20s)
      maxIdleTimeMS: 30000, // 30s: Close idle connections faster (reduced from 60s)
      ...overrides,
    });

    // Verify connection is actually ready
    const readyState = connection.connection.readyState;
    if (readyState !== 1) {
      throw new Error(`MongoDB connection initialized but not ready. State: ${readyState} (1=connected, 2=connecting, 3=disconnecting, 0=disconnected)`);
    }

    // CRITICAL: Perform actual health check by running a ping query
    // readyState=1 doesn't guarantee MongoDB is actually responding
    try {
      if (!connection.connection.db) {
        throw new Error('MongoDB database object not available');
      }
      
      logger.debug('Performing MongoDB health check (ping)', {
        service: 'chat-service',
      });
      const pingStart = Date.now();
      await Promise.race([
        connection.connection.db.admin().ping(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('MongoDB ping timeout after 5s')), 5000);
        }),
      ]);
      const pingDuration = Date.now() - pingStart;
      logger.info('MongoDB health check passed', {
        pingDuration,
        service: 'chat-service',
      });
    } catch (pingError: any) {
      const errorMessage = pingError instanceof Error ? pingError.message : String(pingError);
      logger.error('MongoDB health check failed', {
        error: errorMessage,
        service: 'chat-service',
      });
      throw new Error(`MongoDB connection readyState=1 but health check failed: ${errorMessage}`);
    }

    logger.info('MongoDB connected for Chat Service', {
      readyState: connection.connection.readyState,
      host: connection.connection.host,
      port: connection.connection.port,
      name: connection.connection.name,
      db: connection.connection.db?.databaseName,
      service: 'chat-service',
    });
    
    return connection;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to connect to MongoDB', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      service: 'chat-service',
    });
    throw error;
  }
}

// Track if reconnection is already in progress to avoid multiple concurrent attempts
let reconnectionInProgress = false;

export function getMongo(): typeof mongoose {
  if (!connection) {
    throw new Error('MongoDB not initialized. Call initMongo() first.');
  }
  
  // Health check: verify connection is still alive
  const readyState = connection.connection.readyState;
  if (readyState !== 1) {
    // Connection is not ready - log warning but don't throw (let retry logic handle it)
    // State: 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
    if (readyState === 0 && !reconnectionInProgress) {
      // CRITICAL: Connection disconnected - attempt to reconnect in background (non-blocking)
      logger.warn('MongoDB connection disconnected, attempting to reconnect in background', {
        readyState: 0,
        service: 'chat-service',
      });
      reconnectionInProgress = true;
      
      // Don't block - let the query fail gracefully and return empty results
      // Reconnection will happen in background
      initMongo()
        .then(() => {
          logger.info('MongoDB reconnected successfully', {
            service: 'chat-service',
          });
          reconnectionInProgress = false;
        })
        .catch((err) => {
          logger.error('Failed to reconnect to MongoDB', {
            error: err?.message || String(err),
            service: 'chat-service',
          });
          reconnectionInProgress = false;
        });
    } else if (readyState === 2) {
      // Connection is in progress - this is OK, operations will buffer
      if (process.env.NODE_ENV === 'development') {
        logger.debug('MongoDB connection is still connecting, operations will buffer', {
          readyState: 2,
          service: 'chat-service',
        });
      }
    } else if (readyState === 3) {
      logger.warn('MongoDB connection is disconnecting, operations may fail', {
        readyState: 3,
        service: 'chat-service',
      });
    } else {
      logger.warn('MongoDB connection health check', {
        readyState,
        service: 'chat-service',
      });
    }
  } else {
    // Connection is ready - reset reconnection flag if it was set
    if (reconnectionInProgress) {
      reconnectionInProgress = false;
    }
  }
  
  return connection;
}

/**
 * Health check for MongoDB connection
 */
export function isMongoHealthy(): boolean {
  if (!connection) {
    return false;
  }
  return connection.connection.readyState === 1;
}

/**
 * Ensure MongoDB connection is ready before executing queries
 * Waits for connection to be ready (readyState === 1) with timeout
 * This is critical when bufferCommands = false, as queries will fail immediately if connection isn't ready
 */
export async function ensureMongoReady(timeoutMs: number = 10000): Promise<typeof mongoose> {
  if (!connection) {
    throw new Error('MongoDB not initialized. Call initMongo() first.');
  }

  if (connection.connection.readyState === 1 && connection.connection.db) {
    return connection;
  }

  if (connection.connection.readyState === 0) {
    logger.warn('MongoDB connection disconnected, attempting to reconnect', {
      service: 'chat-service',
    });
    const reconnected = await initMongo();
    connection = reconnected;
    if (reconnected.connection.readyState === 1 && reconnected.connection.db) {
      return reconnected;
    }
  }

  const conn = connection;
  return new Promise<typeof mongoose>((resolve, reject) => {
    const startTime = Date.now();
    const timeout = setTimeout(() => {
      reject(new Error(`MongoDB connection not ready after ${timeoutMs}ms. State: ${conn?.connection.readyState}`));
    }, timeoutMs);

    const checkConnection = () => {
      if (!conn) {
        clearTimeout(timeout);
        reject(new Error('MongoDB connection lost during wait'));
        return;
      }
      if (conn.connection.readyState === 1 && conn.connection.db) {
        clearTimeout(timeout);
        conn.connection.removeListener('open', checkConnection);
        conn.connection.removeListener('error', onError);
        resolve(conn);
        return;
      }
      if (Date.now() - startTime >= timeoutMs) {
        clearTimeout(timeout);
        conn.connection.removeListener('open', checkConnection);
        conn.connection.removeListener('error', onError);
        reject(new Error(`MongoDB connection not ready after ${timeoutMs}ms. State: ${conn.connection.readyState}`));
      }
    };

    const onError = (err: Error) => {
      clearTimeout(timeout);
      conn?.connection.removeListener('open', checkConnection);
      conn?.connection.removeListener('error', onError);
      reject(err);
    };

    if (conn.connection.readyState === 1 && conn.connection.db) {
      clearTimeout(timeout);
      resolve(conn);
      return;
    }
    conn.connection.once('open', checkConnection);
    conn.connection.once('error', onError);
  });
}

export async function closeMongo(): Promise<void> {
  if (!connection) {
    return;
  }

  await disconnectMongo();
  connection = null;
  logger.info('MongoDB disconnected for Chat Service', {
    service: 'chat-service',
  });
}

