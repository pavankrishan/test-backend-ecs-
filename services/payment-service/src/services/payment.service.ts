import { AppError, addToRetryQueue, isRecord, httpGet, httpPut, httpPost, parseJsonResponse, isSuccessResponse, createPostgresPool } from '@kodingcaravan/shared';
import { IdempotentEventEmitter } from '@kodingcaravan/shared/events/idempotentEventEmitter';
import type { PurchaseConfirmedEvent } from '@kodingcaravan/shared/events/types';
import type { Pool } from 'pg';
import logger from '@kodingcaravan/shared/config/logger';
import {
	changeCoinWalletBalance,
	ensureCoinWallet,
	findPaymentById,
	findPaymentByProviderPaymentId,
	insertCoinTransaction,
	insertPayment,
	listCoinTransactionsByStudent,
	listPaymentsByStudent,
	type CoinTransactionRecord,
	type CoinWalletRecord,
	type PaymentRecord,
	type PaymentStatus,
	updatePayment,
	getCoinWalletByStudentId,
	getCoinConfiguration,
	getAllCoinConfiguration,
	updateCoinConfiguration,
	type CoinConfigurationRecord,
} from '../models/payment.model';
import { withTransaction } from '../config/database';
import { createPaymentSession, verifyPaymentSignature, getPaymentDetails } from '../utils/paymentGateway';
import { calculateSessionPricing, rupeesToPaise, type SessionPricingConfig } from '../utils/pricing';
// HTTP client utilities imported from shared package

// Coin reward fallback values (used if env vars are not set)
const COURSE_COMPLETION_COIN_FALLBACK = 100;
const REFERRAL_COIN_FALLBACK = 250; // Updated to 250 coins per referral
const REGISTRATION_COIN_FALLBACK = 10; // Default: 10 coins for registration
const COIN_TO_RUPEE_RATE_FALLBACK = 1; // Default: 1 coin = ₹1 discount

function resolveCoinValue(envVar: string | undefined, fallback: number): number {
	if (!envVar) {
		return fallback;
	}
	const parsed = Number(envVar);
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function resolveCoinToRupeeRate(envVar: string | undefined, fallback: number): number {
	if (!envVar) {
		return fallback;
	}
	const parsed = Number(envVar);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Cache for coin configuration (refreshed on updates)
let coinConfigCache: Map<string, number> | null = null;
let coinConfigCacheTime: number = 0;
const COIN_CONFIG_CACHE_TTL = 60000; // 1 minute cache

/**
 * Get coin value from database (with env var and fallback)
 * Priority: Database > Environment Variable > Fallback
 */
async function getCoinValue(key: string, envVar: string | undefined, fallback: number): Promise<number> {
	// Check cache first
	const now = Date.now();
	if (coinConfigCache && (now - coinConfigCacheTime) < COIN_CONFIG_CACHE_TTL) {
		const cached = coinConfigCache.get(key);
		if (cached !== undefined) {
			return cached;
		}
	}

	try {
		const config = await getCoinConfiguration(key);
		if (config && config.value > 0) {
			// Update cache
			if (!coinConfigCache) {
				coinConfigCache = new Map();
			}
			coinConfigCache.set(key, config.value);
			coinConfigCacheTime = now;
			return config.value;
		}
	} catch (error) {
		logger.warn('Failed to get coin config from database', {
			key,
			error: error instanceof Error ? error.message : String(error),
			service: 'payment-service',
		});
	}

	// Fallback to env var
	const envValue = resolveCoinValue(envVar, fallback);
	
	// Update cache with env value
	if (!coinConfigCache) {
		coinConfigCache = new Map();
	}
	coinConfigCache.set(key, envValue);
	coinConfigCacheTime = now;
	
	return envValue;
}

/**
 * Get coin value synchronously (uses cache or fallback)
 * Use this for synchronous operations
 */
function getCoinValueSync(key: string, envVar: string | undefined, fallback: number): number {
	// Check cache
	if (coinConfigCache) {
		const cached = coinConfigCache.get(key);
		if (cached !== undefined) {
			return cached;
		}
	}
	
	// Fallback to env var
	return resolveCoinValue(envVar, fallback);
}

// Course completion coins - configurable via database or COIN_REWARD_COURSE_COMPLETION env var
async function getCourseCompletionCoins(): Promise<number> {
	return getCoinValue('course_completion', process.env.COIN_REWARD_COURSE_COMPLETION, COURSE_COMPLETION_COIN_FALLBACK);
}

// Referral coins - configurable via database or COIN_REWARD_REFERRAL env var
async function getReferralCoins(): Promise<number> {
	return getCoinValue('referral', process.env.COIN_REWARD_REFERRAL, REFERRAL_COIN_FALLBACK);
}

// Registration coins - configurable via database or COIN_REWARD_REGISTRATION env var
async function getRegistrationCoins(): Promise<number> {
	return getCoinValue('registration', process.env.COIN_REWARD_REGISTRATION, REGISTRATION_COIN_FALLBACK);
}

// Coin to rupee conversion rate - configurable via database or COIN_TO_RUPEE_RATE env var
async function getCoinToRupeeRate(): Promise<number> {
	return getCoinValue('coin_to_rupee_rate', process.env.COIN_TO_RUPEE_RATE, COIN_TO_RUPEE_RATE_FALLBACK);
}

// Synchronous versions for backward compatibility (use cache)
const COURSE_COMPLETION_COINS = () => getCoinValueSync('course_completion', process.env.COIN_REWARD_COURSE_COMPLETION, COURSE_COMPLETION_COIN_FALLBACK);
const REFERRAL_COINS = () => getCoinValueSync('referral', process.env.COIN_REWARD_REFERRAL, REFERRAL_COIN_FALLBACK);
const COIN_TO_RUPEE_RATE = () => getCoinValueSync('coin_to_rupee_rate', process.env.COIN_TO_RUPEE_RATE, COIN_TO_RUPEE_RATE_FALLBACK);

export type CreatePaymentInput = {
	studentId: string;
	amountCents: number;
	currency?: string;
	paymentMethod?: string | null;
	description?: string | null;
	metadata?: Record<string, unknown> | null;
};

export type ConfirmPaymentInput = {
	status: Exclude<PaymentStatus, 'initiated'>;
	providerPaymentId?: string;
	provider?: string;
	paymentMethod?: string | null;
	description?: string | null;
	metadata?: Record<string, unknown> | null;
};

export type AwardCoinsInput = {
	studentId: string;
	amount: number;
	type: string;
	referenceId?: string | null;
	description?: string | null;
	metadata?: Record<string, unknown> | null;
};

export type RedeemCoinsInput = {
	studentId: string;
	amount: number;
	reason: string;
	referenceId?: string | null;
	metadata?: Record<string, unknown> | null;
};

export async function createPayment(input: CreatePaymentInput): Promise<{
	payment: PaymentRecord;
	paymentUrl: string | null;
	expiresAt: Date | null;
	orderId?: string;
	keyId?: string;
}> {
	if (input.amountCents <= 0) {
		throw new AppError('Amount must be greater than zero', 400);
	}

	const session = await createPaymentSession({
		studentId: input.studentId,
		amountCents: input.amountCents,
		currency: input.currency ?? 'INR',
		...(input.description ? { description: input.description } : {}),
	});

	const payment = await insertPayment({
		studentId: input.studentId,
		amountCents: input.amountCents,
		currency: input.currency ?? 'INR',
		status: 'initiated',
		paymentMethod: input.paymentMethod ?? null,
		provider: session.provider,
		providerPaymentId: session.providerPaymentId,
		description: input.description ?? null,
		metadata: input.metadata ?? null,
		paymentUrl: session.paymentUrl,
		expiresAt: session.expiresAt,
	});

	const result: {
		payment: PaymentRecord;
		paymentUrl: string | null;
		expiresAt: Date | null;
		orderId?: string;
		keyId?: string;
	} = {
		payment,
		paymentUrl: session.paymentUrl,
		expiresAt: session.expiresAt,
	};
	
	if (session.orderId) {
		result.orderId = session.orderId;
	}
	if (session.keyId) {
		result.keyId = session.keyId;
	}
	
	return result;
}

/**
 * @deprecated Enrollment is no longer needed in production.
 * 
 * PRODUCTION ARCHITECTURE (Enterprise EdTech Pattern):
 * 
 * Student progress is now automatically managed via database triggers:
 * - Progress records are created automatically when tutoring sessions are completed
 * - Progress is read-only and derived from tutoring_sessions table
 * - No manual enrollment step is required
 * 
 * The purchase record is sufficient to:
 * 1. Show the course in student's learning dashboard
 * 2. Enable course structure access
 * 3. Track purchase tier and expiry
 * 4. Trigger trainer auto-assignment
 * 
 * Progress will be automatically initialized when the first session is completed.
 * 
 * This function is kept for backward compatibility but is now a no-op.
 * All enrollment logic has been moved to purchase creation flow.
 */
async function enrollStudentInCourse(studentId: string, courseId: string, paymentMetadata?: Record<string, unknown>): Promise<void> {
	// No-op: Enrollment is deprecated and not needed
	// Progress is auto-generated from tutoring_sessions via database triggers
	// Purchase record creation handles all necessary enrollment logic
	logger.info('Enrollment skipped (deprecated)', {
		studentId,
		courseId,
		service: 'payment-service',
		note: 'Progress auto-generated from sessions',
	});
}

/**
 * Invalidate student cache after purchase creation
 * This ensures purchased courses appear immediately in student screens
 */
async function invalidateStudentCache(studentId: string): Promise<void> {
	try {
		const studentServiceUrl = process.env.STUDENT_SERVICE_URL || 
			`http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.STUDENT_SERVICE_PORT || 3003}`;
		
		const cacheInvalidationUrl = `${studentServiceUrl}/api/students/${studentId}/invalidate-cache`;
		
		// Fire-and-forget cache invalidation (non-blocking)
		httpPost(cacheInvalidationUrl, {}, { timeout: 5000 })
			.then((response) => {
				if (response.statusCode >= 200 && response.statusCode < 300) {
					logger.debug('Successfully invalidated cache for student', {
						studentId,
						service: 'payment-service',
					});
				} else {
					logger.warn('Cache invalidation returned non-success status', {
						studentId,
						statusCode: response.statusCode,
						service: 'payment-service',
					});
				}
			})
			.catch((error) => {
				logger.warn('Cache invalidation failed (non-critical)', {
					studentId,
					error: error instanceof Error ? error.message : String(error),
					service: 'payment-service',
				});
			});
		// Continue without awaiting - cache invalidation is non-critical
	} catch (error: any) {
		// Don't throw - cache invalidation failure shouldn't fail purchase creation
		logger.warn('Failed to invalidate cache for student', {
			studentId,
			error: error?.message || String(error),
			service: 'payment-service',
		});
	}
}

/**
 * Create course purchase record in course structure system
 * This is required for the course to appear in "learnings" and for access control
 */
async function createCoursePurchase(studentId: string, courseId: string, paymentMetadata?: Record<string, unknown>): Promise<void> {
	// Declare variables outside try block for use in catch
	let validTier: number = 30;
	let purchaseMetadata: Record<string, unknown> = {};
	
	logger.info('Starting course purchase creation', {
		studentId,
		courseId,
		hasMetadata: !!paymentMetadata,
		metadataKeys: paymentMetadata ? Object.keys(paymentMetadata) : [],
		service: 'payment-service',
	});
	
	try {
		// Get course service URL
		const courseServiceUrl = process.env.COURSE_SERVICE_URL || 
			`http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.COURSE_SERVICE_PORT || 3005}`;
		
		// Get purchase tier from metadata or default to 30 (full course)
		// Handle both string and number formats
		let purchaseTier: number = 30; // Default to full course (30 sessions)
		
		if (paymentMetadata?.purchaseTier) {
			purchaseTier = typeof paymentMetadata.purchaseTier === 'string' 
				? parseInt(paymentMetadata.purchaseTier, 10) 
				: (paymentMetadata.purchaseTier as number);
		} else if (paymentMetadata?.sessionCount) {
			purchaseTier = typeof paymentMetadata.sessionCount === 'string' 
				? parseInt(paymentMetadata.sessionCount, 10) 
				: (paymentMetadata.sessionCount as number);
		}
		
		// Ensure purchase tier is valid (10, 20, or 30)
		validTier = purchaseTier === 10 || purchaseTier === 20 ? purchaseTier : 30;
		
		const purchaseUrl = `${courseServiceUrl}/api/v1/purchases`;
		

		// Extract startDate from various possible locations in paymentMetadata
		// CRITICAL: Check all possible locations to ensure we get the user-selected start date
		const schedule = paymentMetadata?.schedule as Record<string, unknown> | undefined;
		const extractedStartDate = 
			(schedule?.startDate as string) ||
			(paymentMetadata?.startDate as string) ||
			(schedule?.date as string) ||
			(paymentMetadata?.date as string) ||
			(paymentMetadata?.preferredDate as string) ||
			null;
		
		if (extractedStartDate) {
			logger.info('Extracted start date from payment metadata', {
				extractedStartDate,
				hasScheduleStartDate: !!(schedule?.startDate as string),
				hasMetadataStartDate: !!(paymentMetadata?.startDate as string),
				hasScheduleDate: !!(schedule?.date as string),
				hasMetadataDate: !!(paymentMetadata?.date as string),
				service: 'payment-service',
			});
		} else {
			logger.warn('No start date found in payment metadata, will use default', {
				studentId,
				courseId,
				service: 'payment-service',
			});
		}

		// Prepare metadata with all payment details, ensuring sessionCount and startDate are correctly stored
		purchaseMetadata = {
			...(paymentMetadata || {}),
			// Ensure sessionCount is always stored correctly as a number
			sessionCount: validTier,
			// Preserve original sessionCount from payment if it exists
			originalSessionCount: paymentMetadata?.sessionCount || paymentMetadata?.purchaseTier || validTier,
			// Store startDate at the top level for easy access (source of truth)
			startDate: extractedStartDate,
			// Also ensure schedule.startDate is set if schedule exists
			...(paymentMetadata?.schedule ? {
				schedule: {
					...(paymentMetadata.schedule as Record<string, unknown>),
					startDate: extractedStartDate || ((paymentMetadata.schedule as Record<string, unknown>)?.startDate as string),
					date: extractedStartDate || ((paymentMetadata.schedule as Record<string, unknown>)?.date as string),
				}
			} : {}),
		};

		const response = await httpPost(purchaseUrl, {
			studentId: studentId, // Include in body since route doesn't have it in path
			courseId: courseId,
			purchaseTier: validTier,
			expiryDate: paymentMetadata?.expiryDate || undefined,
			metadata: purchaseMetadata, // Store all payment details
		}, { timeout: 15000 }); // Increased timeout for reliability

		if (isSuccessResponse(response.statusCode)) {
			// Purchase created successfully
			const responseData = parseJsonResponse<any>(response.data);
			const createdPurchase = responseData?.data || responseData;
			
			logger.info('Course purchase created successfully', {
				studentId,
				courseId,
				purchaseTier: validTier,
				responseStatus: response.statusCode,
				purchaseId: createdPurchase?.id || 'unknown',
				hasPurchaseId: !!createdPurchase?.id,
				service: 'payment-service',
			});

			// Verify purchase was actually created by checking response data
			if (!createdPurchase?.id && !createdPurchase?.course_id) {
				logger.warn('Purchase creation response missing purchase ID', {
					responseData,
					studentId,
					courseId,
					service: 'payment-service',
				});
			}

			// NOTE: Cache invalidation is now handled at the caller level (confirmPayment)
			// after purchase creation completes, to ensure proper sequencing
		} else {
			// If purchase already exists (409 conflict), that's okay
			if (response.statusCode === 409) {
				// Purchase already exists (idempotent)
				logger.info('Course purchase already exists (409 conflict - idempotent)', {
					studentId,
					courseId,
					service: 'payment-service',
				});
			} else {
				logger.error('Course purchase creation failed', {
					status: response.statusCode,
					statusText: response.statusMessage,
					error: response.data,
					studentId,
					courseId,
					purchaseTier: validTier,
					courseServiceUrl,
					purchaseUrl,
					service: 'payment-service',
				});
				// Add to retry queue
				addToRetryQueue('purchase_creation', {
					studentId,
					courseId,
					purchaseTier: validTier,
					expiryDate: paymentMetadata?.expiryDate,
					metadata: purchaseMetadata,
				});
			}
		}
	} catch (error: any) {
		logger.error('Exception creating course purchase', {
			error: error.message,
			stack: error.stack,
			studentId,
			courseId,
			purchaseTier: validTier,
			courseServiceUrl: process.env.COURSE_SERVICE_URL || 
				`http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.COURSE_SERVICE_PORT || 3005}`,
			service: 'payment-service',
		});
		// Add to retry queue
		addToRetryQueue('purchase_creation', {
			studentId,
			courseId,
			purchaseTier: validTier,
			expiryDate: paymentMetadata?.expiryDate,
			metadata: purchaseMetadata,
		});
		// Don't throw - purchase creation failure shouldn't fail payment
	}
}

/**
 * DEPRECATED: Automatically assign a trainer to a student after course purchase
 * 
 * PHASE 1 FIX: This function is no longer used.
 * Trainer allocation is now handled by allocation-worker consuming PURCHASE_CREATED events.
 * 
 * This function is kept for reference but should not be called.
 * @deprecated Use event-driven allocation via allocation-worker
 */
async function autoAssignTrainerAfterPurchase_DEPRECATED(studentId: string, courseId: string, paymentMetadata?: Record<string, unknown>): Promise<void> {
	// Declare variables outside try block for use in catch
	let preferredTimeSlot = '4:00 PM';
	let preferredDate = new Date().toISOString().split('T')[0];
	
	try {
		// Get admin service URL
		const adminServiceUrl = process.env.ADMIN_SERVICE_URL || 
			`http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.ADMIN_SERVICE_PORT || 3010}`;
		
		// Get preferred time slot and date from payment metadata or use defaults
		const { isRecord } = await import('@kodingcaravan/shared');
		const metadata = isRecord(paymentMetadata) ? paymentMetadata : {};
		const schedule = isRecord(metadata.schedule) ? metadata.schedule as Record<string, unknown> : {};
		
		preferredTimeSlot = (metadata.timeSlot as string) || 
			(metadata.preferredTimeSlot as string) || 
			(schedule.timeSlot as string) ||
			'4:00 PM'; // Default fallback
		
		// CRITICAL: Extract start date with proper priority
		// Priority: schedule.startDate > schedule.date > metadata.startDate > metadata.date > metadata.preferredDate
		// IMPORTANT: We want the START DATE (when sessions should begin), NOT the purchase date
		const scheduleStartDate = schedule.startDate as string;
		const scheduleDate = schedule.date as string;
		const metadataStartDate = metadata.startDate as string;
		const metadataDate = metadata.date as string;
		const metadataPreferredDate = metadata.preferredDate as string;
		
		preferredDate = scheduleStartDate ||
			scheduleDate ||
			metadataStartDate ||
			metadataDate ||
			metadataPreferredDate ||
			new Date().toISOString().split('T')[0]; // Today's date as fallback
		
		logger.info('Extracted start date for auto-assignment', {
			preferredDate,
			scheduleStartDate: scheduleStartDate || 'not set',
			scheduleDate: scheduleDate || 'not set',
			metadataStartDate: metadataStartDate || 'not set',
			metadataDate: metadataDate || 'not set',
			metadataPreferredDate: metadataPreferredDate || 'not set',
			studentId,
			courseId,
			service: 'payment-service',
		});
		
		const autoAssignUrl = `${adminServiceUrl}/api/v1/admin/allocations/auto-assign`;
		

		const url = new URL(autoAssignUrl);
		const isHttps = url.protocol === 'https:';
		const httpModule = isHttps ? require('https').request : require('http').request;
		
		const requestBody = JSON.stringify({
			studentId,
			courseId,
			timeSlot: preferredTimeSlot,
			date: preferredDate,
			paymentMetadata: paymentMetadata || {}, // Pass payment metadata for upgrade detection
		});

		const response = await new Promise<{ statusCode: number; statusMessage: string; data: string }>((resolve, reject) => {
			const req = httpModule({
				hostname: url.hostname,
				port: url.port || (isHttps ? 443 : 80),
				path: url.pathname,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(requestBody),
				},
			}, (res: any) => {
				let data = '';
				res.on('data', (chunk: any) => {
					data += chunk.toString();
				});
				res.on('end', () => {
					resolve({
						statusCode: res.statusCode || 500,
						statusMessage: res.statusMessage || '',
						data,
					});
				});
			});

			req.on('error', (error: any) => {
				reject(error);
			});

			req.write(requestBody);
			req.end();
		});

		if (response.statusCode >= 200 && response.statusCode < 300) {
			// Auto-assignment successful
		} else {
			logger.warn('Auto-assignment returned non-success status', {
				status: response.statusCode,
				statusText: response.statusMessage,
				error: response.data,
				studentId,
				courseId,
				service: 'payment-service',
			});
			// Add to retry queue
			addToRetryQueue('trainer_assignment', {
				studentId,
				courseId,
				timeSlot: preferredTimeSlot,
				date: preferredDate,
			});
		}
	} catch (error: any) {
		logger.error('Error during auto-assignment', {
			error: error?.message || String(error),
			stack: error?.stack,
			studentId,
			courseId,
			service: 'payment-service',
		});
		// Add to retry queue
		addToRetryQueue('trainer_assignment', {
			studentId,
			courseId,
			timeSlot: preferredTimeSlot,
			date: preferredDate,
		});
		// Don't throw - assignment failure shouldn't fail payment
	}
}

export async function confirmPayment(
	paymentId: string,
	updates: ConfirmPaymentInput
): Promise<PaymentRecord> {
	const existing = await findPaymentById(paymentId);
	if (!existing) {
		throw new AppError('Payment not found', 404);
	}

	// Check if payment is already succeeded
	const isAlreadySucceeded = existing.status === 'succeeded';
	const isBecomingSucceeded = updates.status === 'succeeded' && !isAlreadySucceeded;

	if (isAlreadySucceeded && updates.status === 'succeeded') {
		// Payment already succeeded - check if enrollment is needed
		if (isRecord(existing.metadata)) {
			const courseId = typeof existing.metadata.courseId === 'string' ? existing.metadata.courseId : undefined;
			
			if (courseId) {
				// Note: Enrollment is deprecated - progress is auto-generated from sessions
				// Purchase record is sufficient for course access
				// Progress will be automatically created when first session is completed
				logger.info('Skipping enrollment (deprecated)', {
					studentId: existing.studentId,
					courseId,
					service: 'payment-service',
					note: 'Progress auto-generated',
				});
			}
		}
		return existing;
	}

	if (existing.status === 'succeeded' && updates.status !== 'succeeded') {
		throw new AppError('Payment already marked as succeeded', 409);
	}

		// Merge metadata instead of replacing it to preserve courseId
		let mergedMetadata = existing.metadata;
	if (updates.metadata || existing.metadata) {
		const existingMeta = isRecord(existing.metadata) ? existing.metadata : {};
		const updatesMeta = isRecord(updates.metadata) ? updates.metadata : {};
		mergedMetadata = { ...existingMeta, ...updatesMeta };
	}

	logger.info('Updating payment', {
		paymentId,
		currentStatus: existing.status,
		newStatus: updates.status,
		providerPaymentId: updates.providerPaymentId ?? existing.providerPaymentId,
		service: 'payment-service',
	});

	const next = await updatePayment(paymentId, {
		status: updates.status,
		providerPaymentId: updates.providerPaymentId ?? existing.providerPaymentId,
		provider: updates.provider ?? existing.provider,
		paymentMethod: updates.paymentMethod ?? existing.paymentMethod,
		description: updates.description ?? existing.description,
		metadata: mergedMetadata,
		confirmedAt: updates.status === 'succeeded' ? new Date() : existing.confirmedAt,
		paymentUrl: updates.status === 'succeeded' ? null : existing.paymentUrl,
		expiresAt: updates.status === 'succeeded' ? null : existing.expiresAt,
	});

	if (!next) {
		logger.error('Failed to update payment - updatePayment returned null', {
			paymentId,
			service: 'payment-service',
		});
		throw new AppError('Failed to update payment', 500);
	}

	// Verify the payment was actually updated
	if (next.status !== updates.status) {
		logger.error('Payment status mismatch after update', {
			expected: updates.status,
			actual: next.status,
			paymentId: next.id,
			service: 'payment-service',
		});
		throw new AppError(`Payment status update failed: expected ${updates.status}, got ${next.status}`, 500);
	}

	// Verify the payment was actually updated with correct status
	if (next.status !== updates.status) {
		logger.error('Payment status mismatch after update', {
			expected: updates.status,
			actual: next.status,
			paymentId: next.id,
			service: 'payment-service',
		});
		throw new AppError(`Payment status update failed: expected ${updates.status}, got ${next.status}`, 500);
	}

	logger.info('Payment updated successfully', {
		paymentId: next.id,
		status: next.status,
		confirmedAt: next.confirmedAt,
		providerPaymentId: next.providerPaymentId,
		service: 'payment-service',
	});

	// If payment just became succeeded, handle coin redemption and emit event
	if (isBecomingSucceeded && isRecord(next.metadata)) {
		const courseId = typeof next.metadata.courseId === 'string' ? next.metadata.courseId : undefined;
		const coinsToRedeem = typeof next.metadata.coinsToRedeem === 'number' ? next.metadata.coinsToRedeem : undefined;
		
		// Redeem coins if payment succeeded and coins were requested
		// CRITICAL: This is still synchronous because it's a financial transaction
		// Must complete before payment confirmation returns to ensure coins are deducted
		if (coinsToRedeem && coinsToRedeem > 0) {
			try {
				// Check if coins were already redeemed (idempotency)
				const wallet = await getCoinWalletByStudentId(next.studentId);
				const currentBalance = wallet?.balance ?? 0;
				
				// Only redeem if we haven't already (check transaction history)
				const transactions = await listCoinTransactionsByStudent(next.studentId, { limit: 10 });
				const alreadyRedeemed = transactions.some(
					t => t.referenceId === next.id && t.type === 'redeem' && t.amount < 0
				);
				
				if (!alreadyRedeemed) {
					const sessionCount = typeof next.metadata.sessionCount === 'number' ? next.metadata.sessionCount : undefined;
					const groupSize = typeof next.metadata.groupSize === 'number' ? next.metadata.groupSize : undefined;
					const learningMode = typeof next.metadata.learningMode === 'string' ? next.metadata.learningMode : undefined;
					
					await redeemCoins({
						studentId: next.studentId,
						amount: coinsToRedeem,
						reason: `Payment discount for ${sessionCount || 'sessions'} sessions`,
						referenceId: next.id,
						metadata: {
							paymentId: next.id,
							sessionCount,
							groupSize,
							learningMode,
							courseId: courseId,
						},
					});
				}
			} catch (error: any) {
				logger.error('Failed to redeem coins after payment success', {
					error: error?.message || String(error),
					stack: error?.stack,
					paymentId: next.id,
					studentId: next.studentId,
					service: 'payment-service',
				});
				// Don't fail payment confirmation if coin redemption fails
			}
		}
		
		// ENTERPRISE FLOW: Emit PURCHASE_CONFIRMED event (fire-and-forget)
		// All downstream processing (purchase creation, allocation, sessions) happens asynchronously
		if (courseId) {
			try {
				// Initialize event emitter with shared PostgreSQL pool
				// Use shared pool to ensure same database connection
				const sharedPool = createPostgresPool({
					max: 10,
					connectionTimeoutMillis: 20000,
				}) as unknown as Pool;
				
				const eventEmitter = new IdempotentEventEmitter({
					pool: sharedPool,
					serviceName: process.env.SERVICE_NAME || 'payment-service',
					eventVersion: '1.0.0',
				});

				// Emit PURCHASE_CONFIRMED event
				const event: PurchaseConfirmedEvent = {
					type: 'PURCHASE_CONFIRMED',
					timestamp: Date.now(),
					userId: next.studentId,
					role: 'student',
					paymentId: next.id,
					studentId: next.studentId,
					courseId,
					amountCents: next.amountCents,
					metadata: next.metadata as Record<string, unknown> || {},
				};

				logger.info('Emitting PURCHASE_CONFIRMED event', {
					paymentId: next.id,
					studentId: next.studentId,
					courseId,
					eventType: event.type,
					correlationId: next.id,
					service: 'payment-service',
				});

				// Emit event (idempotent, fire-and-forget)
				// Correlation ID = paymentId (ensures same payment doesn't emit duplicate events)
				await eventEmitter.emit(event, next.id, {
					idempotencyKey: `payment:${next.id}:PURCHASE_CONFIRMED`,
				});

				logger.info('PURCHASE_CONFIRMED event emitted successfully', {
					paymentId: next.id,
					studentId: next.studentId,
					courseId,
					correlationId: next.id,
					service: 'payment-service',
				});

				// NOTE: Purchase creation, trainer allocation, and session creation
				// will be handled by async workers consuming this event.
				// Payment confirmation returns immediately (< 100ms).
			} catch (eventError: any) {
				// Event emission failure should not fail payment confirmation
				// Payment is already confirmed in database
				logger.error('Failed to emit PURCHASE_CONFIRMED event (non-critical)', {
					error: eventError?.message || 'Unknown error',
					stack: eventError?.stack,
					paymentId: next.id,
					studentId: next.studentId,
					courseId,
					service: 'payment-service',
				});
				
				// Fallback: Add to retry queue for manual processing
				// This ensures purchase creation happens even if event emission fails
				addToRetryQueue('purchase_creation', {
					studentId: next.studentId,
					courseId,
					purchaseTier: 30, // Default
					metadata: next.metadata as Record<string, unknown> || {},
				});
			}
		} else {
			logger.warn('Payment succeeded but no courseId in metadata', {
				paymentId: next.id,
				metadata: next.metadata,
				service: 'payment-service',
			});
		}
	}

	return next;
}

export async function getPayment(paymentId: string): Promise<PaymentRecord> {
	const payment = await findPaymentById(paymentId);
	if (!payment) {
		throw new AppError('Payment not found', 404);
	}
	return payment;
}

export async function getPaymentsForStudent(
	studentId: string,
	options: { limit?: number; offset?: number } = {}
): Promise<PaymentRecord[]> {
	return listPaymentsByStudent(studentId, options);
}

export async function getCoinWallet(studentId: string): Promise<CoinWalletRecord> {
	const wallet = await getCoinWalletByStudentId(studentId);
	if (wallet) {
		logger.info('Wallet found for student', {
			studentId,
			balance: wallet.balance,
			service: 'payment-service',
		});
		return wallet;
	}
	logger.info('Wallet not found for student, creating new wallet', {
		studentId,
		service: 'payment-service',
	});
	const newWallet = await ensureCoinWallet(studentId);
	logger.info('Created new wallet for student', {
		studentId,
		balance: newWallet.balance,
		service: 'payment-service',
	});
	return newWallet;
}

export async function getCoinTransactions(
	studentId: string,
	options: { limit?: number; offset?: number } = {}
): Promise<CoinTransactionRecord[]> {
	return listCoinTransactionsByStudent(studentId, options);
}

async function creditCoins(input: AwardCoinsInput): Promise<{
	wallet: CoinWalletRecord;
	transaction: CoinTransactionRecord;
}> {
	if (input.amount <= 0) {
		throw new AppError('Coin amount must be positive', 400);
	}

	return withTransaction(async (client) => {
		const wallet = await ensureCoinWallet(input.studentId, client);
		const updatedWallet = await changeCoinWalletBalance(input.studentId, input.amount, client);
		if (!updatedWallet) {
			throw new AppError('Failed to update wallet balance', 500);
		}

		const transaction = await insertCoinTransaction(
			{
				studentId: input.studentId,
				walletId: wallet.id,
				amount: input.amount,
				type: input.type,
				referenceId: input.referenceId ?? null,
				description: input.description ?? null,
				metadata: input.metadata ?? null,
			},
			client
		);

		return { wallet: updatedWallet, transaction };
	});
}

async function debitCoins(input: RedeemCoinsInput): Promise<{
	wallet: CoinWalletRecord;
	transaction: CoinTransactionRecord;
}> {
	if (input.amount <= 0) {
		throw new AppError('Coin amount must be positive', 400);
	}

	return withTransaction(async (client) => {
		const wallet = await ensureCoinWallet(input.studentId, client);
		const updatedWallet = await changeCoinWalletBalance(input.studentId, -input.amount, client);
		if (!updatedWallet) {
			throw new AppError('Insufficient coin balance', 400);
		}

		const transaction = await insertCoinTransaction(
			{
				studentId: input.studentId,
				walletId: wallet.id,
				amount: -input.amount,
				type: 'redeem',
				referenceId: input.referenceId ?? null,
				description: input.reason,
				metadata: input.metadata ?? null,
			},
			client
		);

		return { wallet: updatedWallet, transaction };
	});
}

export async function awardCoinsForCourseCompletion(input: {
	studentId: string;
	courseId: string;
	coins?: number;
}): Promise<{
	wallet: CoinWalletRecord;
	transaction: CoinTransactionRecord;
}> {
	const amount = input.coins ?? await getCourseCompletionCoins();
	try {
		return await creditCoins({
			studentId: input.studentId,
			amount,
			type: 'course_completion',
			referenceId: input.courseId,
			description: `Coins awarded for completing course ${input.courseId}`,
			metadata: { courseId: input.courseId },
		});
	} catch (error: any) {
		if (error?.code === '23505') {
			throw new AppError('Course completion reward already granted for this course', 409);
		}
		throw error;
	}
}

export async function awardCoinsForReferral(input: {
	studentId: string;
	referredStudentId: string;
	coins?: number;
}): Promise<{
	wallet: CoinWalletRecord;
	transaction: CoinTransactionRecord;
}> {
	const amount = input.coins ?? await getReferralCoins();
	try {
		return await creditCoins({
			studentId: input.studentId,
			amount,
			type: 'referral',
			referenceId: input.referredStudentId,
			description: `Referral reward for inviting ${input.referredStudentId}`,
			metadata: { referredStudentId: input.referredStudentId },
		});
	} catch (error: any) {
		if (error?.code === '23505') {
			throw new AppError('Referral reward already granted for this student', 409);
		}
		throw error;
	}
}

export async function adjustCoins(input: AwardCoinsInput): Promise<{
	wallet: CoinWalletRecord;
	transaction: CoinTransactionRecord;
}> {
	try {
		return await creditCoins(input);
	} catch (error: any) {
		if (error?.code === '23505') {
			throw new AppError('Duplicate coin transaction reference', 409);
		}
		throw error;
	}
}

export async function redeemCoins(input: RedeemCoinsInput): Promise<{
	wallet: CoinWalletRecord;
	transaction: CoinTransactionRecord;
}> {
	return debitCoins(input);
}

export async function getCoinRewardConfiguration() {
	return {
		courseCompletionCoins: await getCourseCompletionCoins(),
		referralCoins: await getReferralCoins(),
		registrationCoins: await getRegistrationCoins(),
		coinToRupeeRate: await getCoinToRupeeRate(),
	};
}

export async function getAllCoinConfigurationFromDB(): Promise<CoinConfigurationRecord[]> {
	return getAllCoinConfiguration();
}

export async function updateCoinConfigurationValue(
	key: string,
	value: number,
	updatedBy?: string | null
): Promise<CoinConfigurationRecord> {
	// Invalidate cache
	coinConfigCache = null;
	coinConfigCacheTime = 0;
	
	return updateCoinConfiguration(key, value, updatedBy);
}

export type CreateSessionBookingPaymentInput = {
	studentId: string;
	sessionCount: 10 | 20 | 30;
	groupSize: 1 | 2 | 3;
	learningMode: 'home' | 'hybrid'; // All are home tutor only, hybrid is half home/half online
	courseId?: string;
	trainerId?: string;
	description?: string;
	metadata?: Record<string, unknown>;
	coinsToRedeem?: number; // Number of coins to redeem (discount rate configurable via COIN_TO_RUPEE_RATE env var)
};

/**
 * Create payment for session booking with pricing calculation and coin redemption
 * Uses pricing from metadata (calculated by frontend using backend pricing API) if available
 */
export async function createSessionBookingPayment(
	input: CreateSessionBookingPaymentInput
): Promise<{
	payment: PaymentRecord;
	paymentUrl: string | null;
	expiresAt: Date | null;
	orderId?: string;
	keyId?: string;
	pricing: ReturnType<typeof calculateSessionPricing>;
	coinsRedeemed?: number;
	coinDiscount?: number;
}> {
	// Check if pricing is provided in metadata (from frontend backend pricing API)
	const metadataPricing = input.metadata?.pricing as any;
	const metadataPricingType = input.metadata?.pricingType as string | undefined;
	const metadataIsSummerPricing = input.metadata?.isSummerPricing as boolean | undefined;
	
	// Log full metadata structure for debugging
	logger.debug('Full metadata structure', {
		hasMetadata: !!input.metadata,
		metadataKeys: input.metadata ? Object.keys(input.metadata) : [],
		hasPricing: !!metadataPricing,
		pricingType: typeof metadataPricing,
		pricingKeys: metadataPricing ? Object.keys(metadataPricing) : [],
		studentId: input.studentId,
		service: 'payment-service',
	});

	let basePrice = 0;
	let subtotal = 0;
	let tax = 0;
	let totalBeforeCoins = 0;

	// Use pricing from metadata if available (calculated by frontend using backend pricing API)
	// IMPORTANT: Pricing is based on CLASS TYPE only, not course. All courses use same pricing by class type.
	// Check if metadata pricing exists (can be string or number, or object with pricing data)
	logger.debug('Checking metadata pricing', {
		hasMetadataPricing: !!metadataPricing,
		metadataPricingType: typeof metadataPricing,
		metadataPricingKeys: metadataPricing ? Object.keys(metadataPricing) : [],
		studentId: input.studentId,
		service: 'payment-service',
	});
	
	const hasMetadataPricing = metadataPricing && (
		typeof metadataPricing === 'object' && (
			typeof metadataPricing.subtotal === 'string' || 
			typeof metadataPricing.total === 'string' ||
			typeof metadataPricing.subtotal === 'number' ||
			typeof metadataPricing.total === 'number' ||
			// Also check for base, tax fields
			typeof metadataPricing.base === 'string' ||
			typeof metadataPricing.tax === 'string'
		)
	);
	
	if (hasMetadataPricing) {
		// Frontend pricing API returns correct pricing (official/summer based on class type)
		// Pricing is class-type based, not course-specific
		basePrice = parseFloat(String(metadataPricing.base || '0'));
		subtotal = parseFloat(String(metadataPricing.subtotal || '0'));
		tax = parseFloat(String(metadataPricing.tax || '0'));
		
		// CRITICAL: Use total from metadata - it already includes welcome offer/coupon discounts
		// Frontend passes total which is the final price after all discounts
		const metadataTotal = parseFloat(String(metadataPricing.total || '0'));
		if (metadataTotal > 0) {
			totalBeforeCoins = metadataTotal;
		} else {
			// Recalculate total from subtotal + tax (fallback)
			totalBeforeCoins = subtotal + tax;
		}
		
		logger.info('Using metadata pricing (class-type based)', {
			basePrice,
			subtotal,
			tax,
			totalBeforeCoins,
			metadataTotal,
			pricingType: metadataPricingType,
			isSummerPricing: metadataIsSummerPricing,
			studentId: input.studentId,
			service: 'payment-service',
			note: 'Pricing is based on class type only, not course-specific',
		});
	} else {
		// Fallback to old pricing calculation (for backward compatibility)
		// WARNING: This uses old session-based pricing. Should not be used if metadata pricing is available.
		logger.warn('No metadata pricing found, using OLD session-based fallback pricing', {
			studentId: input.studentId,
			service: 'payment-service',
		});
		logger.warn('This fallback should not be used - pricing should be class-type based from metadata', {
			studentId: input.studentId,
			service: 'payment-service',
		});
		const pricingConfig: SessionPricingConfig = {
			sessionCount: input.sessionCount,
			groupSize: input.groupSize,
			learningMode: input.learningMode,
		};
		const pricing = calculateSessionPricing(pricingConfig);
		basePrice = pricing.subtotal;
		subtotal = pricing.subtotal;
		tax = 0; // Old pricing doesn't separate tax
		totalBeforeCoins = pricing.finalPrice;
		
		logger.warn('Fallback pricing calculated (OLD METHOD)', {
			basePrice,
			subtotal,
			tax,
			totalBeforeCoins,
			studentId: input.studentId,
			service: 'payment-service',
			warning: 'This is using old session-based pricing. Should use class-type based pricing from metadata instead.',
		});
	}

	// Handle coin redemption
	let coinsToRedeem = input.coinsToRedeem ?? 0;
	let coinDiscount = 0;
	let finalPrice = totalBeforeCoins;

	if (coinsToRedeem > 0) {
		// Get wallet balance
		const wallet = await getCoinWalletByStudentId(input.studentId);
		const availableCoins = wallet?.balance ?? 0;

		// Limit coins to redeem to available balance
		coinsToRedeem = Math.min(coinsToRedeem, availableCoins);

		if (coinsToRedeem > 0) {
			// Calculate discount based on configurable coin-to-rupee rate
			// Default: 1 coin = ₹1 discount (configurable via COIN_TO_RUPEE_RATE env var)
			const coinRate = await getCoinToRupeeRate();
			coinDiscount = coinsToRedeem * coinRate;
			finalPrice = Math.max(0, totalBeforeCoins - coinDiscount);
		} else {
			// No coins available, reset to 0
			coinsToRedeem = 0;
		}
	}

	// Convert final price to paise (cents) for Razorpay
	const amountCents = rupeesToPaise(finalPrice);

	logger.info('Final pricing calculated', {
		totalBeforeCoins,
		coinDiscount,
		finalPrice,
		amountCents,
		amountInRupees: amountCents / 100,
		studentId: input.studentId,
		service: 'payment-service',
	});

	if (amountCents <= 0) {
		throw new AppError('Final amount after coin discount must be greater than zero', 400);
	}

	// Create description
	const description = input.description || 
		`${input.sessionCount} sessions (${input.groupSize === 1 ? '1-on-1' : `1-on-${input.groupSize}`}, ${input.learningMode})${coinsToRedeem > 0 ? ` - ${coinsToRedeem} coins applied` : ''}`;

	// Create payment with correct pricing information
	const result = await createPayment({
		studentId: input.studentId,
		amountCents,
		currency: 'INR',
		description,
		metadata: {
			...input.metadata,
			sessionCount: input.sessionCount,
			groupSize: input.groupSize,
			learningMode: input.learningMode,
			courseId: input.courseId,
			trainerId: input.trainerId,
			coinsToRedeem: coinsToRedeem,
			coinDiscount: coinDiscount,
			// Store pricing information (official/summer pricing from backend)
			pricing: {
				base: String(basePrice),
				subtotal: String(subtotal),
				tax: String(tax),
				total: String(totalBeforeCoins),
				originalPrice: parseFloat(metadataPricing?.originalPrice || String(totalBeforeCoins)) || totalBeforeCoins,
				finalPrice: finalPrice,
				pricingType: metadataPricingType || 'official',
				isSummerPricing: metadataIsSummerPricing || false,
			},
			pricingType: metadataPricingType || 'official',
			isSummerPricing: metadataIsSummerPricing || false,
		},
	});

	// Return pricing info compatible with old return type
	const legacyPricing = {
		basePricePerSession: 0,
		totalSessions: input.sessionCount,
		subtotal: subtotal,
		groupDiscount: 0,
		hybridAdjustment: 0,
		finalPrice: finalPrice,
		pricePerSession: finalPrice / input.sessionCount,
		currency: 'INR',
	};

	return {
		...result,
		orderId: (result as any).orderId ?? undefined,
		keyId: (result as any).keyId ?? undefined,
		pricing: legacyPricing,
		coinsRedeemed: coinsToRedeem,
		coinDiscount,
	};
}

/**
 * Verify and confirm Razorpay payment
 */
export async function verifyAndConfirmRazorpayPayment(
	paymentId: string,
	razorpayOrderId: string,
	razorpayPaymentId: string,
	razorpaySignature: string
): Promise<PaymentRecord> {
	// Verify signature
	const isValid = verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
	if (!isValid) {
		throw new AppError('Invalid payment signature', 400);
	}

	// Fetch payment details from Razorpay
	const razorpayPayment = await getPaymentDetails(razorpayPaymentId);

	// Determine status
	let status: PaymentStatus = 'processing';
	if (razorpayPayment.status === 'captured' || razorpayPayment.status === 'authorized') {
		status = 'succeeded';
	} else if (razorpayPayment.status === 'failed') {
		status = 'failed';
	}

	// Get the payment to check for courseId in metadata
	const payment = await findPaymentById(paymentId);
	
	// Confirm payment
	const confirmedPayment = await confirmPayment(paymentId, {
		status,
		providerPaymentId: razorpayPaymentId,
		provider: 'razorpay',
		paymentMethod: razorpayPayment.method || null,
	});

	// Enrollment is handled in confirmPayment function
	return confirmedPayment;
}

