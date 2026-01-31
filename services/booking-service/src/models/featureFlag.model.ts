/**
 * Feature Flag Model
 * Manages feature flags (NO hardcoded dates)
 */

import type { Pool, PoolClient, QueryResult } from 'pg';

export interface FeatureFlag {
	id: string;
	flagKey: string;
	flagValue: boolean;
	description: string | null;
	enabledAt: Date | null;
	disabledAt: Date | null;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
}

export async function ensureFeatureFlagTable(poolOrClient: Pool | PoolClient): Promise<void> {
	const queryFn = (text: string, params?: any[]) => {
		return poolOrClient.query(text, params);
	};

	await queryFn(`
		CREATE TABLE IF NOT EXISTS feature_flags (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			flag_key TEXT UNIQUE NOT NULL,
			flag_value BOOLEAN NOT NULL DEFAULT false,
			description TEXT,
			enabled_at TIMESTAMPTZ,
			disabled_at TIMESTAMPTZ,
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`);

	await queryFn(`
		CREATE INDEX IF NOT EXISTS idx_feature_flags_key ON feature_flags(flag_key);
		CREATE INDEX IF NOT EXISTS idx_feature_flags_value ON feature_flags(flag_value);
	`);
}

export class FeatureFlagRepository {
	constructor(private readonly pool: Pool) {}

	async findByKey(flagKey: string): Promise<FeatureFlag | null> {
		const result = await this.pool.query<FeatureFlag>(
			`
				SELECT 
					id,
					flag_key AS "flagKey",
					flag_value AS "flagValue",
					description,
					enabled_at AS "enabledAt",
					disabled_at AS "disabledAt",
					metadata,
					created_at AS "createdAt",
					updated_at AS "updatedAt"
				FROM feature_flags
				WHERE flag_key = $1
			`,
			[flagKey]
		);

		if (!result.rows.length) {
			return null;
		}

		return this.mapRow(result.rows[0]);
	}

	async isEnabled(flagKey: string): Promise<boolean> {
		const flag = await this.findByKey(flagKey);
		return flag?.flagValue ?? false;
	}

	async enable(flagKey: string, metadata?: Record<string, unknown>): Promise<void> {
		await this.pool.query(
			`
				INSERT INTO feature_flags (flag_key, flag_value, enabled_at, metadata)
				VALUES ($1, true, NOW(), $2)
				ON CONFLICT (flag_key) 
				DO UPDATE SET 
					flag_value = true, 
					enabled_at = NOW(), 
					disabled_at = NULL,
					metadata = $2,
					updated_at = NOW()
			`,
			[flagKey, metadata ? JSON.stringify(metadata) : null]
		);
	}

	async disable(flagKey: string): Promise<void> {
		await this.pool.query(
			`
				UPDATE feature_flags 
				SET flag_value = false, disabled_at = NOW(), updated_at = NOW()
				WHERE flag_key = $1
			`,
			[flagKey]
		);
	}

	private mapRow(row: any): FeatureFlag {
		return {
			id: row.id,
			flagKey: row.flagKey,
			flagValue: row.flagValue,
			description: row.description,
			enabledAt: row.enabledAt,
			disabledAt: row.disabledAt,
			metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}
}

