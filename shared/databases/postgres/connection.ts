import { createCloudConnectionPool, CloudDatabaseConfig } from './cloud-connection';
import logger from '../../config/logger';

/**
 * Legacy function for backward compatibility
 * @deprecated Use createCloudConnectionPool for new implementations
 */
export function buildPostgresConnectionString(env: NodeJS.ProcessEnv): string {
	// Cloud-only: require POSTGRES_URL, POSTGRES_URI, or DATABASE_URL (no localhost fallback)
	const url = env.POSTGRES_URL || env.POSTGRES_URI || env.DATABASE_URL;
	if (!url) {
		throw new Error(
			'POSTGRES_URL (or POSTGRES_URI / DATABASE_URL) is required. This project uses cloud PostgreSQL only. ' +
			'Set POSTGRES_URL to your cloud database connection string (e.g. Render, Neon, Supabase).'
		);
	}
	// Allow SSL mode to be appended if not present and SSL requested
	if (env.POSTGRES_SSL === 'true' && !/sslmode=/.test(url)) {
		const sep = url.includes('?') ? '&' : '?';
		return `${url}${sep}sslmode=require`;
	}
	return url;
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use createCloudConnectionPool for new implementations
 */
export function createPostgresPool(overrides: Partial<CloudDatabaseConfig> = {}): any {
	logger.warn('createPostgresPool is deprecated. Use createCloudConnectionPool for cloud databases.', {
		service: 'postgres-connection',
	});

	// Build connection string from environment variables
	// Supports POSTGRES_URL, POSTGRES_URI, or DATABASE_URL
	const connectionString = buildPostgresConnectionString(process.env);
	const sslEnv = process.env.POSTGRES_SSL === 'true';
	const sslFromUrl = /sslmode=require|ssl=true/i.test(connectionString);
	const useSsl = sslEnv || sslFromUrl;

	// Always pass connectionString to createCloudConnectionPool
	// This ensures DATABASE_URL, POSTGRES_URL, or individual vars all work
	return createCloudConnectionPool({
		connectionString,
		ssl: useSsl ? { rejectUnauthorized: false } : false,
		max: 10,
		idleTimeoutMillis: 30000,
		connectionTimeoutMillis: 10000,
		...overrides,
	});
}

// Export cloud connection functions for new implementations
export { createCloudConnectionPool, checkCloudDatabaseHealth, getCloudConnectionStats, closeCloudConnectionPool } from './cloud-connection';
