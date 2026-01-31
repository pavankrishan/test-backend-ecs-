import { subHours } from 'date-fns';
import logger from '@kodingcaravan/shared/config/logger';
import { deleteStaleUnverifiedStudents } from '../models/student.model';

const DEFAULT_INTERVAL_HOURS = 3;
const DEFAULT_THRESHOLD_HOURS = 24;
const DEFAULT_BATCH_SIZE = 500;

function getNumericEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) {
		return fallback;
	}

	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function runCleanupOnce(
	thresholdHours: number,
	batchSize: number
): Promise<number> {
	const cutoff = subHours(new Date(), thresholdHours);
	let totalDeleted = 0;

	while (true) {
		// eslint-disable-next-line no-await-in-loop
		const deleted = await deleteStaleUnverifiedStudents(cutoff, batchSize);
		totalDeleted += deleted;

		if (deleted < batchSize) {
			break;
		}
	}

	return totalDeleted;
}

export function scheduleUnverifiedStudentCleanup(): void {
	const flag = (process.env.ENABLE_UNVERIFIED_CLEANUP || 'true').toLowerCase();
	if (flag === 'false' || flag === '0') {
		logger.info('Unverified student cleanup job disabled via configuration');
		return;
	}

	const intervalHours = getNumericEnv(
		'UNVERIFIED_CLEANUP_INTERVAL_HOURS',
		DEFAULT_INTERVAL_HOURS
	);
	const thresholdHours = getNumericEnv(
		'UNVERIFIED_CLEANUP_THRESHOLD_HOURS',
		DEFAULT_THRESHOLD_HOURS
	);
	const batchSize = getNumericEnv(
		'UNVERIFIED_CLEANUP_BATCH_SIZE',
		DEFAULT_BATCH_SIZE
	);

	const intervalMs = intervalHours * 60 * 60 * 1000;

	const execute = async () => {
		try {
			const totalDeleted = await runCleanupOnce(thresholdHours, batchSize);

			if (totalDeleted > 0) {
				logger.info('Unverified student cleanup removed accounts', {
					totalDeleted,
					thresholdHours,
					batchSize,
				});
			}
		} catch (error) {
			logger.error('Failed to cleanup stale unverified student accounts', {
				error,
			});
		}
	};

	// Run once on startup without blocking.
	void execute();

	setInterval(() => {
		void execute();
	}, intervalMs);

	logger.info('Unverified student cleanup job scheduled', {
		intervalHours,
		thresholdHours,
		batchSize,
	});
}

