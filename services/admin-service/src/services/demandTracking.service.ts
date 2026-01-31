import { Pool, PoolClient } from 'pg';
import { getPool } from '../config/database';
import logger from '@kodingcaravan/shared/config/logger';

export type DemandSignalType = 'COURSE_VIEW' | 'CHECKOUT_STARTED' | 'PURCHASE_BLOCKED' | 'WAITLIST';

export interface CreateDemandSignalInput {
	courseId: string;
	userId: string;
	cityId?: string | null;
	signalType: DemandSignalType;
	reason?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface DemandSignal {
	id: string;
	courseId: string;
	userId: string;
	cityId: string | null;
	signalType: DemandSignalType;
	reason: string | null;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface DemandAnalytics {
	courseId: string;
	courseTitle?: string;
	cityId?: string | null;
	cityName?: string | null;
	totalSignals: number;
	purchaseBlockedCount: number;
	waitlistCount: number;
	checkoutStartedCount: number;
	courseViewCount: number;
	dateRange: {
		start: Date;
		end: Date;
	};
}

/**
 * Service for tracking demand signals when trainers are unavailable
 * Used for analytics and hiring decisions
 */
export class DemandTrackingService {
	private pool: Pool;

	constructor() {
		this.pool = getPool();
	}

	/**
	 * Create a demand signal
	 */
	async createDemandSignal(
		input: CreateDemandSignalInput,
		client?: PoolClient
	): Promise<DemandSignal> {
		const db = client || this.pool;

		try {
			// Check if table exists first (graceful degradation)
			const tableCheck = await db.query(`
				SELECT EXISTS (
					SELECT FROM information_schema.tables 
					WHERE table_schema = 'public' 
					AND table_name = 'demand_signals'
				);
			`);
			
			if (!tableCheck.rows[0]?.exists) {
				logger.warn('[DemandTrackingService] demand_signals table does not exist. Please run migration 018.');
				throw new Error('Demand tracking table not found. Please run migration 018.');
			}

			const result = await db.query<{
				id: string;
				course_id: string;
				user_id: string;
				city_id: string | null;
				signal_type: string;
				reason: string | null;
				metadata: any;
				created_at: Date;
				updated_at: Date;
			}>(
				`INSERT INTO demand_signals (
					course_id,
					user_id,
					city_id,
					signal_type,
					reason,
					metadata
				) VALUES ($1, $2, $3, $4, $5, $6)
				RETURNING *`,
				[
					input.courseId,
					input.userId,
					input.cityId || null,
					input.signalType,
					input.reason || null,
					input.metadata ? JSON.stringify(input.metadata) : null,
				]
			);

			const row = result.rows[0];
			return this.mapRowToDemandSignal(row);
		} catch (error: any) {
			logger.error('[DemandTrackingService] Error creating demand signal:', {
				error: error.message,
				input,
			});
			throw error;
		}
	}

	/**
	 * Log demand signal when purchase is blocked due to no trainer
	 */
	async logPurchaseBlocked(
		courseId: string,
		userId: string,
		reason: string = 'NO_TRAINER_AVAILABLE',
		metadata?: Record<string, unknown>,
		client?: PoolClient
	): Promise<DemandSignal> {
		// Try to get city_id from student profile coordinates (optional)
		// Note: city_id is optional - demand tracking works without it
		// For now, skip city lookup to avoid SQL complexity - can be added later if needed
		let cityId: string | null = null;
		// TODO: Implement city lookup when cities table structure is confirmed
		// For now, city_id will be null, which is acceptable

		return this.createDemandSignal(
			{
				courseId,
				userId,
				cityId,
				signalType: 'PURCHASE_BLOCKED',
				reason,
				metadata: {
					...metadata,
					timestamp: new Date().toISOString(),
				},
			},
			client
		);
	}

	/**
	 * Register user for waitlist
	 */
	async registerWaitlist(
		courseId: string,
		userId: string,
		metadata?: Record<string, unknown>,
		client?: PoolClient
	): Promise<DemandSignal> {
		// Try to get city_id from student profile coordinates (optional)
		// Note: city_id is optional - demand tracking works without it
		// For now, skip city lookup to avoid SQL complexity - can be added later if needed
		let cityId: string | null = null;
		// TODO: Implement city lookup when cities table structure is confirmed
		// For now, city_id will be null, which is acceptable

		return this.createDemandSignal(
			{
				courseId,
				userId,
				cityId,
				signalType: 'WAITLIST',
				reason: 'USER_REQUESTED',
				metadata: {
					...metadata,
					timestamp: new Date().toISOString(),
				},
			},
			client
		);
	}

	/**
	 * Get demand analytics for a course
	 */
	async getCourseDemandAnalytics(
		courseId: string,
		startDate?: Date,
		endDate?: Date,
		cityId?: string | null
	): Promise<DemandAnalytics> {
		const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: last 30 days
		const end = endDate || new Date();

		let query = `
			SELECT 
				ds.course_id,
				c.title as course_title,
				ds.city_id,
				ci.name as city_name,
				COUNT(*)::int as total_signals,
				COUNT(*) FILTER (WHERE ds.signal_type = 'PURCHASE_BLOCKED')::int as purchase_blocked_count,
				COUNT(*) FILTER (WHERE ds.signal_type = 'WAITLIST')::int as waitlist_count,
				COUNT(*) FILTER (WHERE ds.signal_type = 'CHECKOUT_STARTED')::int as checkout_started_count,
				COUNT(*) FILTER (WHERE ds.signal_type = 'COURSE_VIEW')::int as course_view_count
			FROM demand_signals ds
			LEFT JOIN courses c ON ds.course_id = c.id
			LEFT JOIN cities ci ON ds.city_id = ci.id
			WHERE ds.course_id = $1
				AND ds.created_at >= $2
				AND ds.created_at <= $3
		`;

		const params: any[] = [courseId, start, end];
		let paramIndex = 4;

		if (cityId) {
			query += ` AND ds.city_id = $${paramIndex}`;
			params.push(cityId);
		}

		query += ` GROUP BY ds.course_id, c.title, ds.city_id, ci.name`;

		const result = await this.pool.query(query, params);

		if (result.rows.length === 0) {
			return {
				courseId,
				totalSignals: 0,
				purchaseBlockedCount: 0,
				waitlistCount: 0,
				checkoutStartedCount: 0,
				courseViewCount: 0,
				dateRange: { start, end },
			};
		}

		const row = result.rows[0];
		return {
			courseId: row.course_id,
			courseTitle: row.course_title || undefined,
			cityId: row.city_id || undefined,
			cityName: row.city_name || undefined,
			totalSignals: parseInt(row.total_signals) || 0,
			purchaseBlockedCount: parseInt(row.purchase_blocked_count) || 0,
			waitlistCount: parseInt(row.waitlist_count) || 0,
			checkoutStartedCount: parseInt(row.checkout_started_count) || 0,
			courseViewCount: parseInt(row.course_view_count) || 0,
			dateRange: { start, end },
		};
	}

	/**
	 * Get demand analytics aggregated by course
	 */
	async getAllCoursesDemandAnalytics(
		startDate?: Date,
		endDate?: Date,
		cityId?: string | null
	): Promise<DemandAnalytics[]> {
		const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
		const end = endDate || new Date();

		let query = `
			SELECT 
				ds.course_id,
				c.title as course_title,
				ds.city_id,
				ci.name as city_name,
				COUNT(*)::int as total_signals,
				COUNT(*) FILTER (WHERE ds.signal_type = 'PURCHASE_BLOCKED')::int as purchase_blocked_count,
				COUNT(*) FILTER (WHERE ds.signal_type = 'WAITLIST')::int as waitlist_count,
				COUNT(*) FILTER (WHERE ds.signal_type = 'CHECKOUT_STARTED')::int as checkout_started_count,
				COUNT(*) FILTER (WHERE ds.signal_type = 'COURSE_VIEW')::int as course_view_count
			FROM demand_signals ds
			LEFT JOIN courses c ON ds.course_id = c.id
			LEFT JOIN cities ci ON ds.city_id = ci.id
			WHERE ds.created_at >= $1
				AND ds.created_at <= $2
		`;

		const params: any[] = [start, end];
		let paramIndex = 3;

		if (cityId) {
			query += ` AND ds.city_id = $${paramIndex}`;
			params.push(cityId);
		}

		query += ` GROUP BY ds.course_id, c.title, ds.city_id, ci.name
			ORDER BY total_signals DESC`;

		const result = await this.pool.query(query, params);

		return result.rows.map((row) => ({
			courseId: row.course_id,
			courseTitle: row.course_title || undefined,
			cityId: row.city_id || undefined,
			cityName: row.city_name || undefined,
			totalSignals: parseInt(row.total_signals) || 0,
			purchaseBlockedCount: parseInt(row.purchase_blocked_count) || 0,
			waitlistCount: parseInt(row.waitlist_count) || 0,
			checkoutStartedCount: parseInt(row.checkout_started_count) || 0,
			courseViewCount: parseInt(row.course_view_count) || 0,
			dateRange: { start, end },
		}));
	}

	/**
	 * Check if user is already on waitlist for a course
	 */
	async isUserOnWaitlist(courseId: string, userId: string): Promise<boolean> {
		try {
			// Check if table exists first
			const tableCheck = await this.pool.query(`
				SELECT EXISTS (
					SELECT FROM information_schema.tables 
					WHERE table_schema = 'public' 
					AND table_name = 'demand_signals'
				);
			`);
			
			if (!tableCheck.rows[0]?.exists) {
				logger.warn('[DemandTrackingService] demand_signals table does not exist. Returning false for waitlist check.');
				return false;
			}

			const result = await this.pool.query<{ count: number }>(
				`SELECT COUNT(*)::int as count
				FROM demand_signals
				WHERE course_id = $1
					AND user_id = $2
					AND signal_type = 'WAITLIST'`,
				[courseId, userId]
			);

			return (result.rows[0]?.count || 0) > 0;
		} catch (error: any) {
			logger.error('[DemandTrackingService] Error checking waitlist status:', {
				error: error.message,
				courseId,
				userId,
			});
			// Return false on error - safer than throwing
			return false;
		}
	}

	/**
	 * Map database row to DemandSignal object
	 */
	private mapRowToDemandSignal(row: {
		id: string;
		course_id: string;
		user_id: string;
		city_id: string | null;
		signal_type: string;
		reason: string | null;
		metadata: any;
		created_at: Date;
		updated_at: Date;
	}): DemandSignal {
		return {
			id: row.id,
			courseId: row.course_id,
			userId: row.user_id,
			cityId: row.city_id,
			signalType: row.signal_type as DemandSignalType,
			reason: row.reason,
			metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}
