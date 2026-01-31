/**
 * Centralized Configuration Loader with Zod Validation
 * Provides type-safe configuration loading with runtime validation
 */

import { z } from 'zod';

// Base configuration schema
const BaseConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  SERVICE_NAME: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
});

// Database schemas
// Accept direct URL (POSTGRES_URL / POSTGRES_URI / DATABASE_URL) or POSTGRES_USER + POSTGRES_PASSWORD + POSTGRES_DB
const PostgresConfigSchema = z.object({
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_USER: z.string().optional(),
  POSTGRES_PASSWORD: z.string().optional(),
  POSTGRES_DB: z.string().optional(),
  POSTGRES_SSL: z.coerce.boolean().default(false),
  POSTGRES_URL: z.string().optional(),
  POSTGRES_URI: z.string().optional(),
  DATABASE_URL: z.string().optional(),
});

const MongoConfigSchema = z.object({
  MONGO_URI: z.string().url(),
  MONGO_DB_NAME: z.string().min(1),
});

const RedisConfigSchema = z.object({
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().nonnegative().default(0),
  REDIS_URL: z.string().url().optional(), // For Upstash/managed Redis (supports TLS)
  REDIS_TLS: z.coerce.boolean().optional(), // Explicit TLS flag
});

// JWT Configuration
const JWTConfigSchema = z.object({
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
});

// Kafka Configuration
const KafkaConfigSchema = z.object({
  KAFKA_BROKERS: z.string().transform((val) => val.split(',')),
  KAFKA_CLIENT_ID: z.string().default('kodingcaravan-service'),
  KAFKA_GROUP_ID: z.string().optional(),
});

// S3 Configuration
const S3ConfigSchema = z.object({
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_S3_BUCKET: z.string().min(1),
  AWS_S3_ENDPOINT: z.string().url().optional(),
});

// CORS Configuration
const CorsConfigSchema = z.object({
  CORS_ORIGIN: z.string().transform((val) => val.split(',')).default('*'),
  CORS_CREDENTIALS: z.coerce.boolean().default(true),
});

// Rate Limiting
const RateLimitConfigSchema = z.object({
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
});

export type BaseConfig = z.infer<typeof BaseConfigSchema>;
export type PostgresConfig = z.infer<typeof PostgresConfigSchema>;
export type MongoConfig = z.infer<typeof MongoConfigSchema>;
export type RedisConfig = z.infer<typeof RedisConfigSchema>;
export type JWTConfig = z.infer<typeof JWTConfigSchema>;
export type KafkaConfig = z.infer<typeof KafkaConfigSchema>;
export type S3Config = z.infer<typeof S3ConfigSchema>;
export type CorsConfig = z.infer<typeof CorsConfigSchema>;
export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;

/**
 * Service Configuration Schema Builder
 */
export interface ServiceConfigOptions {
  requirePostgres?: boolean;
  requireMongo?: boolean;
  requireRedis?: boolean;
  requireJWT?: boolean;
  requireKafka?: boolean;
  requireS3?: boolean;
  requireCors?: boolean;
  requireRateLimit?: boolean;
  customSchema?: z.ZodObject<any>;
}

/**
 * Load and validate configuration for a service
 */
export function loadServiceConfig<T extends z.ZodObject<any>>(
  serviceName: string,
  options: ServiceConfigOptions = {},
  customSchema?: T
): BaseConfig & Partial<PostgresConfig & MongoConfig & RedisConfig & JWTConfig & KafkaConfig & S3Config & CorsConfig & RateLimitConfig> & z.infer<T> {
  const env = process.env;

  // Start with base config
  const baseConfig = BaseConfigSchema.parse({
    NODE_ENV: env.NODE_ENV,
    LOG_LEVEL: env.LOG_LEVEL,
    SERVICE_NAME: serviceName,
    PORT: env.PORT || env[`${serviceName.toUpperCase().replace('-', '_')}_PORT`],
  });

  // Build combined schema
  let schema: z.ZodObject<any> = BaseConfigSchema;

  if (options.requirePostgres) {
    schema = schema.merge(PostgresConfigSchema);
  }
  if (options.requireMongo) {
    schema = schema.merge(MongoConfigSchema);
  }
  if (options.requireRedis) {
    schema = schema.merge(RedisConfigSchema);
  }
  if (options.requireJWT) {
    schema = schema.merge(JWTConfigSchema);
  }
  if (options.requireKafka) {
    schema = schema.merge(KafkaConfigSchema);
  }
  if (options.requireS3) {
    schema = schema.merge(S3ConfigSchema);
  }
  if (options.requireCors) {
    schema = schema.merge(CorsConfigSchema);
  }
  if (options.requireRateLimit) {
    schema = schema.merge(RateLimitConfigSchema);
  }
  if (customSchema) {
    schema = schema.merge(customSchema);
  }

  // Validate and parse
  try {
    const config = schema.parse(env);
    // When Postgres is required, ensure either direct URL or USER+PASSWORD+DB
    if (options.requirePostgres) {
      const c = config as Record<string, unknown>;
      const hasUrl = !!(c.POSTGRES_URL || c.POSTGRES_URI || c.DATABASE_URL);
      const hasIndividual = !!(c.POSTGRES_USER && c.POSTGRES_PASSWORD && c.POSTGRES_DB);
      if (!hasUrl && !hasIndividual) {
        throw new Error(
          `Configuration validation failed for ${serviceName}:\n` +
            'Postgres requires either POSTGRES_URL (or POSTGRES_URI or DATABASE_URL) or POSTGRES_USER + POSTGRES_PASSWORD + POSTGRES_DB'
        );
      }
    }
    return config as any;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingFields = error.errors.map((err) => `${err.path.join('.')}: ${err.message}`);
      throw new Error(
        `Configuration validation failed for ${serviceName}:\n${missingFields.join('\n')}`
      );
    }
    throw error;
  }
}

/**
 * Helper to get config value with type safety
 */
export function getConfig<T>(config: any, key: string, defaultValue?: T): T | undefined {
  return config[key] !== undefined ? (config[key] as T) : defaultValue;
}

