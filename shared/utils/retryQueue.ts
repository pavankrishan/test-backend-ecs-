/**
 * Retry Queue Utility
 * Handles retrying failed operations with exponential backoff
 */

import logger from '../config/logger';

export interface RetryJob {
	id: string;
	type: 'enrollment' | 'purchase_creation' | 'trainer_assignment' | 'progress_update';
	payload: Record<string, unknown>;
	retries: number;
	maxRetries: number;
	nextRetryAt: Date;
	createdAt: Date;
	lastError?: string;
}

export interface RetryQueueConfig {
	maxRetries?: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
	backoffMultiplier?: number;
}

import { retryConfig } from '../config/retryConfig';

const DEFAULT_CONFIG: Required<RetryQueueConfig> = {
	maxRetries: retryConfig.maxRetries,
	initialDelayMs: retryConfig.initialDelayMs,
	maxDelayMs: retryConfig.maxDelayMs,
	backoffMultiplier: retryConfig.backoffMultiplier,
};

// In-memory queue (in production, use Redis or database)
const retryQueue: RetryJob[] = [];
const processing = new Set<string>();
const MAX_CONCURRENT_JOBS = retryConfig.maxConcurrentJobs;
const MAX_DEAD_LETTER_SIZE = retryConfig.maxDeadLetterSize;
const MAX_JOB_AGE_MS = retryConfig.maxJobAgeMs;

/**
 * Calculate next retry delay using exponential backoff
 */
function calculateRetryDelay(retryCount: number, config: Required<RetryQueueConfig>): number {
	const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, retryCount);
	return Math.min(delay, config.maxDelayMs);
}

/**
 * Add job to retry queue
 */
export function addToRetryQueue(
	type: RetryJob['type'],
	payload: Record<string, unknown>,
	config: RetryQueueConfig = {}
): string {
	const jobId = `retry_${Date.now()}_${Math.random().toString(36).substring(7)}`;
	const mergedConfig = { ...DEFAULT_CONFIG, ...config };
	
	const job: RetryJob = {
		id: jobId,
		type,
		payload,
		retries: 0,
		maxRetries: mergedConfig.maxRetries,
		nextRetryAt: new Date(Date.now() + mergedConfig.initialDelayMs),
		createdAt: new Date(),
	};

	retryQueue.push(job);
	logger.info('Added job to retry queue', {
		jobId,
		type,
		service: 'retry-queue',
	});

	// Process queue asynchronously
	processRetryQueue().catch((error) => {
		logger.error('Error processing retry queue', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			service: 'retry-queue',
		});
	});

	return jobId;
}

/**
 * Process retry queue
 */
async function processRetryQueue(): Promise<void> {
	// Check concurrency limit
	if (processing.size >= MAX_CONCURRENT_JOBS) {
		return; // Skip if at max concurrency
	}

	const now = new Date();
	const readyJobs = retryQueue.filter(
		(job) => !processing.has(job.id) && job.nextRetryAt <= now && job.retries < job.maxRetries
	);

	// Limit to available concurrency slots
	const availableSlots = MAX_CONCURRENT_JOBS - processing.size;
	const jobsToProcess = readyJobs.slice(0, availableSlots);

	for (const job of jobsToProcess) {
		processing.add(job.id);
		processJob(job).catch((error) => {
			logger.error('Error processing retry job', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				jobId: job.id,
				jobType: job.type,
				service: 'retry-queue',
			});
			processing.delete(job.id);
		});
	}
}

/**
 * Cleanup old jobs and limit queue sizes
 */
function cleanupRetryQueue(): void {
	const now = new Date();
	
	// Remove old jobs that are beyond max age
	const filtered = retryQueue.filter(job => {
		const age = now.getTime() - job.createdAt.getTime();
		return age < MAX_JOB_AGE_MS || job.retries < job.maxRetries;
	});
	
	retryQueue.length = 0;
	retryQueue.push(...filtered);
	
	// Limit dead letter queue size
	if (deadLetterQueue.length > MAX_DEAD_LETTER_SIZE) {
		deadLetterQueue.splice(0, deadLetterQueue.length - MAX_DEAD_LETTER_SIZE);
	}
}

/**
 * Process a single job
 */
async function processJob(job: RetryJob): Promise<void> {
	logger.info('Processing retry job', {
		jobId: job.id,
		jobType: job.type,
		attempt: job.retries + 1,
		maxRetries: job.maxRetries,
		service: 'retry-queue',
	});

	try {
		// Execute the job based on type
		await executeJob(job);

		// Success - remove from queue
		const index = retryQueue.findIndex((j) => j.id === job.id);
		if (index !== -1) {
			retryQueue.splice(index, 1);
		}
		processing.delete(job.id);
		logger.info('Retry job completed successfully', {
			jobId: job.id,
			jobType: job.type,
			service: 'retry-queue',
		});
	} catch (error: any) {
		job.retries++;
		job.lastError = error.message || String(error);

		if (job.retries >= job.maxRetries) {
			// Max retries reached - move to dead letter queue
			logger.error('Retry job failed after max attempts, moving to dead letter queue', {
				jobId: job.id,
				jobType: job.type,
				attempts: job.retries,
				maxRetries: job.maxRetries,
				lastError: job.lastError,
				service: 'retry-queue',
			});
			await addToDeadLetterQueue(job);
			const index = retryQueue.findIndex((j) => j.id === job.id);
			if (index !== -1) {
				retryQueue.splice(index, 1);
			}
			processing.delete(job.id);
		} else {
			// Schedule next retry
			const delay = calculateRetryDelay(job.retries, DEFAULT_CONFIG);
			job.nextRetryAt = new Date(Date.now() + delay);
			logger.info('Retry job scheduled for next attempt', {
				jobId: job.id,
				jobType: job.type,
				delayMs: delay,
				attempt: job.retries + 1,
				maxRetries: job.maxRetries,
				service: 'retry-queue',
			});
			processing.delete(job.id);
		}
	}
}

/**
 * Execute job based on type
 */
async function executeJob(job: RetryJob): Promise<void> {
	const { type, payload } = job;

	switch (type) {
		case 'enrollment':
			await executeEnrollment(payload);
			break;
		case 'purchase_creation':
			await executePurchaseCreation(payload);
			break;
		case 'trainer_assignment':
			await executeTrainerAssignment(payload);
			break;
		case 'progress_update':
			await executeProgressUpdate(payload);
			break;
		default:
			throw new Error(`Unknown job type: ${type}`);
	}
}

/**
 * Execute enrollment job
 */
async function executeEnrollment(payload: Record<string, unknown>): Promise<void> {
	const { studentId, courseId, paymentMetadata } = payload as {
		studentId: string;
		courseId: string;
		paymentMetadata?: Record<string, unknown>;
	};

	if (!studentId || !courseId) {
		throw new Error('Missing required fields: studentId and courseId');
	}

	const studentServiceUrl =
		process.env.STUDENT_SERVICE_URL ||
		`http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.STUDENT_SERVICE_PORT || 3003}`;
	const enrollmentUrl = `${studentServiceUrl}/api/students/${studentId}/progress/${courseId}`;

	const { httpPut, isSuccessResponse } = await import('./httpClient');

	const response = await httpPut(enrollmentUrl, {
		percentage: 0,
		completedLessons: 0,
		totalLessons: 0,
	});

	if (!isSuccessResponse(response.statusCode)) {
		throw new Error(`Enrollment failed with status ${response.statusCode}: ${response.data}`);
	}
}

/**
 * Execute purchase creation job
 */
async function executePurchaseCreation(payload: Record<string, unknown>): Promise<void> {
	const { studentId, courseId, purchaseTier, expiryDate, metadata } = payload as {
		studentId: string;
		courseId: string;
		purchaseTier: number;
		expiryDate?: string;
		metadata?: Record<string, unknown>;
	};

	if (!studentId || !courseId) {
		throw new Error('Missing required fields: studentId and courseId');
	}

	const courseServiceUrl =
		process.env.COURSE_SERVICE_URL ||
		`http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.COURSE_SERVICE_PORT || 3005}`;
	const purchaseUrl = `${courseServiceUrl}/api/v1/purchases`;

	const { httpPost, isSuccessResponse } = await import('./httpClient');

	const response = await httpPost(purchaseUrl, {
		studentId,
		courseId,
		purchaseTier: purchaseTier || 30,
		expiryDate: expiryDate || undefined,
		metadata: metadata || {},
	});

	if (!isSuccessResponse(response.statusCode)) {
		if (response.statusCode === 409) {
			// Purchase already exists - this is okay
			return;
		}
		throw new Error(`Purchase creation failed with status ${response.statusCode}: ${response.data}`);
	}
}

/**
 * Execute trainer assignment job
 */
async function executeTrainerAssignment(payload: Record<string, unknown>): Promise<void> {
	const { studentId, courseId, timeSlot, date } = payload as {
		studentId: string;
		courseId: string;
		timeSlot?: string;
		date?: string;
	};

	if (!studentId || !courseId) {
		throw new Error('Missing required fields: studentId and courseId');
	}

	const adminServiceUrl =
		process.env.ADMIN_SERVICE_URL ||
		`http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.ADMIN_SERVICE_PORT || 3010}`;
	const autoAssignUrl = `${adminServiceUrl}/api/v1/admin/allocations/auto-assign`;

	const { httpPost, isSuccessResponse } = await import('./httpClient');

	const response = await httpPost(autoAssignUrl, {
		studentId,
		courseId,
		timeSlot: timeSlot || '4:00 PM',
		date: date || new Date().toISOString().split('T')[0],
	});

	if (!isSuccessResponse(response.statusCode)) {
		throw new Error(`Trainer assignment failed with status ${response.statusCode}: ${response.data}`);
	}
}

/**
 * Execute progress update job
 */
async function executeProgressUpdate(payload: Record<string, unknown>): Promise<void> {
	const { studentId, courseId, sessionId, status } = payload as {
		studentId: string;
		courseId: string;
		sessionId: string;
		status: string;
	};

	if (!studentId || !courseId || !sessionId) {
		throw new Error('Missing required fields: studentId, courseId, and sessionId');
	}

	const courseServiceUrl =
		process.env.COURSE_SERVICE_URL ||
		`http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.COURSE_SERVICE_PORT || 3005}`;
	const progressUrl = `${courseServiceUrl}/api/v1/students/${studentId}/courses/${courseId}/sessions/${sessionId}/progress`;

	const { httpPut, isSuccessResponse } = await import('./httpClient');

	const response = await httpPut(progressUrl, {
		status,
	});

	if (!isSuccessResponse(response.statusCode)) {
		throw new Error(`Progress update failed with status ${response.statusCode}: ${response.data}`);
	}
}

/**
 * Dead letter queue (for jobs that failed after max retries)
 */
const deadLetterQueue: RetryJob[] = [];

async function addToDeadLetterQueue(job: RetryJob): Promise<void> {
	// Limit dead letter queue size
	if (deadLetterQueue.length >= MAX_DEAD_LETTER_SIZE) {
		deadLetterQueue.shift(); // Remove oldest
	}
	
	deadLetterQueue.push(job);
	logger.error('Job moved to dead letter queue', {
		jobId: job.id,
		jobType: job.type,
		attempts: job.retries,
		lastError: job.lastError,
		service: 'retry-queue',
	});
	// In production, persist to database and send alert
}

/**
 * Get dead letter queue jobs
 */
export function getDeadLetterQueue(): RetryJob[] {
	return [...deadLetterQueue];
}

/**
 * Get retry queue status
 */
export function getRetryQueueStatus(): {
	queueSize: number;
	processing: number;
	deadLetterSize: number;
} {
	return {
		queueSize: retryQueue.length,
		processing: processing.size,
		deadLetterSize: deadLetterQueue.length,
	};
}

// Process queue at configured interval
setInterval(() => {
	processRetryQueue().catch((error) => {
		logger.error('Error in scheduled retry queue processing', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			service: 'retry-queue',
		});
	});
}, retryConfig.processIntervalMs);

// Cleanup old jobs at configured interval
setInterval(() => {
	cleanupRetryQueue();
}, retryConfig.cleanupIntervalMs);

