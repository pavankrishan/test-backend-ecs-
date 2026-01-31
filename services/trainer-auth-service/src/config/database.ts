import { Pool, PoolClient } from 'pg';
import { createPostgresPool } from '@kodingcaravan/shared';

let pool: Pool | null = null;

export function getPool(): Pool {
	if (!pool) {
		pool = createPostgresPool({});
		// Set application_name via query after pool creation
		if (pool) {
			pool.on('connect', async (client) => {
				await client.query(`SET application_name = 'trainer-auth-service'`);
			});
		}
	}
	if (!pool) {
		throw new Error('Failed to create database pool');
	}
	return pool;
}

export async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
	const client = await getPool().connect();
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

export async function initializeTrainerAuthTables(): Promise<void> {
	const client = await getPool().connect();
	try {
		await client.query('BEGIN');
		await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
		await client.query(`CREATE EXTENSION IF NOT EXISTS "citext";`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS trainers (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				phone VARCHAR(15) UNIQUE,
				email CITEXT UNIQUE,
				username VARCHAR(100) UNIQUE,
				password_hash TEXT,
				is_email_verified BOOLEAN NOT NULL DEFAULT false,
				is_phone_verified BOOLEAN NOT NULL DEFAULT false,
				google_id TEXT,
				auth_provider VARCHAR(20) DEFAULT NULL,
				approval_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
				last_login_at TIMESTAMPTZ,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				CONSTRAINT trainers_auth_provider_check 
					CHECK (auth_provider IS NULL OR auth_provider IN ('email', 'google', 'phone'))
			);
		`);

		// Add approval_status column if it doesn't exist (for existing databases)
		await client.query(`
			DO $$
			BEGIN
				IF NOT EXISTS (
					SELECT 1 FROM information_schema.columns 
					WHERE table_name = 'trainers' AND column_name = 'approval_status'
				) THEN
					ALTER TABLE trainers 
					ADD COLUMN approval_status VARCHAR(20) NOT NULL DEFAULT 'pending'
					CHECK (approval_status IN ('pending', 'approved', 'rejected'));
				END IF;
			END $$;
		`);

		// Add auth_provider column if it doesn't exist (for existing databases)
		await client.query(`
			DO $$
			BEGIN
				IF NOT EXISTS (
					SELECT 1 FROM information_schema.columns 
					WHERE table_name = 'trainers' AND column_name = 'auth_provider'
				) THEN
					ALTER TABLE trainers 
					ADD COLUMN auth_provider VARCHAR(20) DEFAULT NULL;
				END IF;
				
				-- Add constraint if it doesn't exist
				IF NOT EXISTS (
					SELECT 1 FROM information_schema.table_constraints 
					WHERE constraint_name = 'trainers_auth_provider_check'
				) THEN
					ALTER TABLE trainers 
					ADD CONSTRAINT trainers_auth_provider_check 
					CHECK (auth_provider IS NULL OR auth_provider IN ('email', 'google', 'phone'));
				END IF;
			END $$;
		`);

		// Create index for faster queries
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainers_approval_status ON trainers(approval_status);
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS trainer_profiles (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
				full_name VARCHAR(150),
				age INT,
				gender VARCHAR(20),
				address TEXT,
				expertise TEXT,
				experience_years INT,
				extra JSONB,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE(trainer_id)
			);
		`);

		// Add missing columns for existing tables
		await client.query(`
			DO $$
			BEGIN
				-- Add age column if it doesn't exist
				IF NOT EXISTS (
					SELECT 1 FROM information_schema.columns 
					WHERE table_name='trainer_profiles' AND column_name='age'
				) THEN
					ALTER TABLE trainer_profiles ADD COLUMN age INT;
				END IF;
				
				-- Add gender column if it doesn't exist
				IF NOT EXISTS (
					SELECT 1 FROM information_schema.columns 
					WHERE table_name='trainer_profiles' AND column_name='gender'
				) THEN
					ALTER TABLE trainer_profiles ADD COLUMN gender VARCHAR(20);
				END IF;
				
				-- Add address column if it doesn't exist
				IF NOT EXISTS (
					SELECT 1 FROM information_schema.columns 
					WHERE table_name='trainer_profiles' AND column_name='address'
				) THEN
					ALTER TABLE trainer_profiles ADD COLUMN address TEXT;
				END IF;
				
				-- Add expertise column if it doesn't exist
				IF NOT EXISTS (
					SELECT 1 FROM information_schema.columns 
					WHERE table_name='trainer_profiles' AND column_name='expertise'
				) THEN
					ALTER TABLE trainer_profiles ADD COLUMN expertise TEXT;
				END IF;
				
				-- Add experience_years column if it doesn't exist
				IF NOT EXISTS (
					SELECT 1 FROM information_schema.columns 
					WHERE table_name='trainer_profiles' AND column_name='experience_years'
				) THEN
					ALTER TABLE trainer_profiles ADD COLUMN experience_years INT;
				END IF;
				
				-- Add extra column if it doesn't exist
				IF NOT EXISTS (
					SELECT 1 FROM information_schema.columns 
					WHERE table_name='trainer_profiles' AND column_name='extra'
				) THEN
					ALTER TABLE trainer_profiles ADD COLUMN extra JSONB;
				END IF;
				
				-- Add bio column if it doesn't exist
				IF NOT EXISTS (
					SELECT 1 FROM information_schema.columns 
					WHERE table_name='trainer_profiles' AND column_name='bio'
				) THEN
					ALTER TABLE trainer_profiles ADD COLUMN bio TEXT;
				END IF;
				
				-- Add specialties column if it doesn't exist
				IF NOT EXISTS (
					SELECT 1 FROM information_schema.columns 
					WHERE table_name='trainer_profiles' AND column_name='specialties'
				) THEN
					ALTER TABLE trainer_profiles ADD COLUMN specialties TEXT[];
				END IF;
				
				-- Add years_of_experience column if it doesn't exist
				IF NOT EXISTS (
					SELECT 1 FROM information_schema.columns 
					WHERE table_name='trainer_profiles' AND column_name='years_of_experience'
				) THEN
					ALTER TABLE trainer_profiles ADD COLUMN years_of_experience INT;
				END IF;
				
				-- Add hourly_rate column if it doesn't exist
				IF NOT EXISTS (
					SELECT 1 FROM information_schema.columns 
					WHERE table_name='trainer_profiles' AND column_name='hourly_rate'
				) THEN
					ALTER TABLE trainer_profiles ADD COLUMN hourly_rate NUMERIC(10,2);
				END IF;
				
				-- Add availability column if it doesn't exist
				IF NOT EXISTS (
					SELECT 1 FROM information_schema.columns 
					WHERE table_name='trainer_profiles' AND column_name='availability'
				) THEN
					ALTER TABLE trainer_profiles ADD COLUMN availability JSONB;
				END IF;
				
				-- Add preferred_languages column if it doesn't exist
				IF NOT EXISTS (
					SELECT 1 FROM information_schema.columns 
					WHERE table_name='trainer_profiles' AND column_name='preferred_languages'
				) THEN
					ALTER TABLE trainer_profiles ADD COLUMN preferred_languages TEXT[];
				END IF;
				
				-- Add certifications column if it doesn't exist
				IF NOT EXISTS (
					SELECT 1 FROM information_schema.columns 
					WHERE table_name='trainer_profiles' AND column_name='certifications'
				) THEN
					ALTER TABLE trainer_profiles ADD COLUMN certifications TEXT[];
				END IF;
			END $$;
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS trainer_phone_otps (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				phone VARCHAR(15) UNIQUE NOT NULL,
				code_hash TEXT NOT NULL,
				expires_at TIMESTAMPTZ NOT NULL,
				attempt_count INT NOT NULL DEFAULT 0,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS trainer_email_otps (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
				code_hash TEXT NOT NULL,
				expires_at TIMESTAMPTZ NOT NULL,
				attempt_count INT NOT NULL DEFAULT 0,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE(trainer_id)
			);
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS trainer_refresh_tokens (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
			token_hash TEXT NOT NULL,
				expires_at TIMESTAMPTZ NOT NULL,
				user_agent TEXT,
				ip_address TEXT,
				revoked_at TIMESTAMPTZ,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE(token_hash)
			);
		`);

	await client.query(`ALTER TABLE trainer_refresh_tokens ADD COLUMN IF NOT EXISTS token_hash TEXT;`);
	await client.query(`ALTER TABLE trainer_refresh_tokens ADD COLUMN IF NOT EXISTS user_agent TEXT;`);
	await client.query(`ALTER TABLE trainer_refresh_tokens ADD COLUMN IF NOT EXISTS ip_address TEXT;`);
	await client.query(`ALTER TABLE trainer_refresh_tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;`);
	await client.query(`DROP INDEX IF EXISTS idx_trainer_refresh_tokens_token;`);
	await client.query(`
		DO $$
		BEGIN
			IF EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_name = 'trainer_refresh_tokens' AND column_name = 'token'
			) THEN
				EXECUTE '
					UPDATE trainer_refresh_tokens
					SET token_hash = token
					WHERE token IS NOT NULL AND (token_hash IS NULL OR token_hash = '''')
				';
				EXECUTE 'ALTER TABLE trainer_refresh_tokens DROP COLUMN token';
			END IF;
		END
		$$;
	`);
	await client.query(`
		UPDATE trainer_refresh_tokens
		SET token_hash = gen_random_uuid()::text
		WHERE token_hash IS NULL OR token_hash = ''
	`);
	await client.query(`
		DELETE FROM trainer_refresh_tokens t
		WHERE NOT EXISTS (SELECT 1 FROM trainers tr WHERE tr.id = t.trainer_id);
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
			WHERE rel.relname = 'trainer_refresh_tokens'
			  AND con.contype = 'f'
			  AND frel.relname = 'trainer_credentials';

			IF fk_name IS NOT NULL THEN
				EXECUTE format('ALTER TABLE trainer_refresh_tokens DROP CONSTRAINT %I', fk_name);
			END IF;

			IF NOT EXISTS (
				SELECT 1
				FROM pg_constraint con
				JOIN pg_class rel ON rel.oid = con.conrelid
				JOIN pg_class frel ON frel.oid = con.confrelid
				WHERE rel.relname = 'trainer_refresh_tokens'
				  AND con.contype = 'f'
				  AND frel.relname = 'trainers'
			) THEN
				BEGIN
					EXECUTE 'ALTER TABLE trainer_refresh_tokens ADD CONSTRAINT trainer_refresh_tokens_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES trainers(id) ON DELETE CASCADE';
				EXCEPTION
					WHEN duplicate_object THEN
						NULL;
				END;
			END IF;
		END
		$$;
	`);

	await client.query(`
		ALTER TABLE trainer_refresh_tokens
			ALTER COLUMN token_hash SET NOT NULL;
	`);

	await client.query(`
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM pg_constraint
				WHERE conname = 'trainer_refresh_tokens_token_hash_key'
				  AND conrelid = 'trainer_refresh_tokens'::regclass
			) THEN
				ALTER TABLE trainer_refresh_tokens
					ADD CONSTRAINT trainer_refresh_tokens_token_hash_key UNIQUE(token_hash);
			END IF;
		END
		$$;
	`);

		await client.query(`CREATE INDEX IF NOT EXISTS idx_trainers_email ON trainers (email);`);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_trainers_phone ON trainers (phone);`);

		// Indexes for efficient refresh token cleanup
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_refresh_tokens_expires_at 
			ON trainer_refresh_tokens(expires_at) 
			WHERE revoked_at IS NULL;
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_refresh_tokens_revoked_at 
			ON trainer_refresh_tokens(revoked_at) 
			WHERE revoked_at IS NOT NULL;
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_refresh_tokens_trainer_expires 
			ON trainer_refresh_tokens(trainer_id, expires_at);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_refresh_tokens_trainer_created 
			ON trainer_refresh_tokens(trainer_id, created_at DESC);
		`);

		// Create trainer_applications table for refactored application system
		// Note: Foreign keys to cities, zones, and admin_users are added conditionally
		// since those tables may not exist yet
		await client.query(`
			CREATE TABLE IF NOT EXISTS trainer_applications (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
				
				-- Personal Information (Legal Compliance)
				date_of_birth DATE NOT NULL,
				gender TEXT NOT NULL CHECK (gender IN ('male', 'female', 'other')),
				
				-- Raw Location Data (Application Phase)
				address_text TEXT,
				latitude NUMERIC(10, 8),
				longitude NUMERIC(11, 8),
				pincode TEXT,
				
				-- Review Status
				review_status TEXT NOT NULL DEFAULT 'PENDING' 
					CHECK (review_status IN ('PENDING', 'APPROVED', 'REJECTED', 'ON_HOLD')),
				reviewed_by UUID, -- Foreign key added conditionally below
				reviewed_at TIMESTAMPTZ,
				review_notes TEXT,
				
				-- Final Service Assignment (Set during approval)
				city_id UUID, -- Foreign key added conditionally below
				zone_id UUID, -- Foreign key added conditionally below
				
				-- Consent Flags (Legal Requirement)
				consent_info_correct BOOLEAN NOT NULL DEFAULT false,
				consent_background_verification BOOLEAN NOT NULL DEFAULT false,
				consent_travel_to_students BOOLEAN NOT NULL DEFAULT false,
				
				-- Application Metadata
				application_stage TEXT NOT NULL DEFAULT 'submitted'
					CHECK (application_stage IN ('submitted', 'document_verification', 'under_review', 'approved', 'rejected')),
				submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				
				-- Ensure one active application per trainer
				UNIQUE(trainer_id)
			);
		`);

		// Add foreign key constraints conditionally if referenced tables exist
		await client.query(`
			DO $$
			BEGIN
				-- Add foreign key to cities if table exists
				IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cities') THEN
					IF NOT EXISTS (
						SELECT 1 FROM information_schema.table_constraints 
						WHERE table_name = 'trainer_applications' 
						AND constraint_name = 'trainer_applications_city_id_fkey'
					) THEN
						ALTER TABLE trainer_applications 
						ADD CONSTRAINT trainer_applications_city_id_fkey 
						FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE SET NULL;
					END IF;
				END IF;

				-- Add foreign key to zones if table exists
				IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'zones') THEN
					IF NOT EXISTS (
						SELECT 1 FROM information_schema.table_constraints 
						WHERE table_name = 'trainer_applications' 
						AND constraint_name = 'trainer_applications_zone_id_fkey'
					) THEN
						ALTER TABLE trainer_applications 
						ADD CONSTRAINT trainer_applications_zone_id_fkey 
						FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE SET NULL;
					END IF;
				END IF;

				-- Add foreign key to admin_users if table exists
				IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'admin_users') THEN
					IF NOT EXISTS (
						SELECT 1 FROM information_schema.table_constraints 
						WHERE table_name = 'trainer_applications' 
						AND constraint_name = 'trainer_applications_reviewed_by_fkey'
					) THEN
						ALTER TABLE trainer_applications 
						ADD CONSTRAINT trainer_applications_reviewed_by_fkey 
						FOREIGN KEY (reviewed_by) REFERENCES admin_users(id) ON DELETE SET NULL;
					END IF;
				END IF;
			END $$;
		`);

		// Create indexes for trainer_applications
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_applications_trainer 
			ON trainer_applications(trainer_id);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_applications_review_status 
			ON trainer_applications(review_status);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_applications_stage 
			ON trainer_applications(application_stage);
		`);

		// Create skills table FIRST (before tables that reference it)
		await client.query(`
			CREATE TABLE IF NOT EXISTS skills (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				name TEXT UNIQUE NOT NULL,
				category TEXT,
				is_active BOOLEAN NOT NULL DEFAULT true,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);
		`);

		// Create indexes for skills
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_skills_active ON skills(is_active) WHERE is_active = true;
		`);

		// Create trainer_application_skills table (application-stage junction table)
		// Note: Foreign key to skills will be added conditionally below
		await client.query(`
			CREATE TABLE IF NOT EXISTS trainer_application_skills (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				trainer_application_id UUID NOT NULL REFERENCES trainer_applications(id) ON DELETE CASCADE,
				skill_id UUID NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				
				-- Prevent duplicate skill assignments per application
				CONSTRAINT uq_trainer_application_skills_application_skill 
					UNIQUE (trainer_application_id, skill_id)
			);
		`);

		// Add foreign key constraint for skill_id if skills table exists
		await client.query(`
			DO $$
			BEGIN
				IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'skills') THEN
					IF NOT EXISTS (
						SELECT 1 FROM information_schema.table_constraints 
						WHERE table_name = 'trainer_application_skills' 
						AND constraint_name = 'trainer_application_skills_skill_id_fkey'
					) THEN
						ALTER TABLE trainer_application_skills 
						ADD CONSTRAINT trainer_application_skills_skill_id_fkey 
						FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE;
					END IF;
				END IF;
			END $$;
		`);

		// Create indexes for trainer_application_skills
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_application_skills_application 
			ON trainer_application_skills(trainer_application_id);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_application_skills_skill 
			ON trainer_application_skills(skill_id);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_application_skills_created 
			ON trainer_application_skills(created_at DESC);
		`);

		// Create trainer_application_courses table (application-stage junction table)
		await client.query(`
			CREATE TABLE IF NOT EXISTS trainer_application_courses (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				trainer_application_id UUID NOT NULL REFERENCES trainer_applications(id) ON DELETE CASCADE,
				course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
				preference_order INTEGER NOT NULL CHECK (preference_order >= 1 AND preference_order <= 3),
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				
				-- Prevent duplicate course assignments per application
				CONSTRAINT uq_trainer_application_courses_application_course 
					UNIQUE (trainer_application_id, course_id),
				
				-- Prevent duplicate preference orders per application
				-- This constraint alone enforces max 3 courses (since preference_order is 1-3)
				CONSTRAINT uq_trainer_application_courses_application_order 
					UNIQUE (trainer_application_id, preference_order)
			);
		`);

		// Create indexes for trainer_application_courses
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_application_courses_application 
			ON trainer_application_courses(trainer_application_id);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_application_courses_course 
			ON trainer_application_courses(course_id);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_application_courses_order 
			ON trainer_application_courses(trainer_application_id, preference_order);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_application_courses_created 
			ON trainer_application_courses(created_at DESC);
		`);

		// Migrate trainer_documents table to match refactored schema
		await client.query(`
			DO $$
			BEGIN
				-- Check if trainer_documents table exists
				IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trainer_documents') THEN
					-- Add application_id column if it doesn't exist
					IF NOT EXISTS (
						SELECT 1 FROM information_schema.columns 
						WHERE table_name = 'trainer_documents' AND column_name = 'application_id'
					) THEN
						ALTER TABLE trainer_documents 
						ADD COLUMN application_id UUID;
						
						-- Add foreign key constraint if trainer_applications table exists
						IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trainer_applications') THEN
							ALTER TABLE trainer_documents 
							ADD CONSTRAINT trainer_documents_application_id_fkey 
							FOREIGN KEY (application_id) REFERENCES trainer_applications(id) ON DELETE SET NULL;
						END IF;
						
						-- Create index for application_id
						CREATE INDEX IF NOT EXISTS idx_trainer_documents_application 
						ON trainer_documents(application_id);
					END IF;
					
					-- Add file_name column if it doesn't exist
					IF NOT EXISTS (
						SELECT 1 FROM information_schema.columns 
						WHERE table_name = 'trainer_documents' AND column_name = 'file_name'
					) THEN
						ALTER TABLE trainer_documents 
						ADD COLUMN file_name TEXT;
					END IF;
					
					-- Add file_size_bytes column if it doesn't exist
					IF NOT EXISTS (
						SELECT 1 FROM information_schema.columns 
						WHERE table_name = 'trainer_documents' AND column_name = 'file_size_bytes'
					) THEN
						ALTER TABLE trainer_documents 
						ADD COLUMN file_size_bytes INTEGER;
					END IF;
					
					-- Add mime_type column if it doesn't exist
					IF NOT EXISTS (
						SELECT 1 FROM information_schema.columns 
						WHERE table_name = 'trainer_documents' AND column_name = 'mime_type'
					) THEN
						ALTER TABLE trainer_documents 
						ADD COLUMN mime_type TEXT;
					END IF;
					
					-- Handle verification_status column (rename from status if needed)
					IF NOT EXISTS (
						SELECT 1 FROM information_schema.columns 
						WHERE table_name = 'trainer_documents' AND column_name = 'verification_status'
					) THEN
						-- Check if status column exists and rename it
						IF EXISTS (
							SELECT 1 FROM information_schema.columns 
							WHERE table_name = 'trainer_documents' AND column_name = 'status'
						) THEN
							ALTER TABLE trainer_documents 
							RENAME COLUMN status TO verification_status;
						ELSE
							ALTER TABLE trainer_documents 
							ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'pending';
						END IF;
					END IF;
					
					-- Add verified_by column if it doesn't exist (keep reviewer_id for backward compatibility)
					IF NOT EXISTS (
						SELECT 1 FROM information_schema.columns 
						WHERE table_name = 'trainer_documents' AND column_name = 'verified_by'
					) THEN
						ALTER TABLE trainer_documents 
						ADD COLUMN verified_by UUID;
					END IF;
					
					-- Add verified_at column if it doesn't exist (keep reviewed_at for backward compatibility)
					IF NOT EXISTS (
						SELECT 1 FROM information_schema.columns 
						WHERE table_name = 'trainer_documents' AND column_name = 'verified_at'
					) THEN
						ALTER TABLE trainer_documents 
						ADD COLUMN verified_at TIMESTAMPTZ;
					END IF;
					
					-- Add verification_notes column if it doesn't exist (keep rejection_reason for backward compatibility)
					IF NOT EXISTS (
						SELECT 1 FROM information_schema.columns 
						WHERE table_name = 'trainer_documents' AND column_name = 'verification_notes'
					) THEN
						ALTER TABLE trainer_documents 
						ADD COLUMN verification_notes TEXT;
					END IF;
					
					-- Create additional indexes if they don't exist
					CREATE INDEX IF NOT EXISTS idx_trainer_documents_type 
					ON trainer_documents(document_type);
					CREATE INDEX IF NOT EXISTS idx_trainer_documents_status 
					ON trainer_documents(verification_status);
				END IF;
			END $$;
		`);

		// Create courses table if it doesn't exist
		await client.query(`
			CREATE TABLE IF NOT EXISTS courses (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				code TEXT,
				name TEXT NOT NULL,
				description TEXT,
				category TEXT,
				is_active BOOLEAN NOT NULL DEFAULT true,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);
		`);

		// Migrate courses table to add code and name columns (for existing tables)
		await client.query(`
			DO $$
			BEGIN
				IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'courses') THEN
					-- Add code column if it doesn't exist
					IF NOT EXISTS (
						SELECT 1 FROM information_schema.columns 
						WHERE table_name = 'courses' AND column_name = 'code'
					) THEN
						ALTER TABLE courses 
						ADD COLUMN code TEXT;
					END IF;
					
					-- Add name column if it doesn't exist (for backward compatibility with title)
					IF NOT EXISTS (
						SELECT 1 FROM information_schema.columns 
						WHERE table_name = 'courses' AND column_name = 'name'
					) THEN
						ALTER TABLE courses 
						ADD COLUMN name TEXT;
						
						-- Copy title to name if title exists
						IF EXISTS (
							SELECT 1 FROM information_schema.columns 
							WHERE table_name = 'courses' AND column_name = 'title'
						) THEN
							UPDATE courses SET name = title WHERE name IS NULL;
						END IF;
					END IF;
					
					-- Add unique constraint on code if it doesn't exist (only for non-null values)
					IF NOT EXISTS (
						SELECT 1 FROM information_schema.table_constraints 
						WHERE table_name = 'courses' 
						AND constraint_name = 'courses_code_key'
					) THEN
						-- Create unique index on code where code is not null
						CREATE UNIQUE INDEX IF NOT EXISTS courses_code_unique 
						ON courses(code) WHERE code IS NOT NULL;
					END IF;
				END IF;
			END $$;
		`);

		// Create indexes for courses
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_courses_code ON courses(code) WHERE code IS NOT NULL;
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_courses_active ON courses(is_active) WHERE is_active = true;
		`);

		// Create trainer_courses table
		await client.query(`
			CREATE TABLE IF NOT EXISTS trainer_courses (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
				course_id UUID NOT NULL,
				certified_at TIMESTAMPTZ,
				certification_status TEXT NOT NULL DEFAULT 'pending'
					CHECK (certification_status IN ('pending', 'approved', 'rejected')),
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE(trainer_id, course_id)
			);
		`);

		// Add foreign key constraint for course_id if courses table exists
		await client.query(`
			DO $$
			BEGIN
				IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'courses') THEN
					IF NOT EXISTS (
						SELECT 1 FROM information_schema.table_constraints 
						WHERE table_name = 'trainer_courses' 
						AND constraint_name = 'trainer_courses_course_id_fkey'
					) THEN
						ALTER TABLE trainer_courses 
						ADD CONSTRAINT trainer_courses_course_id_fkey 
						FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
					END IF;
				END IF;
			END $$;
		`);

		// Create indexes for trainer_courses
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_courses_trainer 
			ON trainer_courses(trainer_id);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_courses_course 
			ON trainer_courses(course_id);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_courses_status 
			ON trainer_courses(certification_status);
		`);

		// Create trainer_skills table
		// Note: Foreign key to skills will be added conditionally below
		await client.query(`
			CREATE TABLE IF NOT EXISTS trainer_skills (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
				skill_id UUID NOT NULL,
				proficiency_level TEXT CHECK (proficiency_level IN ('beginner', 'intermediate', 'advanced', 'expert')),
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE(trainer_id, skill_id)
			);
		`);

		// Add foreign key constraint for skill_id if skills table exists
		await client.query(`
			DO $$
			BEGIN
				IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'skills') THEN
					IF NOT EXISTS (
						SELECT 1 FROM information_schema.table_constraints 
						WHERE table_name = 'trainer_skills' 
						AND constraint_name = 'trainer_skills_skill_id_fkey'
					) THEN
						ALTER TABLE trainer_skills 
						ADD CONSTRAINT trainer_skills_skill_id_fkey 
						FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE;
					END IF;
				END IF;
			END $$;
		`);

		// Create indexes for trainer_skills
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_skills_trainer 
			ON trainer_skills(trainer_id);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_skills_skill 
			ON trainer_skills(skill_id);
		`);

		// Create trainer_availability table
		await client.query(`
			CREATE TABLE IF NOT EXISTS trainer_availability (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
				slot_start TIME NOT NULL,
				slot_end TIME NOT NULL,
				employment_type TEXT NOT NULL CHECK (employment_type IN ('full-time', 'part-time')),
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE(trainer_id, slot_start)
			);
		`);

		// Create indexes for trainer_availability
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_availability_trainer 
			ON trainer_availability(trainer_id);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_availability_slot 
			ON trainer_availability(slot_start, slot_end);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_trainer_availability_type 
			ON trainer_availability(employment_type);
		`);

		await client.query('COMMIT');
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		client.release();
	}
}

