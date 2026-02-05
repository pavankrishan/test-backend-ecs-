import { Pool, PoolConfig } from 'pg';
import { SAFE_POOL_LIMITS } from '../../config/pool-limits';
import logger from '../../config/logger';

/**
 * Cloud Database Connection Configuration
 * Production-ready connection pooling for cloud PostgreSQL databases
 */

export interface CloudDatabaseConfig {
  // Connection details
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  connectionString?: string;

  // SSL Configuration (required for most cloud databases)
  ssl?: boolean | object;

  // Connection pool settings
  min?: number;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;

  // Cloud provider detection
  provider?: 'aws-rds' | 'google-cloud-sql' | 'azure-database' | 'digital-ocean' | 'supabase' | 'neon' | 'render' | 'other';
}

/**
 * Detect cloud database provider from connection details
 */
export function detectCloudProvider(host?: string, connectionString?: string): CloudDatabaseConfig['provider'] {
  if (!host && !connectionString) return 'other';

  const target = (connectionString || host || '').toLowerCase();

  if (target.includes('rds.amazonaws.com')) return 'aws-rds';
  if (target.includes('cloudsql') || target.includes('gcp')) return 'google-cloud-sql';
  if (target.includes('postgres.database.azure.com')) return 'azure-database';
  if (target.includes('digitalocean')) return 'digital-ocean';
  if (target.includes('supabase')) return 'supabase';
  if (target.includes('neon.tech')) return 'neon';
  if (target.includes('render.com')) return 'render';

  return 'other';
}

/**
 * Get optimized connection configuration for cloud databases
 */
export function getCloudDatabaseConfig(env: NodeJS.ProcessEnv = process.env): CloudDatabaseConfig {
  const isProduction = env.NODE_ENV === 'production';
  const connectionString = env.POSTGRES_URL || env.POSTGRES_URI || env.DATABASE_URL;
  const provider = detectCloudProvider(env.POSTGRES_HOST, connectionString);

  logger.info('Detected database provider', { provider });

  // Base configuration - use safe pool limits to prevent connection exhaustion
  const baseConfig: CloudDatabaseConfig = {
    provider: provider || 'other',
    ssl: true, // Default to SSL for cloud databases

    // Connection pool settings - use safe limits to prevent PostgreSQL max_connections exhaustion
    min: SAFE_POOL_LIMITS.getMin(),
    max: SAFE_POOL_LIMITS.getMax(), // Safe limit: 10 per service in production
    idleTimeoutMillis: 30000, // 30 seconds
    connectionTimeoutMillis: 30000, // 30 seconds (ECS/RDS cold start, slow networks)
  };

  // Provider-specific optimizations
  switch (provider) {
    case 'aws-rds':
      return {
        ...baseConfig,
        ssl: {
          rejectUnauthorized: false,
          // AWS RDS specific SSL settings can be added here
        },
        // Use safe limits even for AWS RDS to prevent connection exhaustion across services
        max: SAFE_POOL_LIMITS.getMax(),
        connectionTimeoutMillis: 30000, // RDS can be slower during failover
      };

    case 'google-cloud-sql':
      return {
        ...baseConfig,
        ssl: {
          rejectUnauthorized: false,
          // Cloud SQL specific SSL settings
        },
        // Use safe limits to prevent connection exhaustion
        max: SAFE_POOL_LIMITS.getMax(),
      };

    case 'azure-database':
      return {
        ...baseConfig,
        ssl: {
          rejectUnauthorized: false,
        },
        // Use safe limits to prevent connection exhaustion
        max: SAFE_POOL_LIMITS.getMax(),
      };

    case 'supabase':
      return {
        ...baseConfig,
        ssl: {
          rejectUnauthorized: false,
        },
        // Use safe limits to prevent connection exhaustion
        max: SAFE_POOL_LIMITS.getMax(),
      };

    case 'neon':
      return {
        ...baseConfig,
        ssl: {
          rejectUnauthorized: false,
        },
        // Use safe limits to prevent connection exhaustion
        max: SAFE_POOL_LIMITS.getMax(),
        idleTimeoutMillis: 60000, // Neon keeps connections alive longer
      };

    case 'render':
      // From ECS/EC2 use Render External Database URL (not Internal).
      return {
        ...baseConfig,
        ssl: { rejectUnauthorized: false },
        max: SAFE_POOL_LIMITS.getMax(),
        connectionTimeoutMillis: 60000, // Render free-tier spins down; first connection can take 60s
        idleTimeoutMillis: 30000,
      };

    default:
      // Generic cloud database settings
      return {
        ...baseConfig,
        ssl: {
          rejectUnauthorized: false,
        },
      };
  }
}

/**
 * Create optimized connection pool for cloud databases
 */
export function createCloudConnectionPool(config?: Partial<CloudDatabaseConfig>): Pool {
  const cloudConfig = getCloudDatabaseConfig();
  // Cloud-only: require connection string from config or env (POSTGRES_URL / POSTGRES_URI / DATABASE_URL)
  const connectionString = config?.connectionString
    || process.env.POSTGRES_URL
    || process.env.POSTGRES_URI
    || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'POSTGRES_URL (or POSTGRES_URI / DATABASE_URL) is required. This project uses cloud PostgreSQL only. ' +
      'Set POSTGRES_URL to your cloud database connection string (e.g. Render, Neon, Supabase).'
    );
  }
  const finalConfig: PoolConfig = {
    connectionString,

    // SSL: ECS has no .env — use POSTGRES_SSL or, for Render/Neon/Supabase, default to SSL
    ssl: config?.ssl !== undefined
      ? config.ssl
      : process.env.POSTGRES_SSL === 'true'
        ? { rejectUnauthorized: false }
        : (cloudConfig.provider === 'render' || cloudConfig.provider === 'neon' || cloudConfig.provider === 'supabase')
          ? (cloudConfig.ssl as object)
          : false,

    // Pool configuration
    min: config?.min || cloudConfig.min,
    max: config?.max || cloudConfig.max,
    idleTimeoutMillis: config?.idleTimeoutMillis || cloudConfig.idleTimeoutMillis,
    connectionTimeoutMillis: config?.connectionTimeoutMillis || cloudConfig.connectionTimeoutMillis,

    // Additional settings for cloud databases
    allowExitOnIdle: true,
    keepAlive: true,
    keepAliveInitialDelayMillis: 0,

    // Application name for monitoring
    application_name: `koding-caravan-${process.env.NODE_ENV || 'development'}-${process.pid}`,
    
    // Statement timeout (30 seconds default, configurable via env)
    // Prevents queries from running indefinitely
    options: `-c statement_timeout=${process.env.DB_STATEMENT_TIMEOUT || '30000'}`,
  };

  const pool = new Pool(finalConfig);

  // Cloud database event handlers
  pool.on('connect', (client) => {
    logger.info('Connected to database', { provider: cloudConfig.provider });

    // Set session-specific settings for cloud databases
    client.query('SET timezone="UTC";').catch((err) => {
      logger.warn('Failed to set timezone', { error: err.message });
    });

    // Provider-specific session settings
    switch (cloudConfig.provider) {
      case 'aws-rds':
        // AWS RDS specific session settings
        client.query('SET work_mem = "64MB";').catch((err) => {
          logger.warn('Failed to set work_mem for AWS RDS', { error: err.message });
        });
        break;
      case 'google-cloud-sql':
        // Cloud SQL specific settings
        client.query('SET work_mem = "32MB";').catch((err) => {
          logger.warn('Failed to set work_mem for Cloud SQL', { error: err.message });
        });
        break;
    }
  });

  pool.on('error', (err, client) => {
    // Don't log connection termination errors as critical - they're often transient
    const nodeError = err as NodeJS.ErrnoException;
    const isConnectionError = err.message?.includes('Connection terminated') || 
                              err.message?.includes('ECONNRESET') ||
                              err.message?.includes('ECONNREFUSED') ||
                              nodeError.code === 'ECONNRESET' ||
                              nodeError.code === 'ECONNREFUSED';
    
    if (isConnectionError) {
      logger.warn('Database connection error (will retry on next query)', {
        error: err.message,
        code: nodeError.code,
      });
      // Connection pool will automatically retry on next query
      // Don't throw - let the pool handle reconnection
    } else {
      logger.error('Unexpected error on idle client', {
        error: err.message,
        code: nodeError.code,
        stack: err.stack,
      });
      // For non-connection errors, we might want to implement reconnection logic
    }
  });

  pool.on('remove', (client) => {
    logger.debug('Client removed from pool');
  });

  return pool;
}

/**
 * Health check for cloud database connection
 */
export async function checkCloudDatabaseHealth(pool: Pool): Promise<{
  isHealthy: boolean;
  responseTime: number;
  connectionCount: number;
  provider: string;
  errors: string[];
}> {
  const startTime = Date.now();
  const errors: string[] = [];
  const connectionString = process.env.POSTGRES_URL || process.env.POSTGRES_URI || process.env.DATABASE_URL;
  const provider = detectCloudProvider(process.env.POSTGRES_HOST, connectionString);

  try {
    // Test basic connectivity
    const client = await pool.connect();
    const queryStart = Date.now();

    try {
      // Test with a simple query
      const result = await client.query('SELECT version(), current_timestamp, pg_postmaster_start_time()');
      const queryTime = Date.now() - queryStart;

      // Check if we're getting reasonable responses
      if (!result.rows[0]?.version) {
        errors.push('Invalid database response');
      }

      console.log(`✅ Database health check passed (${queryTime}ms)`);
      console.log(`   Provider: ${provider}`);
      console.log(`   PostgreSQL Version: ${result.rows[0].version?.split(' ')[1] || 'Unknown'}`);
      console.log(`   Connection Time: ${queryTime}ms`);

      return {
        isHealthy: errors.length === 0,
        responseTime: queryTime,
        connectionCount: pool.totalCount,
        provider: provider || 'unknown',
        errors
      };

    } finally {
      client.release();
    }

  } catch (error: any) {
    const totalTime = Date.now() - startTime;
    errors.push(`Connection failed: ${error.message}`);

    console.error(`❌ Database health check failed (${totalTime}ms):`, error.message);

    return {
      isHealthy: false,
      responseTime: totalTime,
      connectionCount: pool.totalCount,
      provider: provider || 'unknown',
      errors
    };
  }
}

/**
 * Graceful shutdown for cloud database connections
 */
export async function closeCloudConnectionPool(pool: Pool): Promise<void> {
  console.log('🔄 Closing cloud database connection pool...');

  try {
    await pool.end();
    console.log('✅ Database connection pool closed successfully');
  } catch (error: any) {
    console.error('❌ Error closing database connection pool:', error.message);
    throw error;
  }
}

/**
 * Get connection pool statistics for monitoring
 */
export function getCloudConnectionStats(pool: Pool): {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  provider: string;
} {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    provider: detectCloudProvider(process.env.POSTGRES_HOST, process.env.POSTGRES_URL || process.env.POSTGRES_URI || process.env.DATABASE_URL) || 'unknown'
  };
}
