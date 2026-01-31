import { Pool, PoolClient } from 'pg';
import { getPool, withTransaction } from '../config/database';

export type SafetyIncidentStatus = 'reported' | 'acknowledged' | 'investigating' | 'resolved' | 'closed' | 'cancelled';
export type SafetyIncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type SafetyIncidentType = 'emergency' | 'safety' | 'medical' | 'security' | 'other';

export type SafetyIncidentRecord = {
	id: string;
	userId: string;
	userRole: 'student' | 'trainer' | 'admin';
	type: SafetyIncidentType;
	description: string;
	location: {
		latitude: number;
		longitude: number;
		address?: string;
	};
	severity: SafetyIncidentSeverity;
	status: SafetyIncidentStatus;
	reportedAt: Date;
	acknowledgedAt: Date | null;
	resolvedAt: Date | null;
	resolvedBy: string | null;
	notes: string | null;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
};

export type CreateSafetyIncidentInput = {
	userId: string;
	userRole: 'student' | 'trainer' | 'admin';
	type: SafetyIncidentType;
	description: string;
	location: {
		latitude: number;
		longitude: number;
		address?: string;
	};
	severity: SafetyIncidentSeverity;
	metadata?: Record<string, unknown>;
};

export type UpdateSafetyIncidentInput = {
	status?: SafetyIncidentStatus;
	notes?: string;
	resolvedBy?: string;
};

export async function createSafetyIncident(
	input: CreateSafetyIncidentInput,
	client?: PoolClient
): Promise<SafetyIncidentRecord> {
	const pool = client || getPool();
	
	const result = await pool.query<SafetyIncidentRecord>(
		`
			INSERT INTO safety_incidents (
				id, user_id, user_role, type, description, location,
				severity, status, metadata, reported_at, created_at, updated_at
			)
			VALUES (
				gen_random_uuid(),
				$1, $2, $3, $4, $5::jsonb,
				$6, 'reported', $7::jsonb, NOW(), NOW(), NOW()
			)
			RETURNING
				id,
				user_id as "userId",
				user_role as "userRole",
				type,
				description,
				location::jsonb as location,
				severity,
				status,
				reported_at as "reportedAt",
				acknowledged_at as "acknowledgedAt",
				resolved_at as "resolvedAt",
				resolved_by as "resolvedBy",
				notes,
				metadata::jsonb as metadata,
				created_at as "createdAt",
				updated_at as "updatedAt"
		`,
		[
			input.userId,
			input.userRole,
			input.type,
			input.description,
			JSON.stringify(input.location),
			input.severity,
			JSON.stringify(input.metadata || {}),
		]
	);

	return mapRowToRecord(result.rows[0]);
}

export async function findSafetyIncidentById(
	id: string,
	client?: PoolClient
): Promise<SafetyIncidentRecord | null> {
	const pool = client || getPool();
	
	const result = await pool.query<SafetyIncidentRecord>(
		`
			SELECT
				id,
				user_id as "userId",
				user_role as "userRole",
				type,
				description,
				location::jsonb as location,
				severity,
				status,
				reported_at as "reportedAt",
				acknowledged_at as "acknowledgedAt",
				resolved_at as "resolvedAt",
				resolved_by as "resolvedBy",
				notes,
				metadata::jsonb as metadata,
				created_at as "createdAt",
				updated_at as "updatedAt"
			FROM safety_incidents
			WHERE id = $1
		`,
		[id]
	);

	if (result.rows.length === 0) {
		return null;
	}

	return mapRowToRecord(result.rows[0]);
}

export async function findSafetyIncidentsByUserId(
	userId: string,
	options?: {
		status?: SafetyIncidentStatus;
		page?: number;
		limit?: number;
	},
	client?: PoolClient
): Promise<{
	incidents: SafetyIncidentRecord[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}> {
	const pool = client || getPool();
	const page = options?.page || 1;
	const limit = options?.limit || 20;
	const offset = (page - 1) * limit;

	let query = `
		SELECT
			id,
			user_id as "userId",
			user_role as "userRole",
			type,
			description,
			location::jsonb as location,
			severity,
			status,
			reported_at as "reportedAt",
			acknowledged_at as "acknowledgedAt",
			resolved_at as "resolvedAt",
			resolved_by as "resolvedBy",
			notes,
			metadata::jsonb as metadata,
			created_at as "createdAt",
			updated_at as "updatedAt"
		FROM safety_incidents
		WHERE user_id = $1
	`;

	const params: unknown[] = [userId];
	let paramIndex = 2;

	if (options?.status) {
		query += ` AND status = $${paramIndex}`;
		params.push(options.status);
		paramIndex++;
	}

	query += ` ORDER BY reported_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
	params.push(limit, offset);

	const result = await pool.query<SafetyIncidentRecord>(query, params);

	// Get total count
	const countResult = await pool.query<{ count: string }>(
		`
			SELECT COUNT(*) as count
			FROM safety_incidents
			WHERE user_id = $1${options?.status ? ` AND status = $2` : ''}
		`,
		options?.status ? [userId, options.status] : [userId]
	);

	const total = parseInt(countResult.rows[0]?.count || '0', 10);
	const totalPages = Math.ceil(total / limit);

	return {
		incidents: result.rows.map(mapRowToRecord),
		total,
		page,
		limit,
		totalPages,
	};
}

export async function findSafetyIncidents(
	options?: {
		status?: SafetyIncidentStatus;
		type?: SafetyIncidentType;
		severity?: SafetyIncidentSeverity;
		userId?: string;
		userRole?: 'student' | 'trainer' | 'admin';
		page?: number;
		limit?: number;
	},
	client?: PoolClient
): Promise<{
	incidents: SafetyIncidentRecord[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}> {
	const pool = client || getPool();
	const page = options?.page || 1;
	const limit = options?.limit || 20;
	const offset = (page - 1) * limit;

	let query = `
		SELECT
			id,
			user_id as "userId",
			user_role as "userRole",
			type,
			description,
			location::jsonb as location,
			severity,
			status,
			reported_at as "reportedAt",
			acknowledged_at as "acknowledgedAt",
			resolved_at as "resolvedAt",
			resolved_by as "resolvedBy",
			notes,
			metadata::jsonb as metadata,
			created_at as "createdAt",
			updated_at as "updatedAt"
		FROM safety_incidents
		WHERE 1=1
	`;

	const params: unknown[] = [];
	let paramIndex = 1;

	if (options?.status) {
		query += ` AND status = $${paramIndex}`;
		params.push(options.status);
		paramIndex++;
	}

	if (options?.type) {
		query += ` AND type = $${paramIndex}`;
		params.push(options.type);
		paramIndex++;
	}

	if (options?.severity) {
		query += ` AND severity = $${paramIndex}`;
		params.push(options.severity);
		paramIndex++;
	}

	if (options?.userId) {
		query += ` AND user_id = $${paramIndex}`;
		params.push(options.userId);
		paramIndex++;
	}

	if (options?.userRole) {
		query += ` AND user_role = $${paramIndex}`;
		params.push(options.userRole);
		paramIndex++;
	}

	query += ` ORDER BY reported_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
	params.push(limit, offset);

	const result = await pool.query<SafetyIncidentRecord>(query, params);

	// Get total count
	let countQuery = `SELECT COUNT(*) as count FROM safety_incidents WHERE 1=1`;
	const countParams: unknown[] = [];
	let countParamIndex = 1;

	if (options?.status) {
		countQuery += ` AND status = $${countParamIndex}`;
		countParams.push(options.status);
		countParamIndex++;
	}

	if (options?.type) {
		countQuery += ` AND type = $${countParamIndex}`;
		countParams.push(options.type);
		countParamIndex++;
	}

	if (options?.severity) {
		countQuery += ` AND severity = $${countParamIndex}`;
		countParams.push(options.severity);
		countParamIndex++;
	}

	if (options?.userId) {
		countQuery += ` AND user_id = $${countParamIndex}`;
		countParams.push(options.userId);
		countParamIndex++;
	}

	if (options?.userRole) {
		countQuery += ` AND user_role = $${countParamIndex}`;
		countParams.push(options.userRole);
		countParamIndex++;
	}

	const countResult = await pool.query<{ count: string }>(countQuery, countParams);
	const total = parseInt(countResult.rows[0]?.count || '0', 10);
	const totalPages = Math.ceil(total / limit);

	return {
		incidents: result.rows.map(mapRowToRecord),
		total,
		page,
		limit,
		totalPages,
	};
}

export async function updateSafetyIncident(
	id: string,
	input: UpdateSafetyIncidentInput,
	client?: PoolClient
): Promise<SafetyIncidentRecord | null> {
	const pool = client || getPool();

	const updates: string[] = [];
	const params: unknown[] = [];
	let paramIndex = 1;

	if (input.status !== undefined) {
		updates.push(`status = $${paramIndex}`);
		params.push(input.status);
		paramIndex++;

		if (input.status === 'acknowledged' || input.status === 'investigating') {
			updates.push(`acknowledged_at = NOW()`);
		}

		if (input.status === 'resolved' || input.status === 'closed') {
			updates.push(`resolved_at = NOW()`);
			if (input.resolvedBy) {
				updates.push(`resolved_by = $${paramIndex}`);
				params.push(input.resolvedBy);
				paramIndex++;
			}
		}
	}

	if (input.notes !== undefined) {
		updates.push(`notes = $${paramIndex}`);
		params.push(input.notes);
		paramIndex++;
	}

	if (updates.length === 0) {
		return findSafetyIncidentById(id, client);
	}

	updates.push(`updated_at = NOW()`);
	params.push(id);

	const result = await pool.query<SafetyIncidentRecord>(
		`
			UPDATE safety_incidents
			SET ${updates.join(', ')}
			WHERE id = $${paramIndex}
			RETURNING
				id,
				user_id as "userId",
				user_role as "userRole",
				type,
				description,
				location::jsonb as location,
				severity,
				status,
				reported_at as "reportedAt",
				acknowledged_at as "acknowledgedAt",
				resolved_at as "resolvedAt",
				resolved_by as "resolvedBy",
				notes,
				metadata::jsonb as metadata,
				created_at as "createdAt",
				updated_at as "updatedAt"
		`,
		params
	);

	if (result.rows.length === 0) {
		return null;
	}

	return mapRowToRecord(result.rows[0]);
}

function mapRowToRecord(row: any): SafetyIncidentRecord {
	return {
		id: row.id,
		userId: row.userId,
		userRole: row.userRole,
		type: row.type,
		description: row.description,
		location: typeof row.location === 'string' ? JSON.parse(row.location) : row.location,
		severity: row.severity,
		status: row.status,
		reportedAt: row.reportedAt,
		acknowledgedAt: row.acknowledgedAt,
		resolvedAt: row.resolvedAt,
		resolvedBy: row.resolvedBy,
		notes: row.notes,
		metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

