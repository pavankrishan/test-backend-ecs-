import { createPostgresPool } from '@kodingcaravan/shared';

export type PaymentQueryResult<T> = { rows: T[] };

export type PaymentPoolClient = {
	query: <T = any>(text: string, params?: any[]) => Promise<PaymentQueryResult<T>>;
	release: () => void;
};

type PaymentPool = {
	query: <T = any>(text: string, params?: any[]) => Promise<PaymentQueryResult<T>>;
	connect: () => Promise<PaymentPoolClient>;
};

let pool: PaymentPool | null = null;

export function getPool(): PaymentPool {
	if (!pool) {
		pool = createPostgresPool({
			connectionTimeoutMillis: 30000, // 30 seconds instead of default 10
			max: 20, // Increase pool size from default 10
			idleTimeoutMillis: 60000, // 60 seconds
		}) as unknown as PaymentPool;
	}
	return pool;
}

export async function withTransaction<T>(handler: (client: PaymentPoolClient) => Promise<T>): Promise<T> {
	const client = await getPool().connect();
	try {
		await client.query('BEGIN');
		const result = await handler(client);
		await client.query('COMMIT');
		return result;
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		client.release();
	}
}

export async function initializePaymentTables(): Promise<void> {
	const client = await getPool().connect();
	try {
		await client.query('BEGIN');
		await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
		await client.query(`CREATE EXTENSION IF NOT EXISTS "citext";`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS payments (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				student_id UUID NOT NULL,
				amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
				currency VARCHAR(10) NOT NULL DEFAULT 'INR',
				status VARCHAR(20) NOT NULL DEFAULT 'initiated',
				payment_method VARCHAR(50),
				provider VARCHAR(50),
				provider_payment_id TEXT,
				description TEXT,
				metadata JSONB,
				payment_url TEXT,
				expires_at TIMESTAMPTZ,
				confirmed_at TIMESTAMPTZ,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE(provider, provider_payment_id)
			);
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS coin_wallets (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				student_id UUID NOT NULL UNIQUE,
				balance BIGINT NOT NULL DEFAULT 0,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				CHECK (balance >= 0)
			);
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS coin_transactions (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				student_id UUID NOT NULL,
				wallet_id UUID NOT NULL REFERENCES coin_wallets(id) ON DELETE CASCADE,
				amount INTEGER NOT NULL,
				type VARCHAR(50) NOT NULL,
				reference_id TEXT,
				description TEXT,
				metadata JSONB,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				CHECK (amount <> 0)
			);
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS coin_configuration (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				key VARCHAR(100) UNIQUE NOT NULL,
				value INTEGER NOT NULL CHECK (value >= 0),
				description TEXT,
				updated_by UUID,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);
		`);

		// Insert default coin configuration values if they don't exist
		await client.query(`
			INSERT INTO coin_configuration (key, value, description)
			VALUES 
				('registration', 10, 'Coins awarded for new user registration'),
				('course_completion', 100, 'Coins awarded for completing a course'),
				('referral', 50, 'Coins awarded for referring a new student'),
				('coin_to_rupee_rate', 1, 'Conversion rate: 1 coin = X rupees discount')
			ON CONFLICT (key) DO NOTHING;
		`);

		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);

			`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_coin_transactions_student ON coin_transactions(student_id);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_coin_transactions_type ON coin_transactions(type);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_coin_transactions_wallet ON coin_transactions(wallet_id);
		`);
		await client.query(`DROP INDEX IF EXISTS idx_coin_transactions_unique_reference;`);
		await client.query(`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_coin_transactions_unique_reference
			ON coin_transactions(student_id, type, reference_id)
			WHERE reference_id IS NOT NULL;
		`);

		await client.query('COMMIT');
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		client.release();
	}
}

