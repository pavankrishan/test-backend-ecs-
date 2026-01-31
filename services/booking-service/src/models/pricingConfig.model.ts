/**
 * Pricing Configuration Model
 * Manages official and summer pricing by class type
 * 
 * IMPORTANT: Pricing is based on CLASS TYPE only, not on course.
 * All courses use the same pricing structure based on class type.
 * The pricing_config table has no course_id column - pricing is universal across all courses.
 */

import type { Pool, PoolClient, QueryResult } from 'pg';

export type PricingType = 'official' | 'summer';
export type ClassType = '1-on-1' | '1-on-2' | '1-on-3' | 'hybrid';

export interface PricingConfig {
	id: string;
	classType: ClassType;
	pricingType: PricingType;
	basePrice: number;
	gstPercentage: number;
	isActive: boolean;
	validFrom: Date | null;
	validUntil: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export async function ensurePricingConfigTable(poolOrClient: Pool | PoolClient): Promise<void> {
	const queryFn = (text: string, params?: any[]) => {
		return poolOrClient.query(text, params);
	};

	await queryFn(`
		CREATE TABLE IF NOT EXISTS pricing_config (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			class_type TEXT NOT NULL CHECK (class_type IN ('1-on-1', '1-on-2', '1-on-3', 'hybrid')),
			pricing_type TEXT NOT NULL CHECK (pricing_type IN ('official', 'summer')),
			base_price NUMERIC(10, 2) NOT NULL CHECK (base_price > 0),
			gst_percentage NUMERIC(5, 2) NOT NULL DEFAULT 18.00,
			is_active BOOLEAN NOT NULL DEFAULT true,
			valid_from DATE,
			valid_until DATE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE(class_type, pricing_type, valid_from, valid_until)
		);
	`);

	await queryFn(`
		CREATE INDEX IF NOT EXISTS idx_pricing_config_class_type ON pricing_config(class_type);
		CREATE INDEX IF NOT EXISTS idx_pricing_config_type ON pricing_config(pricing_type);
		CREATE INDEX IF NOT EXISTS idx_pricing_config_active ON pricing_config(is_active) WHERE is_active = true;
	`);
}

export class PricingConfigRepository {
	constructor(private readonly pool: Pool) {}

	async getPricing(
		classType: ClassType,
		pricingType: PricingType,
		date: Date = new Date()
	): Promise<PricingConfig | null> {
		const result = await this.pool.query(
			`
				SELECT 
					id,
					class_type AS "classType",
					pricing_type AS "pricingType",
					base_price AS "basePrice",
					gst_percentage AS "gstPercentage",
					is_active AS "isActive",
					valid_from AS "validFrom",
					valid_until AS "validUntil",
					created_at AS "createdAt",
					updated_at AS "updatedAt"
				FROM pricing_config
				WHERE class_type = $1
					AND pricing_type = $2
					AND is_active = true
					AND (valid_from IS NULL OR valid_from <= $3::DATE)
					AND (valid_until IS NULL OR valid_until >= $3::DATE)
				ORDER BY valid_from DESC NULLS LAST
				LIMIT 1
			`,
			[classType, pricingType, date]
		);

		if (!result.rows.length) {
			return null;
		}

		return this.mapRow(result.rows[0]);
	}

	async calculatePricing(
		classType: ClassType,
		pricingType: PricingType,
		date: Date = new Date()
	): Promise<{
		basePrice: number;
		gstPercentage: number;
		gstAmount: number;
		subtotal: number;
		total: number;
	}> {
		const config = await this.getPricing(classType, pricingType, date);

		if (!config) {
			throw new Error(`Pricing config not found for ${classType}, ${pricingType} pricing`);
		}

		const basePrice = parseFloat(config.basePrice.toString());
		const gstPercentage = parseFloat(config.gstPercentage.toString());
		const gstAmount = (basePrice * gstPercentage) / 100;
		const subtotal = basePrice;
		const total = basePrice + gstAmount;

		return {
			basePrice,
			gstPercentage,
			gstAmount: Math.round(gstAmount * 100) / 100,
			subtotal,
			total: Math.round(total * 100) / 100,
		};
	}

	private mapRow(row: any): PricingConfig {
		return {
			id: row.id,
			classType: row.classType,
			pricingType: row.pricingType,
			basePrice: parseFloat(row.basePrice),
			gstPercentage: parseFloat(row.gstPercentage),
			isActive: row.isActive,
			validFrom: row.validFrom,
			validUntil: row.validUntil,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}
}

