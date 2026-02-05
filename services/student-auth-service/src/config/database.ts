import { Pool, PoolClient } from 'pg';
import { createPostgresPool } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';

let pool: Pool | null = null;

export function getPool(): Pool {
	if (!pool) {
		pool = createPostgresPool({
			connectionTimeoutMillis: 30000, // 30s for ECS/RDS cold start
			max: 10,
		});
	}
	// TypeScript assertion: pool is guaranteed to be non-null after the check above
	return pool as Pool;
}

export async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
	const pool = getPool();
	let client: PoolClient | null = null;
	let retries = 3;
	
	while (retries > 0) {
		try {
			client = await pool.connect();
			await client.query('BEGIN');
			const result = await handler(client);
			await client.query('COMMIT');
			return result;
		} catch (err: any) {
			// Check if it's a connection error that might be transient
			const isConnectionError = err?.message?.includes('Connection terminated') || 
									  err?.message?.includes('ECONNRESET') ||
									  err?.message?.includes('ECONNREFUSED') ||
									  err?.code === 'ECONNRESET' ||
									  err?.code === 'ECONNREFUSED' ||
									  err?.message?.includes('Client has encountered a connection error');
			
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
					delay,
					attempt: 3 - retries,
					maxRetries: 3,
					error: err?.message || String(err),
					service: 'student-auth-service',
				});
				await new Promise((resolve) => setTimeout(resolve, delay));
				continue;
			}
			
			// Non-connection error or max retries reached
			throw err;
		} finally {
			if (client) {
				client.release();
			}
		}
	}
	
	throw new Error('Failed to execute transaction after retries');
}

export async function initializeStudentAuthTables(): Promise<void> {
	const client = await getPool().connect();
	try {
		await client.query('BEGIN');

		await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
		await client.query(`CREATE EXTENSION IF NOT EXISTS "citext";`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS students (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				phone VARCHAR(15) UNIQUE,
				email CITEXT UNIQUE,
				username VARCHAR(100) UNIQUE,
				password_hash TEXT,
				is_email_verified BOOLEAN NOT NULL DEFAULT false,
				is_phone_verified BOOLEAN NOT NULL DEFAULT false,
				google_id TEXT,
				auth_provider VARCHAR(50),
				last_login_at TIMESTAMPTZ,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);
		`);

		// Add auth_provider column if it doesn't exist (for existing tables)
		await client.query(`
			ALTER TABLE students ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(50);
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS student_profiles (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
				full_name VARCHAR(150),
				age INT,
				gender VARCHAR(20),
				address TEXT,
				latitude DOUBLE PRECISION,
				longitude DOUBLE PRECISION,
				extra JSONB,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE(student_id)
			);
		`);

		// Add latitude/longitude columns if they don't exist
		await client.query(`
			ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
		`);
		await client.query(`
			ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS student_phone_otps (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				phone VARCHAR(15) UNIQUE NOT NULL,
				code_hash TEXT NOT NULL,
				expires_at TIMESTAMPTZ NOT NULL,
				attempt_count INT NOT NULL DEFAULT 0,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS student_email_otps (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
				code_hash TEXT NOT NULL,
				expires_at TIMESTAMPTZ NOT NULL,
				attempt_count INT NOT NULL DEFAULT 0,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE(student_id)
			);
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS student_refresh_tokens (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
				token_hash TEXT NOT NULL,
				expires_at TIMESTAMPTZ NOT NULL,
				user_agent TEXT,
				ip_address TEXT,
				revoked_at TIMESTAMPTZ,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE(token_hash)
			);
		`);

		await client.query(`ALTER TABLE student_refresh_tokens ADD COLUMN IF NOT EXISTS token_hash TEXT;`);
		await client.query(`ALTER TABLE student_refresh_tokens ADD COLUMN IF NOT EXISTS user_agent TEXT;`);
		await client.query(`ALTER TABLE student_refresh_tokens ADD COLUMN IF NOT EXISTS ip_address TEXT;`);
		await client.query(`ALTER TABLE student_refresh_tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;`);
		await client.query(`DROP INDEX IF EXISTS idx_student_refresh_tokens_token;`);
		await client.query(`
			DO $$
			BEGIN
				IF EXISTS (
					SELECT 1 FROM information_schema.columns
					WHERE table_name = 'student_refresh_tokens' AND column_name = 'token'
				) THEN
					EXECUTE '
						UPDATE student_refresh_tokens
						SET token_hash = token
						WHERE token IS NOT NULL AND (token_hash IS NULL OR token_hash = '''')
					';
					EXECUTE 'ALTER TABLE student_refresh_tokens DROP COLUMN token';
				END IF;
			END
			$$;
		`);
		await client.query(`
			UPDATE student_refresh_tokens
			SET token_hash = gen_random_uuid()::text
			WHERE token_hash IS NULL OR token_hash = ''
		`);
		await client.query(`
			DELETE FROM student_refresh_tokens s
			WHERE NOT EXISTS (SELECT 1 FROM students st WHERE st.id = s.student_id);
		`);
		await client.query(`
			DO $$
			DECLARE
				fk_name text;
			BEGIN
				SELECT con.conname
				INTO fk_name
				FROM pg_constraint con
				JOIN pg_class rel ON rel.oid = con.conrelid
				JOIN pg_class frel ON frel.oid = con.confrelid
				WHERE rel.relname = 'student_refresh_tokens'
				  AND con.contype = 'f'
				  AND frel.relname = 'student_credentials';

				IF fk_name IS NOT NULL THEN
					EXECUTE format('ALTER TABLE student_refresh_tokens DROP CONSTRAINT %I', fk_name);
				END IF;

				IF NOT EXISTS (
					SELECT 1
					FROM pg_constraint con
					JOIN pg_class rel ON rel.oid = con.conrelid
					JOIN pg_class frel ON frel.oid = con.confrelid
					WHERE rel.relname = 'student_refresh_tokens'
					  AND con.contype = 'f'
					  AND frel.relname = 'students'
				) THEN
					BEGIN
						EXECUTE 'ALTER TABLE student_refresh_tokens ADD CONSTRAINT student_refresh_tokens_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE';
					EXCEPTION
						WHEN duplicate_object THEN
							NULL;
					END;
				END IF;
			END
			$$;
		`);

		await client.query(`
			ALTER TABLE student_refresh_tokens
				ALTER COLUMN token_hash SET NOT NULL;
		`);

		await client.query(`
			DO $$
			BEGIN
				IF NOT EXISTS (
					SELECT 1 FROM pg_constraint
					WHERE conname = 'student_refresh_tokens_token_hash_key'
					  AND conrelid = 'student_refresh_tokens'::regclass
				) THEN
					ALTER TABLE student_refresh_tokens
						ADD CONSTRAINT student_refresh_tokens_token_hash_key UNIQUE(token_hash);
				END IF;
			END
			$$;
		`);

		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_students_email ON students (email);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_students_phone ON students (phone);
		`);

		// Indexes for efficient refresh token cleanup
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_student_refresh_tokens_expires_at 
			ON student_refresh_tokens(expires_at) 
			WHERE revoked_at IS NULL;
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_student_refresh_tokens_revoked_at 
			ON student_refresh_tokens(revoked_at) 
			WHERE revoked_at IS NOT NULL;
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_student_refresh_tokens_student_expires 
			ON student_refresh_tokens(student_id, expires_at);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_student_refresh_tokens_student_created 
			ON student_refresh_tokens(student_id, created_at DESC);
		`);

		await client.query('COMMIT');
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		client.release();
	}
}
