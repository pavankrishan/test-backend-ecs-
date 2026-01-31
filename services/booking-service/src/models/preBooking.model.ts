/**
 * Pre-Booking Model - PostgreSQL Schema
 * Stores pre-booking demand data for trainer requirement calculation
 */

import type { Pool, PoolClient, QueryResult } from 'pg';

export type PreBookingMode = '1on1' | '1on2' | '1on3';

export interface PreBooking {
	id: string;
	address: string;
	latitude: number;
	longitude: number;
	courseId: string;
	timeslot: string; // Format: "HH:MM"
	mode: PreBookingMode;
	groupSize: 1 | 2 | 3;
	sessionCount: 10 | 20 | 30;
	cityId: string | null;
	clusterId: string | null;
	status: 'pending' | 'converted' | 'expired';
	convertedToBookingId: string | null;
	studentId: string | null;
	couponId: string | null;
	pricingType: 'official' | 'summer' | null;
	basePrice: number | null;
	gstAmount: number | null;
	totalAmount: number | null;
	paymentId: string | null;
	bookingDayOfWeek: number | null; // 1=Mon, 6=Sat (NO 7=Sun)
	metadata: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface PreBookingCreateInput {
	address: string;
	latitude: number;
	longitude: number;
	courseId: string;
	timeslot: string;
	mode: PreBookingMode;
	groupSize: 1 | 2 | 3;
	sessionCount: 10 | 20 | 30;
	cityId?: string | null;
	clusterId?: string | null;
	studentId?: string | null;
	couponId?: string | null;
	pricingType?: 'official' | 'summer' | null;
	basePrice?: number | null;
	gstAmount?: number | null;
	totalAmount?: number | null;
	paymentId?: string | null;
	bookingDayOfWeek?: number | null;
	startDate?: Date; // Used to calculate bookingDayOfWeek
	metadata?: Record<string, unknown> | null;
}

export interface PreBookingUpdateInput {
	cityId?: string | null;
	clusterId?: string | null;
	status?: 'pending' | 'converted' | 'expired';
	convertedToBookingId?: string | null;
	metadata?: Record<string, unknown> | null;
}

const PRE_BOOKING_COLUMNS = `
	id,
	address,
	latitude,
	longitude,
	course_id AS "courseId",
	timeslot,
	mode,
	group_size AS "groupSize",
	session_count AS "sessionCount",
	city_id AS "cityId",
	cluster_id AS "clusterId",
	status,
	converted_to_booking_id AS "convertedToBookingId",
	student_id AS "studentId",
	coupon_id AS "couponId",
	pricing_type AS "pricingType",
	base_price AS "basePrice",
	gst_amount AS "gstAmount",
	total_amount AS "totalAmount",
	payment_id AS "paymentId",
	booking_day_of_week AS "bookingDayOfWeek",
	metadata,
	created_at AS "createdAt",
	updated_at AS "updatedAt"
`;

function executeQuery<T extends Record<string, any> = any>(
	pool: Pool,
	client: PoolClient | undefined,
	text: string,
	params: any[] = []
): Promise<QueryResult<T>> {
	if (client) {
		return client.query<T>(text, params);
	}
	return pool.query<T>(text, params);
}

function mapRow(row: any): PreBooking {
	return {
		id: row.id,
		address: row.address,
		latitude: parseFloat(row.latitude),
		longitude: parseFloat(row.longitude),
		courseId: row.courseId,
		timeslot: row.timeslot,
		mode: row.mode,
		groupSize: row.groupSize,
		sessionCount: row.sessionCount,
		cityId: row.cityId,
		clusterId: row.clusterId,
		status: row.status,
		convertedToBookingId: row.convertedToBookingId,
		studentId: row.studentId,
		couponId: row.couponId,
		pricingType: row.pricingType,
		basePrice: row.basePrice ? parseFloat(row.basePrice) : null,
		gstAmount: row.gstAmount ? parseFloat(row.gstAmount) : null,
		totalAmount: row.totalAmount ? parseFloat(row.totalAmount) : null,
		paymentId: row.paymentId,
		bookingDayOfWeek: row.bookingDayOfWeek,
		metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export async function ensurePreBookingTable(poolOrClient: Pool | PoolClient): Promise<void> {
	const queryFn = (text: string, params?: any[]) => {
		return poolOrClient.query(text, params);
	};

	await queryFn(`
		CREATE TABLE IF NOT EXISTS pre_bookings (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			address TEXT NOT NULL,
			latitude NUMERIC(10, 8) NOT NULL,
			longitude NUMERIC(11, 8) NOT NULL,
			course_id UUID NOT NULL,
			timeslot VARCHAR(10) NOT NULL,
			mode VARCHAR(10) NOT NULL CHECK (mode IN ('1on1', '1on2', '1on3')),
			group_size INT NOT NULL CHECK (group_size IN (1, 2, 3)),
			session_count INT NOT NULL CHECK (session_count IN (10, 20, 30)),
			city_id UUID REFERENCES cities(id) ON DELETE SET NULL,
			cluster_id UUID REFERENCES clusters(id) ON DELETE SET NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'pending'
				CHECK (status IN ('pending', 'converted', 'expired')),
			converted_to_booking_id UUID,
			student_id UUID REFERENCES students(id) ON DELETE SET NULL,
			coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL,
			pricing_type TEXT CHECK (pricing_type IN ('official', 'summer')),
			base_price NUMERIC(10, 2),
			gst_amount NUMERIC(10, 2),
			total_amount NUMERIC(10, 2),
			payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
			booking_day_of_week INTEGER CHECK (booking_day_of_week >= 1 AND booking_day_of_week <= 6),
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			CONSTRAINT no_sunday_bookings CHECK (
				booking_day_of_week IS NULL OR booking_day_of_week != 7
			)
		);
	`);

	await queryFn(`
		CREATE INDEX IF NOT EXISTS idx_pre_bookings_city ON pre_bookings(city_id) WHERE city_id IS NOT NULL;
		CREATE INDEX IF NOT EXISTS idx_pre_bookings_cluster ON pre_bookings(cluster_id) WHERE cluster_id IS NOT NULL;
		CREATE INDEX IF NOT EXISTS idx_pre_bookings_status ON pre_bookings(status);
		CREATE INDEX IF NOT EXISTS idx_pre_bookings_timeslot ON pre_bookings(timeslot);
		CREATE INDEX IF NOT EXISTS idx_pre_bookings_course ON pre_bookings(course_id);
		CREATE INDEX IF NOT EXISTS idx_pre_bookings_location ON pre_bookings(latitude, longitude);
	`);
}

export class PreBookingRepository {
	constructor(private readonly pool: Pool) {}

	async create(input: PreBookingCreateInput, client?: PoolClient): Promise<PreBooking> {
		// Calculate day of week from startDate if provided
		let bookingDayOfWeek = input.bookingDayOfWeek;
		if (!bookingDayOfWeek && input.startDate) {
			const dayOfWeek = input.startDate.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
			bookingDayOfWeek = dayOfWeek === 0 ? null : dayOfWeek; // Block Sunday (null)
		}

		const result = await executeQuery<PreBooking>(
			this.pool,
			client,
			`
				INSERT INTO pre_bookings (
					address, latitude, longitude, course_id, timeslot,
					mode, group_size, session_count, city_id, cluster_id,
					student_id, coupon_id, pricing_type, base_price, gst_amount,
					total_amount, payment_id, booking_day_of_week, metadata
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
				RETURNING ${PRE_BOOKING_COLUMNS}
			`,
			[
				input.address,
				input.latitude,
				input.longitude,
				input.courseId,
				input.timeslot,
				input.mode,
				input.groupSize,
				input.sessionCount,
				input.cityId || null,
				input.clusterId || null,
				input.studentId || null,
				input.couponId || null,
				input.pricingType || null,
				input.basePrice || null,
				input.gstAmount || null,
				input.totalAmount || null,
				input.paymentId || null,
				bookingDayOfWeek,
				input.metadata ? JSON.stringify(input.metadata) : null,
			]
		);

		return mapRow(result.rows[0]);
	}

	async findById(id: string, client?: PoolClient): Promise<PreBooking | null> {
		const result = await executeQuery<PreBooking>(
			this.pool,
			client,
			`SELECT ${PRE_BOOKING_COLUMNS} FROM pre_bookings WHERE id = $1`,
			[id]
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}

	async findAll(filters?: {
		cityId?: string;
		clusterId?: string;
		status?: 'pending' | 'converted' | 'expired';
		timeslot?: string;
		limit?: number;
		offset?: number;
	}, client?: PoolClient): Promise<PreBooking[]> {
		const conditions: string[] = [];
		const params: any[] = [];
		let paramIdx = 1;

		if (filters?.cityId) {
			conditions.push(`city_id = $${paramIdx++}`);
			params.push(filters.cityId);
		}

		if (filters?.clusterId) {
			conditions.push(`cluster_id = $${paramIdx++}`);
			params.push(filters.clusterId);
		}

		if (filters?.status) {
			conditions.push(`status = $${paramIdx++}`);
			params.push(filters.status);
		}

		if (filters?.timeslot) {
			conditions.push(`timeslot = $${paramIdx++}`);
			params.push(filters.timeslot);
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
		const limit = filters?.limit || 100;
		const offset = filters?.offset || 0;

		params.push(limit, offset);

		const result = await executeQuery<PreBooking>(
			this.pool,
			client,
			`
				SELECT ${PRE_BOOKING_COLUMNS}
				FROM pre_bookings
				${whereClause}
				ORDER BY created_at DESC
				LIMIT $${paramIdx++}
				OFFSET $${paramIdx}
			`,
			params
		);

		return result.rows.map(mapRow);
	}

	async update(id: string, input: PreBookingUpdateInput, client?: PoolClient): Promise<PreBooking | null> {
		const setClauses: string[] = [];
		const params: any[] = [];
		let paramIdx = 1;

		if (input.cityId !== undefined) {
			setClauses.push(`city_id = $${paramIdx++}`);
			params.push(input.cityId);
		}

		if (input.clusterId !== undefined) {
			setClauses.push(`cluster_id = $${paramIdx++}`);
			params.push(input.clusterId);
		}

		if (input.status !== undefined) {
			setClauses.push(`status = $${paramIdx++}`);
			params.push(input.status);
		}

		if (input.convertedToBookingId !== undefined) {
			setClauses.push(`converted_to_booking_id = $${paramIdx++}`);
			params.push(input.convertedToBookingId);
		}

		if (input.metadata !== undefined) {
			setClauses.push(`metadata = $${paramIdx++}`);
			params.push(JSON.stringify(input.metadata));
		}

		if (setClauses.length === 0) {
			return this.findById(id, client);
		}

		setClauses.push('updated_at = NOW()');
		params.push(id);

		const result = await executeQuery<PreBooking>(
			this.pool,
			client,
			`
				UPDATE pre_bookings
				SET ${setClauses.join(', ')}
				WHERE id = $${paramIdx}
				RETURNING ${PRE_BOOKING_COLUMNS}
			`,
			params
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}
}

