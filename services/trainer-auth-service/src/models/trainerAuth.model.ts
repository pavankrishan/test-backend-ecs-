import { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { getPool } from '../config/database';
import logger from '@kodingcaravan/shared/config/logger';

export type TrainerRecord = {
	id: string;
	phone: string | null;
	email: string | null;
	username: string | null;
	passwordHash: string | null;
	isEmailVerified: boolean;
	isPhoneVerified: boolean;
	googleId: string | null;
	authProvider: string | null;
	approvalStatus: 'pending' | 'approved' | 'rejected';
	lastLoginAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

export type TrainerProfileRecord = {
	id: string;
	trainerId: string;
	fullName: string | null;
	age: number | null;
	gender: string | null;
	address: string | null;
	expertise: string | null;
	specialties: string[] | null; // Array of specialties/courses
	experienceYears: number | null;
	extra: any;
	approvalStatus?: 'pending' | 'approved' | 'rejected'; // Added from trainers table
	phone?: string | null; // Phone from trainers table
	createdAt: Date;
	updatedAt: Date;
};

const trainerColumns = `
	id,
	phone,
	email,
	username,
	password_hash as "passwordHash",
	is_email_verified as "isEmailVerified",
	is_phone_verified as "isPhoneVerified",
	google_id as "googleId",
	auth_provider as "authProvider",
	approval_status as "approvalStatus",
	last_login_at as "lastLoginAt",
	created_at as "createdAt",
	updated_at as "updatedAt"
`;

const profileColumns = `
	id,
	trainer_id as "trainerId",
	full_name as "fullName",
	age,
	gender,
	address,
	expertise,
	experience_years as "experienceYears",
	extra,
	created_at as "createdAt",
	updated_at as "updatedAt"
`;

// Profile columns with table prefix for JOIN queries
const profileColumnsWithPrefix = `
	tp.id,
	tp.trainer_id as "trainerId",
	tp.full_name as "fullName",
	tp.age,
	tp.gender,
	tp.address,
	tp.expertise,
	tp.specialties,
	tp.experience_years as "experienceYears",
	tp.extra,
	tp.created_at as "createdAt",
	tp.updated_at as "updatedAt"
`;

async function query<T extends QueryResultRow = any>(text: string, params: any[] = [], client?: PoolClient): Promise<QueryResult<T>> {
	try {
	if (client) {
			return await client.query<T>(text, params);
	}
		return await getPool().query<T>(text, params);
	} catch (error: any) {
		logger.error('Database query error', {
			query: text.substring(0, 100),
			paramsCount: params.length,
			error: error?.message || String(error),
			code: error?.code,
			detail: error?.detail,
			stack: error?.stack,
			service: 'trainer-auth-service',
		});
		throw error;
	}
}

export async function createTrainer(
	data: {
		phone?: string | null;
		email?: string | null;
		username?: string | null;
		passwordHash?: string | null;
		googleId?: string | null;
		authProvider?: string | null;
	},
	client?: PoolClient
): Promise<TrainerRecord> {
	const result = await query<TrainerRecord>(
		`
			INSERT INTO trainers (phone, email, username, password_hash, google_id, auth_provider)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING ${trainerColumns}
		`,
		[
			data.phone || null,
			data.email ? data.email.toLowerCase() : null,
			data.username ? data.username.toLowerCase() : null,
			data.passwordHash || null,
			data.googleId || null,
			data.authProvider || null,
		],
		client
	);
	if (!result.rows[0]) {
		throw new Error('Failed to create trainer record');
	}
	return result.rows[0];
}

export async function updateTrainerAccount(
	id: string,
	updates: Partial<Pick<TrainerRecord, 'email' | 'phone' | 'isEmailVerified' | 'isPhoneVerified' | 'lastLoginAt' | 'authProvider'>>,
	client?: PoolClient
): Promise<TrainerRecord | null> {
	const fields: string[] = [];
	const params: any[] = [];
	let idx = 1;

	if (updates.email !== undefined) {
		fields.push(`email = $${idx++}`);
		params.push(updates.email ? updates.email.toLowerCase() : null);
	}
	if (updates.phone !== undefined) {
		fields.push(`phone = $${idx++}`);
		params.push(updates.phone || null);
	}
	if (typeof updates.isEmailVerified === 'boolean') {
		fields.push(`is_email_verified = $${idx++}`);
		params.push(updates.isEmailVerified);
	}
	if (typeof updates.isPhoneVerified === 'boolean') {
		fields.push(`is_phone_verified = $${idx++}`);
		params.push(updates.isPhoneVerified);
	}
	if (updates.lastLoginAt) {
		fields.push(`last_login_at = $${idx++}`);
		params.push(updates.lastLoginAt);
	}
	if (updates.authProvider !== undefined) {
		fields.push(`auth_provider = $${idx++}`);
		params.push(updates.authProvider ?? null);
	}

	if (!fields.length) {
		return findTrainerById(id, client);
	}

	fields.push(`updated_at = NOW()`);
	params.push(id);

	const result = await query<TrainerRecord>(
		`
			UPDATE trainers
			SET ${fields.join(', ')}
			WHERE id = $${idx}
			RETURNING ${trainerColumns}
		`,
		params,
		client
	);
	return result.rows[0] || null;
}

export async function updateTrainerVerification(
	id: string,
	updates: Partial<Pick<TrainerRecord, 'isEmailVerified' | 'isPhoneVerified' | 'lastLoginAt'>>,
	client?: PoolClient
): Promise<TrainerRecord | null> {
	return updateTrainerAccount(id, updates, client);
}

export async function updateTrainerApprovalStatus(
	id: string,
	approvalStatus: 'pending' | 'approved' | 'rejected',
	client?: PoolClient
): Promise<TrainerRecord | null> {
	const result = await query<TrainerRecord>(
		`
			UPDATE trainers
			SET approval_status = $1, updated_at = NOW()
			WHERE id = $2
			RETURNING ${trainerColumns}
		`,
		[approvalStatus, id],
		client
	);
	return result.rows[0] || null;
}

export async function updateTrainerPassword(
	id: string,
	passwordHash: string,
	client?: PoolClient
): Promise<void> {
	await query(
		`
			UPDATE trainers
			SET password_hash = $1,
				updated_at = NOW()
			WHERE id = $2
		`,
		[passwordHash, id],
		client
	);
}

export async function findTrainersByApprovalStatus(
	approvalStatus: 'pending' | 'approved' | 'rejected',
	limit?: number,
	offset?: number,
	client?: PoolClient
): Promise<TrainerRecord[]> {
	let queryText = `
		SELECT ${trainerColumns}
		FROM trainers
		WHERE approval_status = $1
		ORDER BY created_at DESC
	`;
	const params: any[] = [approvalStatus];
	let idx = 2;

	if (limit) {
		queryText += ` LIMIT $${idx++}`;
		params.push(limit);
	}
	if (offset) {
		queryText += ` OFFSET $${idx++}`;
		params.push(offset);
	}

	const result = await query<TrainerRecord>(queryText, params, client);
	return result.rows;
}

export async function findTrainerByEmail(email: string, client?: PoolClient): Promise<TrainerRecord | null> {
	const result = await query<TrainerRecord>(
		`SELECT ${trainerColumns} FROM trainers WHERE email = $1`,
		[email.toLowerCase()],
		client
	);
	return result.rows[0] || null;
}

export async function findTrainerByPhone(phone: string, client?: PoolClient): Promise<TrainerRecord | null> {
	const result = await query<TrainerRecord>(
		`SELECT ${trainerColumns} FROM trainers WHERE phone = $1`,
		[phone],
		client
	);
	return result.rows[0] || null;
}

export async function findTrainerByUsername(username: string, client?: PoolClient): Promise<TrainerRecord | null> {
	const result = await query<TrainerRecord>(
		`SELECT ${trainerColumns} FROM trainers WHERE username = $1`,
		[username.toLowerCase()],
		client
	);
	return result.rows[0] || null;
}

export async function findTrainerByGoogleId(googleId: string, client?: PoolClient): Promise<TrainerRecord | null> {
	const result = await query<TrainerRecord>(
		`SELECT ${trainerColumns} FROM trainers WHERE google_id = $1`,
		[googleId],
		client
	);
	return result.rows[0] || null;
}

export async function findTrainerById(id: string, client?: PoolClient): Promise<TrainerRecord | null> {
	const result = await query<TrainerRecord>(
		`SELECT ${trainerColumns} FROM trainers WHERE id = $1`,
		[id],
		client
	);
	return result.rows[0] || null;
}

export async function upsertTrainerProfile(
	trainerId: string,
	profile: Partial<Omit<TrainerProfileRecord, 'id' | 'trainerId' | 'createdAt' | 'updatedAt'>> & {
		bio?: string | null;
		specialties?: string[] | string | null;
		yearsOfExperience?: number | null;
		hourlyRate?: number | null;
		availability?: any;
		preferredLanguages?: string[] | null;
		certifications?: string[] | null;
	},
	client?: PoolClient
): Promise<TrainerProfileRecord> {
	// Extract data from profile and extra
	const extra = profile.extra || {};
	const bio = profile.bio || extra.bio || null;
	const specialties = profile.specialties || extra.specialties || null;
	const specialtiesArray = Array.isArray(specialties) 
		? specialties 
		: (typeof specialties === 'string' ? specialties.split(',').map(s => s.trim()) : null);
	const yearsOfExperience = profile.yearsOfExperience || profile.experienceYears || extra.experienceYears || null;
	const hourlyRate = profile.hourlyRate || extra.hourlyRate || null;
	const availability = profile.availability || extra.availability || null;
	const preferredLanguages = profile.preferredLanguages || extra.languages || null;
	const certifications = profile.certifications || extra.certifications || null;

	// Build dynamic query based on which columns exist
	// Use a safer approach that handles missing columns gracefully
	const result = await query<TrainerProfileRecord>(
		`
			INSERT INTO trainer_profiles (
				trainer_id, full_name, age, gender, address, expertise, experience_years, extra
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			ON CONFLICT (trainer_id) DO UPDATE
			SET
				full_name = COALESCE(EXCLUDED.full_name, trainer_profiles.full_name),
				age = COALESCE(EXCLUDED.age, trainer_profiles.age),
				gender = COALESCE(EXCLUDED.gender, trainer_profiles.gender),
				address = COALESCE(EXCLUDED.address, trainer_profiles.address),
				expertise = COALESCE(EXCLUDED.expertise, trainer_profiles.expertise),
				experience_years = COALESCE(EXCLUDED.experience_years, trainer_profiles.experience_years),
				extra = COALESCE(EXCLUDED.extra, trainer_profiles.extra),
				updated_at = NOW()
			RETURNING ${profileColumns}
		`,
		[
			trainerId,
			profile.fullName || null,
			typeof profile.age === 'number' ? profile.age : null,
			profile.gender || null,
			profile.address || null,
			profile.expertise || null,
			typeof profile.experienceYears === 'number' ? profile.experienceYears : null,
			profile.extra || null,
		],
		client
	);
	
	// Update additional columns if they exist (using separate UPDATE to handle missing columns gracefully)
	if (bio || specialtiesArray || yearsOfExperience !== null || hourlyRate !== null || availability || preferredLanguages || certifications) {
		try {
			await query(
				`
					UPDATE trainer_profiles
					SET
						bio = COALESCE($2, bio),
						specialties = COALESCE($3, specialties),
						years_of_experience = COALESCE($4, years_of_experience),
						hourly_rate = COALESCE($5, hourly_rate),
						availability = COALESCE($6::jsonb, availability),
						preferred_languages = COALESCE($7, preferred_languages),
						certifications = COALESCE($8, certifications),
						updated_at = NOW()
					WHERE trainer_id = $1
				`,
				[
					trainerId,
					bio,
					specialtiesArray,
					yearsOfExperience,
					hourlyRate,
					availability ? JSON.stringify(availability) : null,
					preferredLanguages,
					certifications,
				],
				client
			);
		} catch (err: any) {
			// If columns don't exist, that's okay - they'll be added by migration
			// Log but don't fail the operation
			logger.warn('Some columns may not exist yet in upsertTrainerProfile', {
				error: err.message,
				service: 'trainer-auth-service',
			});
		}
	}
	if (!result.rows[0]) {
		throw new Error('Failed to upsert trainer profile');
	}
	return result.rows[0];
}

export async function getTrainerProfile(
	trainerId: string,
	client?: PoolClient
): Promise<TrainerProfileRecord | null> {
	try {
	const result = await query<TrainerProfileRecord & { approval_status?: string }>(
		`
			SELECT 
					${profileColumnsWithPrefix},
				t.approval_status
			FROM trainer_profiles tp
			LEFT JOIN trainers t ON t.id = tp.trainer_id
			WHERE tp.trainer_id = $1
		`,
		[trainerId],
		client
	);
	if (!result.rows[0]) {
		return null;
	}
	const row = result.rows[0];
		// Convert specialties array from database to proper format
		const specialties = row.specialties 
			? (Array.isArray(row.specialties) ? row.specialties : [row.specialties])
			: null;
		
		const profile: TrainerProfileRecord = {
			id: row.id,
			trainerId: row.trainerId,
			fullName: row.fullName,
			age: row.age,
			gender: row.gender,
			address: row.address,
			expertise: row.expertise,
			specialties: specialties,
			experienceYears: row.experienceYears,
			extra: row.extra,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			...(row.approval_status && { approvalStatus: row.approval_status as 'pending' | 'approved' | 'rejected' }),
		};
		return profile;
	} catch (error: any) {
		logger.error('Database error in getTrainerProfile', {
			trainerId,
			error: error?.message || String(error),
			code: error?.code,
			detail: error?.detail,
			hint: error?.hint,
			service: 'trainer-auth-service',
		});
		// Re-throw with more context
		const dbError = new Error(
			`Failed to fetch trainer profile: ${error?.message || 'Unknown database error'}`
		);
		(dbError as any).code = error?.code;
		(dbError as any).originalError = error;
		throw dbError;
	}
}

export type OTPRecord = {
	id: string;
	codeHash: string;
	expiresAt: Date;
	attemptCount: number;
	createdAt: Date;
	phone?: string;
	trainerId?: string;
};

export async function upsertPhoneOtp(
	phone: string,
	codeHash: string,
	expiresAt: Date,
	client?: PoolClient
): Promise<void> {
	await query(
		`
			INSERT INTO trainer_phone_otps (phone, code_hash, expires_at, attempt_count)
			VALUES ($1, $2, $3, 0)
			ON CONFLICT (phone) DO UPDATE
			SET
				code_hash = EXCLUDED.code_hash,
				expires_at = EXCLUDED.expires_at,
				attempt_count = 0,
				created_at = NOW()
		`,
		[phone, codeHash, expiresAt],
		client
	);
}

export async function getPhoneOtp(phone: string, client?: PoolClient): Promise<OTPRecord | null> {
	const result = await query<OTPRecord & { phone: string }>(
		`
			SELECT id, phone, code_hash as "codeHash", expires_at as "expiresAt", attempt_count as "attemptCount", created_at as "createdAt"
			FROM trainer_phone_otps
			WHERE phone = $1
		`,
		[phone],
		client
	);
	return result.rows[0] || null;
}

export async function deletePhoneOtp(phone: string, client?: PoolClient): Promise<void> {
	await query(`DELETE FROM trainer_phone_otps WHERE phone = $1`, [phone], client);
}

export async function incrementPhoneOtpAttempts(phone: string, client?: PoolClient): Promise<void> {
	await query(
		`
			UPDATE trainer_phone_otps
			SET attempt_count = attempt_count + 1
			WHERE phone = $1
		`,
		[phone],
		client
	);
}

export async function upsertEmailOtp(
	trainerId: string,
	codeHash: string,
	expiresAt: Date,
	client?: PoolClient
): Promise<void> {
	await query(
		`
			INSERT INTO trainer_email_otps (trainer_id, code_hash, expires_at, attempt_count)
			VALUES ($1, $2, $3, 0)
			ON CONFLICT (trainer_id) DO UPDATE
			SET
				code_hash = EXCLUDED.code_hash,
				expires_at = EXCLUDED.expires_at,
				attempt_count = 0,
				created_at = NOW()
		`,
		[trainerId, codeHash, expiresAt],
		client
	);
}

export async function getEmailOtp(trainerId: string, client?: PoolClient): Promise<OTPRecord | null> {
	const result = await query<OTPRecord>(
		`
			SELECT id, code_hash as "codeHash", expires_at as "expiresAt", attempt_count as "attemptCount", created_at as "createdAt"
			FROM trainer_email_otps
			WHERE trainer_id = $1
		`,
		[trainerId],
		client
	);
	const record = result.rows[0];
	return record
		? {
				...record,
				trainerId,
		  }
		: null;
}

export async function deleteEmailOtp(trainerId: string, client?: PoolClient): Promise<void> {
	await query(`DELETE FROM trainer_email_otps WHERE trainer_id = $1`, [trainerId], client);
}

export async function incrementEmailOtpAttempts(trainerId: string, client?: PoolClient): Promise<void> {
	await query(
		`
			UPDATE trainer_email_otps
			SET attempt_count = attempt_count + 1
			WHERE trainer_id = $1
		`,
		[trainerId],
		client
	);
}

export type RefreshTokenRecord = {
	id: string;
	trainerId: string;
	tokenHash: string;
	expiresAt: Date;
	userAgent: string | null;
	ipAddress: string | null;
	revokedAt: Date | null;
	createdAt: Date;
};

export async function storeRefreshToken(
	trainerId: string,
	tokenHash: string,
	expiresAt: Date,
	meta: { userAgent?: string | null; ipAddress?: string | null },
	client?: PoolClient
): Promise<RefreshTokenRecord> {
	// First, cleanup old expired/revoked tokens for this user (non-blocking)
	// This prevents accumulation of stale tokens
	void query(
		`
			DELETE FROM trainer_refresh_tokens
			WHERE trainer_id = $1
				AND (
					expires_at < NOW() - INTERVAL '1 day'
					OR revoked_at IS NOT NULL
				)
		`,
		[trainerId],
		client
	).catch(() => {
		// Silently fail cleanup - not critical for token storage
	});

	// Limit active tokens per user (keep only the most recent 10)
	// This prevents unbounded growth
	const maxTokens = 10;
	void query(
		`
			WITH active_tokens AS (
				SELECT id
				FROM trainer_refresh_tokens
				WHERE trainer_id = $1
					AND revoked_at IS NULL
					AND expires_at > NOW()
				ORDER BY created_at DESC
				OFFSET $2
			)
			DELETE FROM trainer_refresh_tokens
			WHERE id IN (SELECT id FROM active_tokens)
		`,
		[trainerId, maxTokens],
		client
	).catch(() => {
		// Silently fail cleanup - not critical for token storage
	});

	const result = await query<RefreshTokenRecord>(
		`
			INSERT INTO trainer_refresh_tokens (trainer_id, token_hash, expires_at, user_agent, ip_address)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING
				id,
				trainer_id as "trainerId",
				token_hash as "tokenHash",
				expires_at as "expiresAt",
				user_agent as "userAgent",
				ip_address as "ipAddress",
				revoked_at as "revokedAt",
				created_at as "createdAt"
		`,
		[trainerId, tokenHash, expiresAt, meta.userAgent || null, meta.ipAddress || null],
		client
	);
		if (!result.rows[0]) {
			throw new Error('Failed to store refresh token');
		}
	return result.rows[0];
}

export async function revokeRefreshToken(tokenHash: string, client?: PoolClient): Promise<void> {
	await query(
		`
			UPDATE trainer_refresh_tokens
			SET revoked_at = NOW()
			WHERE token_hash = $1
		`,
		[tokenHash],
		client
	);
}

export async function revokeAllRefreshTokens(trainerId: string, client?: PoolClient): Promise<void> {
	await query(
		`
			UPDATE trainer_refresh_tokens
			SET revoked_at = NOW()
			WHERE trainer_id = $1 AND revoked_at IS NULL
		`,
		[trainerId],
		client
	);
}

export async function findRefreshToken(tokenHash: string, client?: PoolClient): Promise<RefreshTokenRecord | null> {
	const result = await query<RefreshTokenRecord>(
		`
			SELECT
				id,
				trainer_id as "trainerId",
				token_hash as "tokenHash",
				expires_at as "expiresAt",
				user_agent as "userAgent",
				ip_address as "ipAddress",
				revoked_at as "revokedAt",
				created_at as "createdAt"
			FROM trainer_refresh_tokens
			WHERE token_hash = $1
		`,
		[tokenHash],
		client
	);
	return result.rows[0] || null;
}

/**
 * Find refresh token with row-level lock to prevent concurrent refresh attempts
 * This ensures only one refresh can happen per token at a time
 */
export async function findRefreshTokenWithLock(tokenHash: string, client: PoolClient): Promise<RefreshTokenRecord | null> {
	const result = await query<RefreshTokenRecord>(
		`
			SELECT
				id,
				trainer_id as "trainerId",
				token_hash as "tokenHash",
				expires_at as "expiresAt",
				user_agent as "userAgent",
				ip_address as "ipAddress",
				revoked_at as "revokedAt",
				created_at as "createdAt"
			FROM trainer_refresh_tokens
			WHERE token_hash = $1
			FOR UPDATE
		`,
		[tokenHash],
		client
	);
	return result.rows[0] || null;
}

/**
 * Cleanup expired and revoked refresh tokens
 * @param daysToKeepRevoked - Keep revoked tokens for this many days (for audit purposes)
 * @param client - Optional database client for transaction
 * @returns Number of tokens deleted
 */
export async function cleanupExpiredRefreshTokens(
	daysToKeepRevoked = 7,
	client?: PoolClient
): Promise<number> {
	const result = await query<{ deleted: number }>(
		`
			WITH deleted AS (
				DELETE FROM trainer_refresh_tokens
				WHERE 
					-- Delete expired tokens (expired more than 1 day ago)
					(expires_at < NOW() - INTERVAL '1 day')
					OR
					-- Delete revoked tokens older than X days
					(revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '1 day' * $1)
				RETURNING id
			)
			SELECT COUNT(*)::int AS deleted
			FROM deleted
		`,
		[daysToKeepRevoked],
		client
	);
	return result.rows[0]?.deleted ?? 0;
}

/**
 * Limit the number of active refresh tokens per user
 * Deletes oldest tokens if user has more than maxTokens
 * @param trainerId - Trainer ID
 * @param maxTokens - Maximum number of active tokens per user (default: 10)
 * @param client - Optional database client for transaction
 * @returns Number of tokens deleted
 */
export async function limitTokensPerUser(
	trainerId: string,
	maxTokens = 10,
	client?: PoolClient
): Promise<number> {
	const result = await query<{ deleted: number }>(
		`
			WITH active_tokens AS (
				SELECT id
				FROM trainer_refresh_tokens
				WHERE trainer_id = $1
					AND revoked_at IS NULL
					AND expires_at > NOW()
				ORDER BY created_at DESC
				OFFSET $2
			)
			DELETE FROM trainer_refresh_tokens
			WHERE id IN (SELECT id FROM active_tokens)
			RETURNING id
		`,
		[trainerId, maxTokens],
		client
	);
	return result.rows.length;
}

export async function linkGoogleAccount(
	id: string,
	googleId: string,
	client?: PoolClient
): Promise<TrainerRecord | null> {
	const result = await query<TrainerRecord>(
		`
			UPDATE trainers
			SET google_id = $1,
				is_email_verified = true,
				updated_at = NOW()
			WHERE id = $2
			RETURNING ${trainerColumns}
		`,
		[googleId, id],
		client
	);
	return result.rows[0] || null;
}

