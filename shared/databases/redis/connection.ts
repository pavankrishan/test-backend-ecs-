import Redis, { RedisOptions } from 'ioredis';
import dns from 'dns';
import { promisify } from 'util';

const resolve4 = promisify(dns.resolve4);

const toNumber = (value: string | undefined, fallback: number): number => {
	if (!value) {
		return fallback;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Custom DNS lookup function that uses resolve4 instead of lookup
 * This fixes DNS resolution issues on Windows where dns.lookup fails
 * but dns.resolve4 works correctly
 * 
 * ioredis expects a callback-based lookup function
 */
function customLookup(
	hostname: string,
	callback: (err: NodeJS.ErrnoException | null, address?: string) => void
): void {
	// Try resolve4 first (works on Windows)
	resolve4(hostname)
		.then((addresses) => {
			callback(null, addresses[0]); // Return first IPv4 address
		})
		.catch(() => {
			// Fallback to default lookup if resolve4 fails
			dns.lookup(hostname, callback);
		});
}

// Type assertion for lookup option (ioredis supports it but types may be outdated)
interface RedisOptionsWithLookup extends RedisOptions {
	lookup?: typeof customLookup;
}

/**
 * Build Redis connection options from the current environment.
 * Cloud-only: REDIS_URL (or REDIS_URI) is required (e.g. Upstash). No localhost fallback.
 */
export function buildRedisConfig(env: NodeJS.ProcessEnv): string | RedisOptions {
	const url = env.REDIS_URL || env.REDIS_URI;
	if (url) {
		return url;
	}
	throw new Error(
		'REDIS_URL (or REDIS_URI) is required. This project uses cloud Redis only. ' +
		'Set REDIS_URL to your cloud connection string (e.g. Upstash rediss://...).'
	);
}

let singleton: Redis | null = null;

/**
 * Create a new Redis client instance using environment configuration.
 * Consumers who need a singleton should use `getRedisClient`.
 */
export function createRedisClient(overrides: RedisOptions = {}): Redis {
	const config = buildRedisConfig(process.env);
	
	// If config is a URL string, we need to parse it and add custom lookup
	let client: Redis;
	if (typeof config === 'string') {
		const url = new URL(config);
		const options: RedisOptionsWithLookup = {
			host: url.hostname,
			port: parseInt(url.port || '6379', 10),
			password: url.password,
			db: 0,
			lazyConnect: true,
			retryStrategy: (times) => Math.min(times * 50, 1000),
			lookup: customLookup, // Use custom DNS lookup
			...overrides,
		};
		
		// Add TLS if rediss:// protocol
		if (url.protocol === 'rediss:') {
			options.tls = {
				servername: url.hostname, // Important for SNI
			};
		}
		
		client = new Redis(options);
	} else {
		client = new Redis({ ...config, ...overrides });
	}

	client.on('error', (err) => {
		// Import logger here to avoid circular dependency
		const logger = require('../../config/logger').default;
		logger.error('Redis connection error', {
			error: err.message,
			stack: err.stack,
		});
	});

	return client;
}

/**
 * Lazily instantiate and return a shared Redis client.
 */
export function getRedisClient(overrides: RedisOptions = {}): Redis {
	if (!singleton) {
		singleton = createRedisClient(overrides);
	}
	return singleton;
}

/**
 * Gracefully close the shared Redis connection, if it exists.
 */
export async function disconnectRedis(): Promise<void> {
	if (singleton) {
		await singleton.quit();
		singleton = null;
	}
}

