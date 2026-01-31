import logger from '@kodingcaravan/shared/config/logger';
import { cleanupExpiredRefreshTokens } from '../models/student.model';

const DEFAULT_INTERVAL_HOURS = 24; // Run daily
const DEFAULT_DAYS_TO_KEEP_REVOKED = 7; // Keep revoked tokens for 7 days for audit

function getNumericEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) {
		return fallback;
	}

	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function runCleanupOnce(daysToKeepRevoked: number): Promise<number> {
	try {
		const deleted = await cleanupExpiredRefreshTokens(daysToKeepRevoked);
		return deleted;
	} catch (error) {
		logger.error('Failed to cleanup expired refresh tokens', { error });
		throw error;
	}
}

export function scheduleRefreshTokenCleanup(): void {
	const flag = (process.env.ENABLE_REFRESH_TOKEN_CLEANUP || 'true').toLowerCase();
	if (flag === 'false' || flag === '0') {
		logger.info('Refresh token cleanup job disabled via configuration');
		return;
	}

	const intervalHours = getNumericEnv(
		'REFRESH_TOKEN_CLEANUP_INTERVAL_HOURS',
		DEFAULT_INTERVAL_HOURS
	);
	const daysToKeepRevoked = getNumericEnv(
		'REFRESH_TOKEN_CLEANUP_DAYS_TO_KEEP_REVOKED',
		DEFAULT_DAYS_TO_KEEP_REVOKED
	);

	const intervalMs = intervalHours * 60 * 60 * 1000;

	const execute = async () => {
		try {
			const totalDeleted = await runCleanupOnce(daysToKeepRevoked);

			if (totalDeleted > 0) {
				logger.info('Refresh token cleanup completed', {
					totalDeleted,
					daysToKeepRevoked,
				});
			}
		} catch (error) {
			logger.error('Failed to cleanup expired refresh tokens', {
				error,
			});
		}
	};

	// Run once on startup without blocking
	void execute();

	setInterval(() => {
		void execute();
	}, intervalMs);

	logger.info('Refresh token cleanup job scheduled', {
		intervalHours,
		daysToKeepRevoked,
	});
}

