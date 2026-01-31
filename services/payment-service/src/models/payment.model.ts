import type { PaymentPoolClient, PaymentQueryResult } from '../config/database';
import { getPool } from '../config/database';

function query<T = any>(
	text: string,
	params: any[] = [],
	client?: PaymentPoolClient
): Promise<PaymentQueryResult<T>> {
	if (client) {
		return client.query<T>(text, params);
	}
	return getPool().query<T>(text, params);
}

export type PaymentStatus =
	| 'initiated'
	| 'processing'
	| 'succeeded'
	| 'failed'
	| 'refunded'
	| 'cancelled';

export type PaymentRecord = {
	id: string;
	studentId: string;
	amountCents: number;
	currency: string;
	status: PaymentStatus;
	paymentMethod: string | null;
	provider: string | null;
	providerPaymentId: string | null;
	description: string | null;
	metadata: Record<string, unknown> | null;
	paymentUrl: string | null;
	expiresAt: Date | null;
	confirmedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

export type CoinWalletRecord = {
	id: string;
	studentId: string;
	balance: number;
	createdAt: Date;
	updatedAt: Date;
};

export type CoinTransactionRecord = {
	id: string;
	studentId: string;
	walletId: string;
	amount: number;
	type: string;
	referenceId: string | null;
	description: string | null;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
};

const paymentColumns = `
	id,
	student_id AS "studentId",
	amount_cents AS "amountCents",
	currency,
	status,
	payment_method AS "paymentMethod",
	provider,
	provider_payment_id AS "providerPaymentId",
	description,
	metadata,
	payment_url AS "paymentUrl",
	expires_at AS "expiresAt",
	confirmed_at AS "confirmedAt",
	created_at AS "createdAt",
	updated_at AS "updatedAt"
`;

const walletColumns = `
	id,
	student_id AS "studentId",
	balance::bigint AS balance,
	created_at AS "createdAt",
	updated_at AS "updatedAt"
`;

const transactionColumns = `
	id,
	student_id AS "studentId",
	wallet_id AS "walletId",
	amount,
	type,
	reference_id AS "referenceId",
	description,
	metadata,
	created_at AS "createdAt"
`;

export async function insertPayment(
	data: {
		studentId: string;
		amountCents: number;
		currency: string;
		status: PaymentStatus;
		paymentMethod?: string | null;
		provider?: string | null;
		providerPaymentId?: string | null;
		description?: string | null;
		metadata?: Record<string, unknown> | null;
		paymentUrl?: string | null;
		expiresAt?: Date | null;
	},
	client?: PaymentPoolClient
): Promise<PaymentRecord> {
	const result = await query<PaymentRecord>(
		`
			INSERT INTO payments (
				student_id,
				amount_cents,
				currency,
				status,
				payment_method,
				provider,
				provider_payment_id,
				description,
				metadata,
				payment_url,
				expires_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			RETURNING ${paymentColumns}
		`,
		[
			data.studentId,
			data.amountCents,
			data.currency,
			data.status,
			data.paymentMethod ?? null,
			data.provider ?? null,
			data.providerPaymentId ?? null,
			data.description ?? null,
			data.metadata ?? null,
			data.paymentUrl ?? null,
			data.expiresAt ?? null,
		],
		client
	);

	const record = result.rows[0];
	if (!record) {
		throw new Error('Failed to insert payment record');
	}
	return record;
}

export async function findPaymentById(
	id: string,
	client?: PaymentPoolClient
): Promise<PaymentRecord | null> {
	const result = await query<PaymentRecord>(
		`
			SELECT ${paymentColumns}
			FROM payments
			WHERE id = $1
		`,
		[id],
		client
	);
	return result.rows[0] ?? null;
}

export async function findPaymentByProviderPaymentId(
	providerPaymentId: string,
	client?: PaymentPoolClient
): Promise<PaymentRecord | null> {
	const result = await query<PaymentRecord>(
		`
			SELECT ${paymentColumns}
			FROM payments
			WHERE provider_payment_id = $1
			ORDER BY created_at DESC
			LIMIT 1
		`,
		[providerPaymentId],
		client
	);
	return result.rows[0] ?? null;
}

export async function updatePayment(
	id: string,
	updates: Partial<{
		status: PaymentStatus;
		providerPaymentId: string | null;
		provider: string | null;
		paymentUrl: string | null;
		expiresAt: Date | null;
		description: string | null;
		metadata: Record<string, unknown> | null;
		confirmedAt: Date | null;
		paymentMethod: string | null;
	}>
): Promise<PaymentRecord | null> {
	const fields: string[] = [];
	const params: any[] = [];
	let idx = 1;

	for (const [key, value] of Object.entries(updates)) {
		if (value === undefined) continue;
		let column: string;
		switch (key) {
			case 'status':
				column = 'status';
				break;
			case 'providerPaymentId':
				column = 'provider_payment_id';
				break;
			case 'provider':
				column = 'provider';
				break;
			case 'paymentUrl':
				column = 'payment_url';
				break;
			case 'expiresAt':
				column = 'expires_at';
				break;
			case 'description':
				column = 'description';
				break;
			case 'metadata':
				column = 'metadata';
				break;
			case 'confirmedAt':
				column = 'confirmed_at';
				break;
			case 'paymentMethod':
				column = 'payment_method';
				break;
			default:
				continue;
		}
		fields.push(`${column} = $${idx++}`);
		params.push(value);
	}

	if (!fields.length) {
		return findPaymentById(id);
	}

	params.push(id);

	const result = await query<PaymentRecord>(
		`
			UPDATE payments
			SET ${fields.join(', ')},
				updated_at = NOW()
			WHERE id = $${idx}
			RETURNING ${paymentColumns}
		`,
		params
	);

	return result.rows[0] ?? null;
}

export async function listPaymentsByStudent(
	studentId: string,
	options: { limit?: number; offset?: number } = {}
): Promise<PaymentRecord[]> {
	const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
	const offset = Math.max(options.offset ?? 0, 0);

	const result = await query<PaymentRecord>(
		`
			SELECT ${paymentColumns}
			FROM payments
			WHERE student_id = $1
			ORDER BY created_at DESC
			LIMIT $2 OFFSET $3
		`,
		[studentId, limit, offset]
	);

	return result.rows;
}

export async function ensureCoinWallet(
	studentId: string,
	client?: PaymentPoolClient
): Promise<CoinWalletRecord> {
	const result = await query<CoinWalletRecord>(
		`
			INSERT INTO coin_wallets (student_id)
			VALUES ($1)
			ON CONFLICT (student_id) DO UPDATE
			SET updated_at = NOW()
			RETURNING ${walletColumns}
		`,
		[studentId],
		client
	);

	const record = result.rows[0];
	if (!record) {
		throw new Error('Failed to ensure coin wallet');
	}
	// Ensure balance is a number (PostgreSQL BIGINT can return as string)
	return {
		...record,
		balance: typeof record.balance === 'string' ? Number(record.balance) : record.balance,
	};
}

export async function changeCoinWalletBalance(
	studentId: string,
	delta: number,
	client?: PaymentPoolClient
): Promise<CoinWalletRecord | null> {
	const result = await query<CoinWalletRecord>(
		`
			UPDATE coin_wallets
			SET balance = balance + $1,
				updated_at = NOW()
			WHERE student_id = $2
				AND balance + $1 >= 0
			RETURNING ${walletColumns}
		`,
		[delta, studentId],
		client
	);

	const wallet = result.rows[0];
	if (wallet) {
		// Ensure balance is a number (PostgreSQL BIGINT can return as string)
		return {
			...wallet,
			balance: typeof wallet.balance === 'string' ? Number(wallet.balance) : wallet.balance,
		};
	}
	return null;
}

export async function getCoinWalletByStudentId(
	studentId: string,
	client?: PaymentPoolClient
): Promise<CoinWalletRecord | null> {
	const result = await query<CoinWalletRecord>(
		`
			SELECT ${walletColumns}
			FROM coin_wallets
			WHERE student_id = $1
		`,
		[studentId],
		client
	);
	const wallet = result.rows[0];
	if (wallet) {
		// Ensure balance is a number (PostgreSQL BIGINT can return as string)
		return {
			...wallet,
			balance: typeof wallet.balance === 'string' ? Number(wallet.balance) : wallet.balance,
		};
	}
	return null;
}

export async function insertCoinTransaction(
	data: {
		studentId: string;
		walletId: string;
		amount: number;
		type: string;
		referenceId?: string | null;
		description?: string | null;
		metadata?: Record<string, unknown> | null;
	},
	client?: PaymentPoolClient
): Promise<CoinTransactionRecord> {
	const result = await query<CoinTransactionRecord>(
		`
			INSERT INTO coin_transactions (
				student_id,
				wallet_id,
				amount,
				type,
				reference_id,
				description,
				metadata
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING ${transactionColumns}
		`,
		[
			data.studentId,
			data.walletId,
			data.amount,
			data.type,
			data.referenceId ?? null,
			data.description ?? null,
			data.metadata ?? null,
		],
		client
	);

	const record = result.rows[0];
	if (!record) {
		throw new Error('Failed to insert coin transaction');
	}
	return record;
}

export async function listCoinTransactionsByStudent(
	studentId: string,
	options: { limit?: number; offset?: number } = {}
): Promise<CoinTransactionRecord[]> {
	const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
	const offset = Math.max(options.offset ?? 0, 0);

	const result = await query<CoinTransactionRecord>(
		`
			SELECT ${transactionColumns}
			FROM coin_transactions
			WHERE student_id = $1
			ORDER BY created_at DESC
			LIMIT $2 OFFSET $3
		`,
		[studentId, limit, offset]
	);

	return result.rows;
}

export type CoinConfigurationRecord = {
	id: string;
	key: string;
	value: number;
	description: string | null;
	updatedBy: string | null;
	createdAt: Date;
	updatedAt: Date;
};

const coinConfigColumns = `
	id,
	key,
	value,
	description,
	updated_by AS "updatedBy",
	created_at AS "createdAt",
	updated_at AS "updatedAt"
`;

export async function getCoinConfiguration(
	key: string,
	client?: PaymentPoolClient
): Promise<CoinConfigurationRecord | null> {
	const result = await query<CoinConfigurationRecord>(
		`
			SELECT ${coinConfigColumns}
			FROM coin_configuration
			WHERE key = $1
		`,
		[key],
		client
	);
	return result.rows[0] || null;
}

export async function getAllCoinConfiguration(
	client?: PaymentPoolClient
): Promise<CoinConfigurationRecord[]> {
	const result = await query<CoinConfigurationRecord>(
		`
			SELECT ${coinConfigColumns}
			FROM coin_configuration
			ORDER BY key
		`,
		[],
		client
	);
	return result.rows;
}

export async function updateCoinConfiguration(
	key: string,
	value: number,
	updatedBy?: string | null,
	client?: PaymentPoolClient
): Promise<CoinConfigurationRecord> {
	const result = await query<CoinConfigurationRecord>(
		`
			UPDATE coin_configuration
			SET value = $1,
				updated_by = $2,
				updated_at = NOW()
			WHERE key = $3
			RETURNING ${coinConfigColumns}
		`,
		[value, updatedBy || null, key],
		client
	);
	
	const record = result.rows[0];
	if (!record) {
		throw new Error(`Coin configuration key '${key}' not found`);
	}
	return record;
}

