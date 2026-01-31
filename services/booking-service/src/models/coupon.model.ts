/**
 * Coupon Model
 * Manages coupons for schools, influencers, and promotional campaigns
 */

import type { Pool, PoolClient, QueryResult } from 'pg';

export type CouponType = 'school' | 'influencer' | 'promotional';
export type DiscountType = 'percentage' | 'fixed' | 'summer_pricing';

export interface Coupon {
	id: string;
	code: string;
	name: string;
	type: CouponType;
	discountType: DiscountType;
	discountValue: number | null;
	maxRedemptions: number | null;
	currentRedemptions: number;
	validFrom: Date;
	validUntil: Date;
	isActive: boolean;
	metadata: Record<string, unknown> | null;
	createdBy: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface CouponRedemption {
	id: string;
	couponId: string;
	studentId: string;
	paymentId: string | null;
	bookingId: string | null;
	discountApplied: number;
	redeemedAt: Date;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
}

export async function ensureCouponTables(poolOrClient: Pool | PoolClient): Promise<void> {
	const queryFn = (text: string, params?: any[]) => {
		return poolOrClient.query(text, params);
	};

	await queryFn(`
		CREATE TABLE IF NOT EXISTS coupons (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			code TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			type TEXT NOT NULL CHECK (type IN ('school', 'influencer', 'promotional')),
			discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed', 'summer_pricing')),
			discount_value NUMERIC(10, 2),
			max_redemptions INTEGER,
			current_redemptions INTEGER NOT NULL DEFAULT 0,
			valid_from TIMESTAMPTZ NOT NULL,
			valid_until TIMESTAMPTZ NOT NULL,
			is_active BOOLEAN NOT NULL DEFAULT true,
			metadata JSONB,
			created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			CHECK (valid_until > valid_from),
			CHECK (current_redemptions <= COALESCE(max_redemptions, current_redemptions))
		);
	`);

	await queryFn(`
		CREATE TABLE IF NOT EXISTS coupon_redemptions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
			student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
			payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
			booking_id UUID REFERENCES session_bookings(id) ON DELETE SET NULL,
			discount_applied NUMERIC(10, 2) NOT NULL,
			redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE(coupon_id, student_id, payment_id)
		);
	`);

	await queryFn(`
		CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
		CREATE INDEX IF NOT EXISTS idx_coupons_type ON coupons(type);
		CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(is_active, valid_from, valid_until) WHERE is_active = true;
		CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon ON coupon_redemptions(coupon_id);
		CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_student ON coupon_redemptions(student_id);
		CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_payment ON coupon_redemptions(payment_id);
	`);
}

export class CouponRepository {
	constructor(private readonly pool: Pool) {}

	async findByCode(code: string): Promise<Coupon | null> {
		const result = await this.pool.query(
			`
				SELECT 
					id,
					code,
					name,
					type,
					discount_type AS "discountType",
					discount_value AS "discountValue",
					max_redemptions AS "maxRedemptions",
					current_redemptions AS "currentRedemptions",
					valid_from AS "validFrom",
					valid_until AS "validUntil",
					is_active AS "isActive",
					metadata,
					created_by AS "createdBy",
					created_at AS "createdAt",
					updated_at AS "updatedAt"
				FROM coupons
				WHERE code = $1
			`,
			[code]
		);

		if (!result.rows.length) {
			return null;
		}

		return this.mapRow(result.rows[0]);
	}

	async validateCoupon(
		code: string,
		sessionCount: number,
		date: Date = new Date(),
		studentId?: string
	): Promise<{ valid: boolean; coupon: Coupon | null; appliesSummerPricing: boolean; error?: string }> {
		const coupon = await this.findByCode(code);

		if (!coupon) {
			return { valid: false, coupon: null, appliesSummerPricing: false, error: 'Invalid coupon code' };
		}

		if (!coupon.isActive) {
			return { valid: false, coupon, appliesSummerPricing: false, error: 'Coupon is inactive' };
		}

		const now = date;
		if (now < coupon.validFrom || now > coupon.validUntil) {
			return { valid: false, coupon, appliesSummerPricing: false, error: 'Coupon is expired or not yet valid' };
		}

		if (coupon.maxRedemptions && coupon.currentRedemptions >= coupon.maxRedemptions) {
			return { valid: false, coupon, appliesSummerPricing: false, error: 'Coupon redemption limit reached' };
		}

		// Check if student has already used ANY coupon OR claimed deal (one discount per user lifetime restriction)
		if (studentId) {
			const previousRedemptionResult = await this.pool.query(
				`
					SELECT id FROM coupon_redemptions
					WHERE student_id = $1
					LIMIT 1
				`,
				[studentId]
			);

			if (previousRedemptionResult.rows.length > 0) {
				return { valid: false, coupon, appliesSummerPricing: false, error: 'You have already used a coupon code. Each user can only use one coupon code.' };
			}

			// Check if student has claimed their deal (claim deal and coupon are mutually exclusive)
			const hasClaimedDealResult = await this.pool.query(
				`
					SELECT has_claimed_deal FROM students
					WHERE id = $1
					LIMIT 1
				`,
				[studentId]
			);

			if (hasClaimedDealResult.rows.length > 0 && hasClaimedDealResult.rows[0].has_claimed_deal === true) {
				return { valid: false, coupon, appliesSummerPricing: false, error: 'You have already claimed your deal. Only one discount (coupon or deal) can be used per user.' };
			}
		}

		const appliesSummerPricing = coupon.discountType === 'summer_pricing';

		return { valid: true, coupon, appliesSummerPricing };
	}

	async recordRedemption(
		couponId: string,
		studentId: string,
		discountApplied: number,
		paymentId?: string,
		bookingId?: string,
		metadata?: Record<string, unknown>
	): Promise<CouponRedemption> {
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');

			// Record redemption
			const redemptionResult = await client.query(
				`
					INSERT INTO coupon_redemptions (
						coupon_id, student_id, payment_id, booking_id, 
						discount_applied, metadata
					)
					VALUES ($1, $2, $3, $4, $5, $6)
					RETURNING 
						id,
						coupon_id AS "couponId",
						student_id AS "studentId",
						payment_id AS "paymentId",
						booking_id AS "bookingId",
						discount_applied AS "discountApplied",
						redeemed_at AS "redeemedAt",
						metadata,
						created_at AS "createdAt"
				`,
				[couponId, studentId, paymentId || null, bookingId || null, discountApplied, metadata ? JSON.stringify(metadata) : null]
			);

			// Update coupon redemption count (trigger handles this, but we do it explicitly for safety)
			await client.query(
				`
					UPDATE coupons
					SET current_redemptions = current_redemptions + 1,
						updated_at = NOW()
					WHERE id = $1
				`,
				[couponId]
			);

			await client.query('COMMIT');

			return this.mapRedemptionRow(redemptionResult.rows[0]);
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}

	private mapRow(row: any): Coupon {
		return {
			id: row.id,
			code: row.code,
			name: row.name,
			type: row.type,
			discountType: row.discountType,
			discountValue: row.discountValue ? parseFloat(row.discountValue) : null,
			maxRedemptions: row.maxRedemptions,
			currentRedemptions: row.currentRedemptions,
			validFrom: row.validFrom,
			validUntil: row.validUntil,
			isActive: row.isActive,
			metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
			createdBy: row.createdBy,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}

	private mapRedemptionRow(row: any): CouponRedemption {
		return {
			id: row.id,
			couponId: row.couponId,
			studentId: row.studentId,
			paymentId: row.paymentId,
			bookingId: row.bookingId,
			discountApplied: parseFloat(row.discountApplied),
			redeemedAt: row.redeemedAt,
			metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
			createdAt: row.createdAt,
		};
	}
}

