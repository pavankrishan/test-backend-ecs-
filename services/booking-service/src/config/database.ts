/**
 * Database Configuration
 */

import { Pool, PoolClient } from 'pg';
import { createPostgresPool } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';
import { ensureCityTable } from '../models/city.model';
import { ensureClusterTable } from '../models/cluster.model';
import { ensureSessionBookingTable } from '../models/sessionBooking.model';
import { ensurePreBookingTable } from '../models/preBooking.model';
import { ensureScheduleSlotTable } from '../models/scheduleSlot.model';
import { ensureAttendanceRecordTable } from '../models/attendanceRecord.model';
import { ensureFranchiseTable } from '../models/franchise.model';
import { ensureZoneTable } from '../models/zone.model';
import { ensureCoursePurchaseTable } from '../models/coursePurchase.model';
import { ensurePurchaseSessionTable } from '../models/purchaseSession.model';
import { ensureCertificateTable } from '../models/certificate.model';

let pool: Pool | null = null;

export function getPool(): Pool {
	if (!pool) {
		pool = createPostgresPool({
			connectionTimeoutMillis: 20000, // Increase timeout to 20 seconds
			max: 10,
		});
		if (pool) {
			pool.on('connect', (client) => {
				client.query(`SET application_name = 'booking-service'`);
			});
		}
	}
	if (!pool) {
		throw new Error('Failed to create database pool');
	}
	return pool;
}

export async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
	const pool = getPool();
	let client: PoolClient | null = null;
	let retries = 3;
	
	while (retries > 0) {
		try {
			client = await pool.connect();
			await client.query('BEGIN');
			const result = await handler(client);
			await client.query('COMMIT');
			return result;
		} catch (err: any) {
			// Check if it's a connection error that might be transient
			const isConnectionError = err?.message?.includes('Connection terminated') || 
									  err?.message?.includes('ECONNRESET') ||
									  err?.message?.includes('ECONNREFUSED') ||
									  err?.code === 'ECONNRESET' ||
									  err?.code === 'ECONNREFUSED' ||
									  err?.message?.includes('Client has encountered a connection error');
			
			if (client) {
				try {
					await client.query('ROLLBACK');
				} catch (rollbackErr) {
					// Ignore rollback errors if connection is already dead
				}
				client.release();
				client = null;
			}
			
			// Retry on connection errors
			if (isConnectionError && retries > 1) {
				retries--;
				const delay = Math.min(1000 * Math.pow(2, 3 - retries), 5000);
				logger.warn('Database connection error, retrying', { 
				service: 'booking-service',
				retries: 3 - retries,
				maxRetries: 3,
				delay
			});
				await new Promise((resolve) => setTimeout(resolve, delay));
				continue;
			}
			
			// Non-connection error or max retries reached
			throw err;
		} finally {
			if (client) {
				client.release();
			}
		}
	}
	
	throw new Error('Failed to execute transaction after retries');
}

export async function initializeDatabase(): Promise<void> {
	const pool = getPool();
	
	// Retry logic with exponential backoff
	const maxRetries = 3;
	let lastError: Error | null = null;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		const client = await pool.connect();
		try {
			await client.query('BEGIN');

			// Ensure all tables exist
			await ensureCityTable(client);
			await ensureClusterTable(client);
			await ensureSessionBookingTable(client);
			await ensurePreBookingTable(client);
			await ensureScheduleSlotTable(client);
			await ensureAttendanceRecordTable(client);
			await ensureFranchiseTable(client);
			await ensureZoneTable(client);
			await ensureCoursePurchaseTable(client);
			await ensurePurchaseSessionTable(client);
			await ensureCertificateTable(client);

			await client.query('COMMIT');
			logger.info('Booking service database initialized', { service: 'booking-service' });
			return;
		} catch (error: any) {
			lastError = error instanceof Error ? error : new Error(String(error));
			
			// Check if it's a connection error that might be transient
			const isConnectionError = lastError.message?.includes('Connection terminated') || 
									  lastError.message?.includes('ECONNRESET') ||
									  lastError.message?.includes('ECONNREFUSED') ||
									  (lastError as any).code === 'ECONNRESET' ||
									  (lastError as any).code === 'ECONNREFUSED';
			
			try {
				await client.query('ROLLBACK');
			} catch (rollbackErr) {
				// Ignore rollback errors if connection is already dead
			}
			
			if (attempt < maxRetries && isConnectionError) {
				const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
				logger.warn('Database initialization attempt failed, retrying', { 
				service: 'booking-service',
				attempt,
				maxRetries,
				delay
			});
				await new Promise((resolve) => setTimeout(resolve, delay));
			} else {
				// Final attempt failed or non-connection error
				logger.error('Failed to initialize database after retries', { 
				service: 'booking-service',
				attempts: maxRetries,
				error: lastError.message
			});
				throw lastError;
			}
		} finally {
			client.release();
		}
	}

	// This should never be reached, but TypeScript needs it
	throw lastError || new Error('Failed to initialize database');
}

