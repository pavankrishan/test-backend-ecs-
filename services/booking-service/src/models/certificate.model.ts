/**
 * Certificate Model - PostgreSQL Schema
 * Certificates generated for students who complete 30-session courses
 */

import type { Pool, PoolClient, QueryResult } from 'pg';

export interface Certificate {
	id: string;
	purchaseId: string;
	bookingId: string;
	studentId: string;
	courseId: string;
	trainerId: string;
	issuedAt: Date;
	certificateNumber: string; // Unique certificate number
	metadata: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface CertificateCreateInput {
	purchaseId: string;
	bookingId: string;
	studentId: string;
	courseId: string;
	trainerId: string;
	certificateNumber?: string;
	metadata?: Record<string, unknown> | null;
}

const CERTIFICATE_COLUMNS = `
	id,
	purchase_id AS "purchaseId",
	booking_id AS "bookingId",
	student_id AS "studentId",
	course_id AS "courseId",
	trainer_id AS "trainerId",
	issued_at AS "issuedAt",
	certificate_number AS "certificateNumber",
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

function mapRow(row: any): Certificate {
	return {
		id: row.id,
		purchaseId: row.purchaseId,
		bookingId: row.bookingId,
		studentId: row.studentId,
		courseId: row.courseId,
		trainerId: row.trainerId,
		issuedAt: row.issuedAt,
		certificateNumber: row.certificateNumber,
		metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export async function ensureCertificateTable(poolOrClient: Pool | PoolClient): Promise<void> {
	const queryFn = (text: string, params?: any[]) => {
		return poolOrClient.query(text, params);
	};

	await queryFn(`
		CREATE TABLE IF NOT EXISTS certificates (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			purchase_id UUID NOT NULL,
			booking_id UUID NOT NULL,
			student_id UUID NOT NULL,
			course_id UUID NOT NULL,
			trainer_id UUID NOT NULL,
			issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			certificate_number VARCHAR(50) NOT NULL UNIQUE,
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`);

	await queryFn(`
		CREATE INDEX IF NOT EXISTS idx_certificates_purchase ON certificates(purchase_id);
		CREATE INDEX IF NOT EXISTS idx_certificates_booking ON certificates(booking_id);
		CREATE INDEX IF NOT EXISTS idx_certificates_student ON certificates(student_id);
		CREATE INDEX IF NOT EXISTS idx_certificates_course ON certificates(course_id);
		CREATE INDEX IF NOT EXISTS idx_certificates_number ON certificates(certificate_number);
	`);
}

export class CertificateRepository {
	constructor(private readonly pool: Pool) {}

	async create(input: CertificateCreateInput, client?: PoolClient): Promise<Certificate> {
		// Generate certificate number if not provided
		const certificateNumber = input.certificateNumber || this.generateCertificateNumber();

		const result = await executeQuery<Certificate>(
			this.pool,
			client,
			`
				INSERT INTO certificates (
					purchase_id, booking_id, student_id, course_id, trainer_id,
					certificate_number, metadata
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
				RETURNING ${CERTIFICATE_COLUMNS}
			`,
			[
				input.purchaseId,
				input.bookingId,
				input.studentId,
				input.courseId,
				input.trainerId,
				certificateNumber,
				input.metadata ? JSON.stringify(input.metadata) : null,
			]
		);

		return mapRow(result.rows[0]);
	}

	async createMany(inputs: CertificateCreateInput[], client?: PoolClient): Promise<Certificate[]> {
		const certificates: Certificate[] = [];
		for (const input of inputs) {
			const certificate = await this.create(input, client);
			certificates.push(certificate);
		}
		return certificates;
	}

	async findByPurchaseId(purchaseId: string, client?: PoolClient): Promise<Certificate[]> {
		const result = await executeQuery<Certificate>(
			this.pool,
			client,
			`SELECT ${CERTIFICATE_COLUMNS} FROM certificates WHERE purchase_id = $1`,
			[purchaseId]
		);

		return result.rows.map(mapRow);
	}

	async findByBookingId(bookingId: string, client?: PoolClient): Promise<Certificate[]> {
		const result = await executeQuery<Certificate>(
			this.pool,
			client,
			`SELECT ${CERTIFICATE_COLUMNS} FROM certificates WHERE booking_id = $1`,
			[bookingId]
		);

		return result.rows.map(mapRow);
	}

	/**
	 * Generate a unique certificate number
	 * Format: CERT-YYYYMMDD-XXXXXX (8 random hex characters)
	 * Uses crypto for better randomness and collision resistance
	 */
	private generateCertificateNumber(): string {
		const date = new Date();
		const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
		// Use crypto for better randomness (fallback to Math.random if crypto not available)
		let randomStr: string;
		if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
			const array = new Uint8Array(4);
			crypto.getRandomValues(array);
			randomStr = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
		} else {
			// Fallback for environments without crypto
			randomStr = Math.random().toString(16).substring(2, 10).toUpperCase().padEnd(8, '0');
		}
		return `CERT-${dateStr}-${randomStr}`;
	}
}

