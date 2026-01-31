import { PoolClient, QueryResult } from 'pg';
import { getPool } from '../config/database';

export type StudentRecord = {
	id: string;
	phone: string | null;
	email: string | null;
	username: string | null;
	passwordHash: string | null;
	isEmailVerified: boolean;
	isPhoneVerified: boolean;
	googleId: string | null;
	authProvider: string | null;
	lastLoginAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

export type StudentProfileRecord = {
	id: string;
	studentId: string;
	fullName: string | null;
	age: number | null;
	gender: string | null;
	address: string | null;
	extra: any;
	createdAt: Date;
	updatedAt: Date;
};

const studentColumns = `
	id,
	phone,
	email,
	username,
	password_hash as "passwordHash",
	is_email_verified as "isEmailVerified",
	is_phone_verified as "isPhoneVerified",
	google_id as "googleId",
	auth_provider as "authProvider",
	last_login_at as "lastLoginAt",
	created_at as "createdAt",
	updated_at as "updatedAt"
`;

const profileColumns = `
	id,
	student_id as "studentId",
	full_name as "fullName",
	age,
	gender,
	address,
	extra,
	created_at as "createdAt",
	updated_at as "updatedAt"
`;

async function query<T extends Record<string, any> = Record<string, any>>(text: string, params: any[] = [], client?: PoolClient): Promise<QueryResult<T>> {
	if (client) {
		return client.query<T>(text, params);
	}
	return getPool().query<T>(text, params);
}

export async function createStudent(
	data: {
		phone?: string | null;
		email?: string | null;
		username?: string | null;
		passwordHash?: string | null;
		googleId?: string | null;
		authProvider?: string | null;
	},
	client?: PoolClient
): Promise<StudentRecord> {
	const result = await query<StudentRecord>(
		`
			INSERT INTO students (phone, email, username, password_hash, google_id, auth_provider)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING ${studentColumns}
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
		throw new Error('Failed to create student');
	}
	return result.rows[0];
}

export async function updateStudentVerification(
	id: string,
	updates: Partial<Pick<StudentRecord, 'isEmailVerified' | 'isPhoneVerified' | 'lastLoginAt'>>,
	client?: PoolClient
): Promise<StudentRecord | null> {
	const fields: string[] = [];
	const params: any[] = [];
	let idx = 1;

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

	if (!fields.length) {
		return findStudentById(id, client);
	}

	fields.push(`updated_at = NOW()`);
	params.push(id);

	const result = await query<StudentRecord>(
		`
			UPDATE students
			SET ${fields.join(', ')}
			WHERE id = $${idx}
			RETURNING ${studentColumns}
		`,
		params,
		client
	);
	return result.rows[0] || null;
}

export async function updateStudentPassword(
	id: string,
	passwordHash: string,
	client?: PoolClient
): Promise<void> {
	await query(
		`
			UPDATE students
			SET password_hash = $1,
				updated_at = NOW()
			WHERE id = $2
		`,
		[passwordHash, id],
		client
	);
}

export async function updateStudentIdentity(
	id: string,
	updates: {
		username?: string | null;
		phone?: string | null;
		authProvider?: string | null;
	},
	client?: PoolClient
): Promise<StudentRecord | null> {
	const fields: string[] = [];
	const params: any[] = [];
	let idx = 1;

	if (Object.prototype.hasOwnProperty.call(updates, 'username')) {
		fields.push(`username = $${idx++}`);
		params.push(
			typeof updates.username === 'string' && updates.username !== null
				? updates.username.toLowerCase()
				: null
		);
	}

	if (Object.prototype.hasOwnProperty.call(updates, 'phone')) {
		fields.push(`phone = $${idx++}`);
		params.push(updates.phone ?? null);
	}

	if (Object.prototype.hasOwnProperty.call(updates, 'authProvider')) {
		fields.push(`auth_provider = $${idx++}`);
		params.push(updates.authProvider ?? null);
	}

	if (!fields.length) {
		return findStudentById(id, client);
	}

	fields.push(`updated_at = NOW()`);
	params.push(id);

	const result = await query<StudentRecord>(
		`
			UPDATE students
			SET ${fields.join(', ')}
			WHERE id = $${idx}
			RETURNING ${studentColumns}
		`,
		params,
		client
	);

	return result.rows[0] || null;
}

export async function linkGoogleAccount(
	id: string,
	googleId: string,
	client?: PoolClient
): Promise<StudentRecord | null> {
	const result = await query<StudentRecord>(
		`
			UPDATE students
			SET google_id = $1,
				is_email_verified = true,
				updated_at = NOW()
			WHERE id = $2
			RETURNING ${studentColumns}
		`,
		[googleId, id],
		client
	);
	return result.rows[0] || null;
}

export async function findStudentByEmail(email: string, client?: PoolClient): Promise<StudentRecord | null> {
	const result = await query<StudentRecord>(
		`SELECT ${studentColumns} FROM students WHERE email = $1`,
		[email.toLowerCase()],
		client
	);
	return result.rows[0] || null;
}

export async function findStudentByPhone(phone: string, client?: PoolClient): Promise<StudentRecord | null> {
	const result = await query<StudentRecord>(
		`SELECT ${studentColumns} FROM students WHERE phone = $1`,
		[phone],
		client
	);
	return result.rows[0] || null;
}

export async function findStudentByUsername(username: string, client?: PoolClient): Promise<StudentRecord | null> {
	const result = await query<StudentRecord>(
		`SELECT ${studentColumns} FROM students WHERE username = $1`,
		[username.toLowerCase()],
		client
	);
	return result.rows[0] || null;
}

export async function findStudentByGoogleId(googleId: string, client?: PoolClient): Promise<StudentRecord | null> {
	const result = await query<StudentRecord>(
		`SELECT ${studentColumns} FROM students WHERE google_id = $1`,
		[googleId],
		client
	);
	return result.rows[0] || null;
}

export async function findStudentById(id: string, client?: PoolClient): Promise<StudentRecord | null> {
	const result = await query<StudentRecord>(
		`SELECT ${studentColumns} FROM students WHERE id = $1`,
		[id],
		client
	);
	return result.rows[0] || null;
}

/**
 * DEPRECATED for profile updates. student-service is the single source of truth for student_profiles.
 * Auth must NOT write latitude/longitude; this function is kept only for legacy/bootstrap paths
 * that may create a minimal profile row. Do not use for ongoing profile edits.
 */
export async function upsertStudentProfile(
	studentId: string,
	profile: Partial<Omit<StudentProfileRecord, 'id' | 'studentId' | 'createdAt' | 'updatedAt'>>,
	client?: PoolClient
): Promise<StudentProfileRecord> {
	// Guarantee: auth must never write latitude/longitude (student-service owns those fields).
	if ('latitude' in profile && profile.latitude !== undefined) {
		throw new Error('student-auth must not write latitude; student-service owns profile');
	}
	if ('longitude' in profile && profile.longitude !== undefined) {
		throw new Error('student-auth must not write longitude; student-service owns profile');
	}
	const result = await query<StudentProfileRecord>(
		`
			INSERT INTO student_profiles (student_id, full_name, age, gender, address, extra)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (student_id) DO UPDATE
			SET
				full_name = EXCLUDED.full_name,
				age = EXCLUDED.age,
				gender = EXCLUDED.gender,
				address = EXCLUDED.address,
				extra = EXCLUDED.extra,
				updated_at = NOW()
			RETURNING ${profileColumns}
		`,
		[
			studentId,
			profile.fullName || null,
			typeof profile.age === 'number' ? profile.age : null,
			profile.gender || null,
			profile.address || null,
			profile.extra || null,
		],
		client
	);
	if (!result.rows[0]) {
		throw new Error('Failed to create student profile');
	}
	return result.rows[0];
}

export async function getStudentProfile(studentId: string, client?: PoolClient): Promise<StudentProfileRecord | null> {
	const result = await query<StudentProfileRecord>(
		`
			SELECT ${profileColumns}
			FROM student_profiles
			WHERE student_id = $1
		`,
		[studentId],
		client
	);
	return result.rows[0] || null;
}

export type OTPRecord = {
	id: string;
	phone?: string;
	studentId?: string;
	codeHash: string;
	expiresAt: Date;
	attemptCount: number;
	createdAt: Date;
};

export async function upsertPhoneOtp(
	phone: string,
	codeHash: string,
	expiresAt: Date,
	client?: PoolClient
): Promise<void> {
	await query(
		`
			INSERT INTO student_phone_otps (phone, code_hash, expires_at, attempt_count)
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
			FROM student_phone_otps
			WHERE phone = $1
		`,
		[phone],
		client
	);
	return result.rows[0] || null;
}

export async function deletePhoneOtp(phone: string, client?: PoolClient): Promise<void> {
	await query(`DELETE FROM student_phone_otps WHERE phone = $1`, [phone], client);
}

export async function incrementPhoneOtpAttempts(phone: string, client?: PoolClient): Promise<void> {
	await query(
		`
			UPDATE student_phone_otps
			SET attempt_count = attempt_count + 1
			WHERE phone = $1
		`,
		[phone],
		client
	);
}

export async function upsertEmailOtp(
	studentId: string,
	codeHash: string,
	expiresAt: Date,
	client?: PoolClient
): Promise<void> {
	await query(
		`
			INSERT INTO student_email_otps (student_id, code_hash, expires_at, attempt_count)
			VALUES ($1, $2, $3, 0)
			ON CONFLICT (student_id) DO UPDATE
			SET
				code_hash = EXCLUDED.code_hash,
				expires_at = EXCLUDED.expires_at,
				attempt_count = 0,
				created_at = NOW()
		`,
		[studentId, codeHash, expiresAt],
		client
	);
}

export async function getEmailOtp(studentId: string, client?: PoolClient): Promise<OTPRecord | null> {
	const result = await query<OTPRecord & { student_id: string }>(
		`
			SELECT id, code_hash as "codeHash", expires_at as "expiresAt", attempt_count as "attemptCount", created_at as "createdAt"
			FROM student_email_otps
			WHERE student_id = $1
		`,
		[studentId],
		client
	);
	const record = result.rows[0];
	return record
		? {
				...record,
				studentId,
		  }
		: null;
}

export async function deleteEmailOtp(studentId: string, client?: PoolClient): Promise<void> {
	await query(`DELETE FROM student_email_otps WHERE student_id = $1`, [studentId], client);
}

export async function incrementEmailOtpAttempts(studentId: string, client?: PoolClient): Promise<void> {
	await query(
		`
			UPDATE student_email_otps
			SET attempt_count = attempt_count + 1
			WHERE student_id = $1
		`,
		[studentId],
		client
	);
}

export type RefreshTokenRecord = {
	id: string;
	studentId: string;
	tokenHash: string;
	expiresAt: Date;
	userAgent: string | null;
	ipAddress: string | null;
	revokedAt: Date | null;
	createdAt: Date;
};

export async function storeRefreshToken(
	studentId: string,
	tokenHash: string,
	expiresAt: Date,
	meta: { userAgent?: string | null; ipAddress?: string | null },
	client?: PoolClient
): Promise<RefreshTokenRecord> {
	// First, cleanup old expired/revoked tokens for this user (non-blocking)
	// This prevents accumulation of stale tokens
	void query(
		`
			DELETE FROM student_refresh_tokens
			WHERE student_id = $1
				AND (
					expires_at < NOW() - INTERVAL '1 day'
					OR revoked_at IS NOT NULL
				)
		`,
		[studentId],
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
				FROM student_refresh_tokens
				WHERE student_id = $1
					AND revoked_at IS NULL
					AND expires_at > NOW()
				ORDER BY created_at DESC
				OFFSET $2
			)
			DELETE FROM student_refresh_tokens
			WHERE id IN (SELECT id FROM active_tokens)
		`,
		[studentId, maxTokens],
		client
	).catch(() => {
		// Silently fail cleanup - not critical for token storage
	});

	const result = await query<RefreshTokenRecord>(
		`
			INSERT INTO student_refresh_tokens (student_id, token_hash, expires_at, user_agent, ip_address)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (token_hash) DO UPDATE SET
				expires_at = EXCLUDED.expires_at,
				user_agent = EXCLUDED.user_agent,
				ip_address = EXCLUDED.ip_address,
				revoked_at = NULL
			RETURNING
				id,
				student_id as "studentId",
				token_hash as "tokenHash",
				expires_at as "expiresAt",
				user_agent as "userAgent",
				ip_address as "ipAddress",
				revoked_at as "revokedAt",
				created_at as "createdAt"
		`,
		[studentId, tokenHash, expiresAt, meta.userAgent || null, meta.ipAddress || null],
		client
	);
	if (!result.rows[0]) {
		throw new Error('Failed to create refresh token');
	}
	return result.rows[0];
}

export async function revokeRefreshToken(tokenHash: string, client?: PoolClient): Promise<void> {
	await query(
		`
			UPDATE student_refresh_tokens
			SET revoked_at = NOW()
			WHERE token_hash = $1
		`,
		[tokenHash],
		client
	);
}

export async function revokeAllRefreshTokens(studentId: string, client?: PoolClient): Promise<void> {
	await query(
		`
			UPDATE student_refresh_tokens
			SET revoked_at = NOW()
			WHERE student_id = $1 AND revoked_at IS NULL
		`,
		[studentId],
		client
	);
}

export async function deleteStaleUnverifiedStudents(
	cutoff: Date,
	batchSize = 500,
	client?: PoolClient
): Promise<number> {
	const result = await query<{ deleted: number }>(
		`
			WITH candidates AS (
				SELECT id
				FROM students
				WHERE
					is_email_verified = false
					AND is_phone_verified = false
					AND created_at < $1
				ORDER BY created_at ASC
				LIMIT $2
			),
			deleted AS (
				DELETE FROM students
				WHERE id IN (SELECT id FROM candidates)
				RETURNING id
			)
			SELECT COUNT(*)::int AS deleted
			FROM deleted
		`,
		[cutoff, batchSize],
		client
	);

	return result.rows[0]?.deleted ?? 0;
}

export async function findRefreshToken(tokenHash: string, client?: PoolClient): Promise<RefreshTokenRecord | null> {
	const result = await query<RefreshTokenRecord>(
		`
			SELECT
				id,
				student_id as "studentId",
				token_hash as "tokenHash",
				expires_at as "expiresAt",
				user_agent as "userAgent",
				ip_address as "ipAddress",
				revoked_at as "revokedAt",
				created_at as "createdAt"
			FROM student_refresh_tokens
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
				student_id as "studentId",
				token_hash as "tokenHash",
				expires_at as "expiresAt",
				user_agent as "userAgent",
				ip_address as "ipAddress",
				revoked_at as "revokedAt",
				created_at as "createdAt"
			FROM student_refresh_tokens
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
				DELETE FROM student_refresh_tokens
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
 * @param studentId - Student ID
 * @param maxTokens - Maximum number of active tokens per user (default: 10)
 * @param client - Optional database client for transaction
 * @returns Number of tokens deleted
 */
export async function limitTokensPerUser(
	studentId: string,
	maxTokens = 10,
	client?: PoolClient
): Promise<number> {
	const result = await query<{ deleted: number }>(
		`
			WITH active_tokens AS (
				SELECT id
				FROM student_refresh_tokens
				WHERE student_id = $1
					AND revoked_at IS NULL
					AND expires_at > NOW()
				ORDER BY created_at DESC
				OFFSET $2
			)
			DELETE FROM student_refresh_tokens
			WHERE id IN (SELECT id FROM active_tokens)
			RETURNING id
		`,
		[studentId, maxTokens],
		client
	);
	return result.rows.length;
}

