import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import logger from './logger';

function findEnvPath(startDir = process.cwd()): string | null {
	let current = startDir;
	while (true) {
		const candidate = path.join(current, '.env');
		if (fs.existsSync(candidate)) {
			return candidate;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			break;
		}
		current = parent;
	}
	return null;
}

// Load .env file at import time (safe - only reads file system, no DB connection)
// Note: During Docker build, .env is intentionally excluded (via .dockerignore)
// This is correct - env vars are provided at runtime via docker-compose.yml
const resolvedEnvPath = findEnvPath();

if (resolvedEnvPath) {
	const result = dotenv.config({ path: resolvedEnvPath });
	if (result.error) {
		logger.warn('⚠️ Failed to load .env file, falling back to process environment');
	} else {
		logger.info(`✅ Environment variables loaded from ${resolvedEnvPath}`);
	}
} else {
	// Only warn in runtime context, not during Docker build
	// During Docker build, .env is intentionally excluded (via .dockerignore) - this is expected
	// Env vars are provided at runtime via docker-compose.yml env_file directive
	if (process.env.NODE_ENV !== undefined) {
		// We're in runtime context - warn if .env is missing
		logger.warn('⚠️ .env file not found in current or parent directories, using process environment');
	}
	// During build (NODE_ENV undefined), silently use process.env (which is empty, but that's OK)
	// This prevents confusing warnings during Docker build
}

/**
 * Validate required environment variables at runtime
 * This function should ONLY be called from runtime entrypoints (main(), start(), bootstrap())
 * NOT at module import time to avoid requiring env vars during Docker build
 * 
 * @throws Error if required variables are missing
 */
export function validateRequiredEnvVars(): void {
	const requiredVars = ['NODE_ENV', 'JWT_SECRET'];
	// Cloud-only: at least one of these must be set for PostgreSQL (no localhost)
	const requireOneOf: Array<[string, string[]]> = [['POSTGRES_URL or POSTGRES_URI or DATABASE_URL (cloud PostgreSQL only)', ['POSTGRES_URL', 'POSTGRES_URI', 'DATABASE_URL']]];

	const missing: string[] = [];
	
	requiredVars.forEach((key) => {
		if (!process.env[key]) {
			missing.push(key);
			logger.warn(`⚠️ Missing environment variable: ${key}`);
		}
	});

	requireOneOf.forEach(([label, keys]) => {
		const satisfied = keys.some((key) => !!process.env[key]);
		if (!satisfied) {
			missing.push(label);
			logger.warn(`⚠️ Missing environment variable: ${label}`);
		}
	});

	if (missing.length > 0) {
		throw new Error(
			`Missing required environment variables: ${missing.join(', ')}\n` +
			'These variables are required at runtime but should NOT be needed during Docker build.'
		);
	}
}

// DO NOT validate at import time - validation should only happen at runtime
// This allows Docker builds to complete without runtime environment variables
export {};
