import { Pool, PoolClient } from 'pg';

export type ReviewType = 'student' | 'trainer';

export interface SessionReviewRecord {
	id: string;
	sessionId: string;
	studentId: string;
	trainerId: string;
	courseId: string | null;
	reviewType: ReviewType; // 'student' for student reviewing trainer, 'trainer' for trainer reviewing student
	rating: number; // 0.5-5.0 stars (in 0.5 increments)
	feedback: string | null;
	satisfied: boolean | null; // For student reviews only
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateReviewInput {
	sessionId: string;
	studentId: string;
	trainerId: string;
	courseId?: string | null;
	reviewType: ReviewType;
	rating: number;
	feedback?: string | null;
	satisfied?: boolean | null;
}

const REVIEW_COLUMNS = `
	id,
	session_id,
	student_id,
	trainer_id,
	course_id,
	review_type,
	rating,
	feedback,
	satisfied,
	created_at,
	updated_at
`;

function mapRow(row: any): SessionReviewRecord {
	return {
		id: row.id,
		sessionId: row.session_id,
		studentId: row.student_id,
		trainerId: row.trainer_id,
		courseId: row.course_id,
		reviewType: row.review_type,
		rating: row.rating,
		feedback: row.feedback,
		satisfied: row.satisfied,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function ensureSessionReviewTable(poolOrClient: Pool | PoolClient): Promise<void> {
	const queryFn = (text: string, params?: any[]) => {
		return poolOrClient.query(text, params);
	};

	await queryFn(`
		CREATE TABLE IF NOT EXISTS session_reviews (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			session_id UUID NOT NULL REFERENCES tutoring_sessions(id) ON DELETE CASCADE,
			student_id UUID NOT NULL,
			trainer_id UUID NOT NULL,
			course_id UUID,
			review_type TEXT NOT NULL CHECK (review_type IN ('student', 'trainer')),
			rating NUMERIC(2, 1) NOT NULL CHECK (rating >= 0.5 AND rating <= 5.0),
			feedback TEXT,
			satisfied BOOLEAN, -- For student reviews only
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE(session_id, review_type) -- One review per type per session
		);
	`);

	// Create indexes
	await queryFn(`
		CREATE INDEX IF NOT EXISTS idx_session_reviews_session_id ON session_reviews(session_id);
		CREATE INDEX IF NOT EXISTS idx_session_reviews_student_id ON session_reviews(student_id);
		CREATE INDEX IF NOT EXISTS idx_session_reviews_trainer_id ON session_reviews(trainer_id);
		CREATE INDEX IF NOT EXISTS idx_session_reviews_course_id ON session_reviews(course_id) WHERE course_id IS NOT NULL;
		CREATE INDEX IF NOT EXISTS idx_session_reviews_review_type ON session_reviews(review_type);
		CREATE INDEX IF NOT EXISTS idx_session_reviews_rating ON session_reviews(rating);
		CREATE INDEX IF NOT EXISTS idx_session_reviews_created_at ON session_reviews(created_at DESC);
	`);
}

export class SessionReviewRepository {
	constructor(private readonly pool: Pool) {}

	async create(input: CreateReviewInput, client?: PoolClient): Promise<SessionReviewRecord> {
		const queryClient = client || this.pool;
		const result = await queryClient.query<SessionReviewRecord>(
			`
				INSERT INTO session_reviews (
					session_id,
					student_id,
					trainer_id,
					course_id,
					review_type,
					rating,
					feedback,
					satisfied
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
				ON CONFLICT (session_id, review_type) 
				DO UPDATE SET
					rating = EXCLUDED.rating,
					feedback = EXCLUDED.feedback,
					satisfied = EXCLUDED.satisfied,
					updated_at = NOW()
				RETURNING ${REVIEW_COLUMNS}
			`,
			[
				input.sessionId,
				input.studentId,
				input.trainerId,
				input.courseId || null,
				input.reviewType,
				input.rating,
				input.feedback || null,
				input.satisfied ?? null,
			]
		);

		return mapRow(result.rows[0]);
	}

	async findBySessionId(sessionId: string, client?: PoolClient): Promise<SessionReviewRecord[]> {
		const queryClient = client || this.pool;
		const result = await queryClient.query<SessionReviewRecord>(
			`
				SELECT ${REVIEW_COLUMNS}
				FROM session_reviews
				WHERE session_id = $1
				ORDER BY created_at DESC
			`,
			[sessionId]
		);

		return result.rows.map(mapRow);
	}

	async findByTrainerId(trainerId: string, limit?: number, offset?: number, client?: PoolClient): Promise<SessionReviewRecord[]> {
		const params: any[] = [trainerId];
		let query = `
			SELECT ${REVIEW_COLUMNS}
			FROM session_reviews
			WHERE trainer_id = $1
				AND review_type = 'student'
			ORDER BY created_at DESC
		`;

		if (limit) {
			params.push(limit);
			query += ` LIMIT $${params.length}`;
		}

		if (offset) {
			params.push(offset);
			query += ` OFFSET $${params.length}`;
		}

		const queryClient = client || this.pool;
		const result = await queryClient.query<SessionReviewRecord>(
			query,
			params
		);

		return result.rows.map(mapRow);
	}

	async getTrainerRatingStats(trainerId: string, client?: PoolClient): Promise<{
		averageRating: number;
		totalReviews: number;
		ratingDistribution: { rating: number; count: number }[];
	}> {
		const queryClient = client || this.pool;
		// First get the rating distribution
		const distributionResult = await queryClient.query<{
			rating: number;
			count: string;
		}>(
			`
				SELECT 
					rating,
					COUNT(*)::INTEGER as count
				FROM session_reviews
				WHERE trainer_id = $1
					AND review_type = 'student'
				GROUP BY rating
				ORDER BY rating DESC
			`,
			[trainerId]
		);

		// Then get the average and total
		const statsResult = await queryClient.query<{
			average_rating: number;
			total_reviews: number;
		}>(
			`
				SELECT 
					COALESCE(AVG(rating), 0)::NUMERIC(3, 2) as average_rating,
					COUNT(*)::INTEGER as total_reviews
				FROM session_reviews
				WHERE trainer_id = $1
					AND review_type = 'student'
			`,
			[trainerId]
		);

		const statsRow = statsResult.rows[0] || { average_rating: 0, total_reviews: 0 };

		return {
			averageRating: parseFloat(String(statsRow.average_rating)) || 0,
			totalReviews: statsRow.total_reviews || 0,
			ratingDistribution: distributionResult.rows.map((r: { rating: number; count: string }) => ({
				rating: r.rating,
				count: parseInt(String(r.count), 10),
			})),
		};
	}

	async findByStudentId(studentId: string, limit?: number, offset?: number, client?: PoolClient): Promise<SessionReviewRecord[]> {
		const params: any[] = [studentId];
		let query = `
			SELECT ${REVIEW_COLUMNS}
			FROM session_reviews
			WHERE student_id = $1
				AND review_type = 'trainer'
			ORDER BY created_at DESC
		`;

		if (limit) {
			params.push(limit);
			query += ` LIMIT $${params.length}`;
		}

		if (offset) {
			params.push(offset);
			query += ` OFFSET $${params.length}`;
		}

		const queryClient = client || this.pool;
		const result = await queryClient.query<SessionReviewRecord>(
			query,
			params
		);

		return result.rows.map(mapRow);
	}

	async findBySessionAndType(sessionId: string, reviewType: ReviewType, client?: PoolClient): Promise<SessionReviewRecord | null> {
		const queryClient = client || this.pool;
		const result = await queryClient.query<SessionReviewRecord>(
			`
				SELECT ${REVIEW_COLUMNS}
				FROM session_reviews
				WHERE session_id = $1
					AND review_type = $2
				LIMIT 1
			`,
			[sessionId, reviewType]
		);

		return result.rows.length > 0 ? mapRow(result.rows[0]) : null;
	}
}

