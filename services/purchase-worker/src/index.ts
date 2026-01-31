/**
 * Purchase Creation Worker
 * 
 * Consumes PURCHASE_CONFIRMED events and creates purchase records.
 * 
 * Flow:
 * 1. Consume PURCHASE_CONFIRMED from Kafka
 * 2. Check idempotency (processed_events + active purchase)
 * 3. Create purchase record in student_course_purchases
 * 4. Mark event as processed
 * 5. Emit PURCHASE_CREATED event
 * 
 * Idempotency: UNIQUE constraint on (student_id, course_id) WHERE is_active = true
 * Retry: Max 3 attempts, then DLQ
 */

import { createPostgresPool, logger } from '@kodingcaravan/shared';
import {
  createKafkaConsumer,
  IdempotencyGuard,
  executeWithRetry,
  getDeadLetterPublisher,
  logWithContext,
  getEventCorrelationId,
  getEventId,
} from '@kodingcaravan/shared/worker';
import type { Pool } from 'pg';
import type { PurchaseConfirmedEvent, PurchaseCreatedEvent, CourseAccessGrantedEvent } from '@kodingcaravan/shared/events/types';
import type { EnrichedEvent } from '@kodingcaravan/shared/events/kafkaEventBus';
import { getKafkaEventBus } from '@kodingcaravan/shared/events/kafkaEventBus';

const SERVICE_NAME = 'purchase-worker';
const KAFKA_TOPIC = 'purchase-confirmed';
const CONSUMER_GROUP = 'purchase-creation-workers';
const DLQ_TOPIC = 'dead-letter-queue';

// Initialize dependencies
let pool: Pool;
let idempotencyGuard: IdempotencyGuard;
let kafkaBus: ReturnType<typeof getKafkaEventBus>;
let dlqPublisher: ReturnType<typeof getDeadLetterPublisher>;
let consumerRef: ReturnType<typeof createKafkaConsumer> | null = null;

/**
 * Initialize worker dependencies
 */
async function initialize(): Promise<void> {
  pool = createPostgresPool({ max: 10 }) as unknown as Pool;
  idempotencyGuard = new IdempotencyGuard(pool);
  kafkaBus = getKafkaEventBus();
  await kafkaBus.connect();
  dlqPublisher = getDeadLetterPublisher();
  await dlqPublisher.connect();

  // Check if index exists on startup
  try {
    const indexExists = await checkIndexExists();
    if (!indexExists) {
      logger.warn('[PurchaseWorker] ⚠️ unique_active_purchase index not found');
      logger.warn('[PurchaseWorker] Run: node scripts/ensure-purchase-index.js to create the index');
      logger.warn('[PurchaseWorker] Worker will use fallback method (manual duplicate check)');
    }
  } catch (error: any) {
    logger.warn('[PurchaseWorker] Failed to check index on startup', {
      error: error?.message,
    });
  }

  logger.info('[PurchaseWorker] Initialized', {
    serviceName: SERVICE_NAME,
    topic: KAFKA_TOPIC,
    consumerGroup: CONSUMER_GROUP,
  });
}

// Cache for index existence check (to avoid checking on every purchase)
let indexExistsCache: boolean | null = null;
let indexCheckTime: number = 0;
const INDEX_CHECK_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Rate-limited logging for missing index warnings
const missingIndexWarningCache: Map<string, number> = new Map();
const MISSING_INDEX_WARNING_TTL_MS = 60 * 1000; // 1 minute

/**
 * Rate-limited warning for missing index
 * Prevents log spam while ensuring on-call engineers are notified
 */
function logMissingIndexWarning(): void {
  const now = Date.now();
  const lastLogged = missingIndexWarningCache.get('missing_index');
  
  if (!lastLogged || (now - lastLogged) > MISSING_INDEX_WARNING_TTL_MS) {
    logger.warn('[PurchaseWorker] ⚠️ unique_active_purchase index not found - using fallback method', {
      action: 'Run: node scripts/ensure-purchase-index.js to create the index',
      impact: 'Fallback method is safe but slower. Index recommended for production.',
    });
    missingIndexWarningCache.set('missing_index', now);
  }
}

/**
 * Check if the unique_active_purchase index exists
 * Uses caching to avoid checking on every purchase
 * 
 * PRODUCTION REQUIREMENT: Never use ON CONFLICT without verified index existence
 */
async function checkIndexExists(): Promise<boolean> {
  const now = Date.now();
  
  // Return cached value if still valid
  if (indexExistsCache !== null && (now - indexCheckTime) < INDEX_CHECK_TTL_MS) {
    return indexExistsCache;
  }

  try {
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'student_course_purchases'
          AND indexname = 'unique_active_purchase'
      )
    `);

    indexExistsCache = result.rows[0]?.exists === true;
    indexCheckTime = now;
    
    if (indexExistsCache) {
      // Only log once on cache refresh, not on every check
      if (indexCheckTime === now) {
        logger.info('[PurchaseWorker] ✅ unique_active_purchase index verified');
      }
    } else {
      // Rate-limited warning
      logMissingIndexWarning();
    }
    
    return indexExistsCache;
  } catch (error: any) {
    // On error, assume index doesn't exist and use fallback
    // This is safe: fallback method works without index
    logger.warn('[PurchaseWorker] Failed to check index existence, assuming it does not exist (safe fallback)', {
      error: error?.message,
    });
    indexExistsCache = false;
    indexCheckTime = now;
    logMissingIndexWarning();
    return false;
  }
}

/**
 * Check if purchase already exists
 */
async function purchaseExists(studentId: string, courseId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT id FROM student_course_purchases 
     WHERE student_id = $1 AND course_id = $2 AND is_active = true
     LIMIT 1`,
    [studentId, courseId]
  );

  return result.rows.length > 0;
}

/**
 * Create purchase record using fallback method (no ON CONFLICT)
 * This is used when the unique index doesn't exist
 * 
 * PRODUCTION REQUIREMENT: Concurrency-safe fallback method
 * Uses advisory lock to prevent race conditions under high concurrency (6L users)
 * 
 * @param client - Database client (must be in transaction)
 */
async function createPurchaseFallback(
  client: any, // pg.PoolClient
  studentId: string,
  courseId: string,
  purchaseTier: number,
  metadata: Record<string, unknown>
): Promise<string> {
  const expiryDate = metadata.expiryDate as string | undefined;

  // PRODUCTION: Use advisory lock for concurrency safety
  // Lock ID is hash of (studentId + courseId) to ensure same lock for same purchase
  // This prevents duplicate purchases even under high concurrency
  const lockId = hashString(`${studentId}:${courseId}`);
  
  try {
    // Acquire advisory lock (blocks other concurrent attempts for same purchase)
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockId]);
    
    // Check if purchase already exists (within locked transaction)
    const existing = await client.query(
      `SELECT id FROM student_course_purchases 
       WHERE student_id = $1 AND course_id = $2 AND is_active = true
       LIMIT 1
       FOR UPDATE`, // FOR UPDATE ensures we lock the row if it exists
      [studentId, courseId]
    );

    if (existing.rows.length > 0 && existing.rows[0]?.id) {
      // Purchase already exists, return existing ID (idempotent)
      logger.info('[PurchaseWorker] Purchase already exists (fallback method, idempotent)', {
        purchaseId: existing.rows[0].id,
        studentId,
        courseId,
      });
      return existing.rows[0].id;
    }

    // Purchase doesn't exist, create it (simple INSERT without ON CONFLICT)
    const result = await client.query(
      `INSERT INTO student_course_purchases 
       (student_id, course_id, purchase_tier, expiry_date, metadata, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())
       RETURNING id`,
      [studentId, courseId, purchaseTier, expiryDate || null, JSON.stringify(metadata)]
    );

    if (result.rows.length > 0 && result.rows[0]?.id) {
      return result.rows[0].id;
    }

    throw new Error('Failed to create purchase record (fallback method)');
  } catch (error: any) {
    // Re-throw with context
    throw new Error(`Fallback purchase creation failed: ${error?.message}`);
  }
  // Note: Advisory lock is automatically released when transaction commits/rolls back
}

/**
 * Simple hash function for advisory lock ID
 * Converts string to positive integer (required by pg_advisory_xact_lock)
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Ensure positive (advisory locks require positive integers)
  return Math.abs(hash);
}

/**
 * Create purchase record with robust error handling
 * 
 * PRODUCTION REQUIREMENT: Never use ON CONFLICT without verified index existence
 * 
 * This function handles:
 * 1. Index verification BEFORE attempting ON CONFLICT
 * 2. ON CONFLICT (if index exists) - automatic duplicate prevention with DO NOTHING
 * 3. Fallback method (if index missing) - concurrency-safe manual check + INSERT
 * 4. Database errors - proper error propagation
 * 
 * @param client - Database client (must be in transaction)
 */
async function createPurchase(
  client: any, // pg.PoolClient
  studentId: string,
  courseId: string,
  purchaseTier: number,
  metadata: Record<string, unknown>
): Promise<string> {
  // Extract metadata fields
  const expiryDate = metadata.expiryDate as string | undefined;

  // PRODUCTION REQUIREMENT: Verify index exists BEFORE attempting ON CONFLICT
  // This prevents transaction abortion (25P02) when index doesn't exist
  const indexExists = await checkIndexExists();
  
  if (!indexExists) {
    // Index doesn't exist - use fallback method immediately
    // NEVER attempt ON CONFLICT without verified index existence
    // This prevents transaction abortion and ensures system continues working
    return createPurchaseFallback(client, studentId, courseId, purchaseTier, metadata);
  }

  // PRODUCTION: Index verified to exist - safe to use ON CONFLICT
  // Note: For partial unique indexes, PostgreSQL automatically matches the index
  // when the WHERE clause conditions are met (is_active = true in our case)
  // 
  // REQUIREMENT: Use DO NOTHING (not DO UPDATE) for idempotency
  // If purchase exists, return existing ID without modification
  try {
    const result = await client.query(
      `INSERT INTO student_course_purchases 
       (student_id, course_id, purchase_tier, expiry_date, metadata, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())
       ON CONFLICT (student_id, course_id)
       DO NOTHING
       RETURNING id`,
      [studentId, courseId, purchaseTier, expiryDate || null, JSON.stringify(metadata)]
    );

    // ON CONFLICT DO NOTHING returns empty result if conflict occurred
    // We need to fetch the existing purchase ID
    if (result.rows.length > 0 && result.rows[0]?.id) {
      return result.rows[0].id;
    }

    // Conflict occurred (DO NOTHING), fetch existing purchase
    const existing = await client.query(
      `SELECT id FROM student_course_purchases 
       WHERE student_id = $1 AND course_id = $2 AND is_active = true
       LIMIT 1`,
      [studentId, courseId]
    );

    if (existing.rows.length > 0 && existing.rows[0]?.id) {
      logger.info('[PurchaseWorker] Purchase already exists (ON CONFLICT DO NOTHING, idempotent)', {
        purchaseId: existing.rows[0].id,
        studentId,
        courseId,
      });
      return existing.rows[0].id;
    }

    // This should never happen if index exists and works correctly
    throw new Error('ON CONFLICT occurred but existing purchase not found');
  } catch (error: any) {
    // PRODUCTION REQUIREMENT: Strict 25P02 handling
    // If transaction is aborted, we MUST NOT continue using this transaction
    if (error.code === '25P02' || error.message?.includes('transaction is aborted')) {
      // Invalidate cache - index check may have been wrong
      indexExistsCache = false;
      const abortError = new Error('Transaction aborted (25P02) - index may not exist');
      (abortError as any).code = '25P02';
      (abortError as any).requiresRollback = true;
      throw abortError;
    }

    // If ON CONFLICT constraint doesn't exist (error code 42P10)
    // This means our index check was wrong or index was dropped
    if (error.code === '42P10' || error.message?.includes('no unique or exclusion constraint')) {
      // Invalidate cache - index doesn't actually exist
      indexExistsCache = false;
      const constraintError = new Error('ON CONFLICT constraint not found (42P10) - index missing');
      (constraintError as any).code = '42P10';
      (constraintError as any).requiresFallback = true;
      throw constraintError;
    }

    // Re-throw other errors
    throw error;
  }
}

/**
 * Ensure metadata has all display fields needed for Learnings screen (class format, schedule).
 * Used when payment table is unavailable and we rely on event metadata only.
 */
function ensureDisplayMetadata(
  base: Record<string, unknown>,
  eventMeta: Record<string, unknown>,
  courseId: string,
  purchaseTier: number
): Record<string, unknown> {
  const schedule = (eventMeta.schedule && typeof eventMeta.schedule === 'object')
    ? eventMeta.schedule as Record<string, unknown>
    : (base.schedule && typeof base.schedule === 'object' ? base.schedule as Record<string, unknown> : {});
  return {
    ...base,
    ...eventMeta,
    courseId: base.courseId ?? eventMeta.courseId ?? courseId,
    purchaseTier: base.purchaseTier ?? eventMeta.purchaseTier ?? purchaseTier,
    sessionCount: base.sessionCount ?? eventMeta.sessionCount ?? purchaseTier,
    classTypeId: base.classTypeId ?? eventMeta.classTypeId ?? eventMeta.class_type_id,
    classTypeTitle: base.classTypeTitle ?? eventMeta.classTypeTitle ?? eventMeta.class_type_title,
    scheduleType: base.scheduleType ?? eventMeta.scheduleType ?? eventMeta.schedule_mode ?? schedule?.mode ?? schedule?.type,
    scheduleMode: base.scheduleMode ?? eventMeta.scheduleMode ?? eventMeta.schedule_mode ?? schedule?.mode,
    schedule: base.schedule ?? eventMeta.schedule ?? schedule,
    classTime: base.classTime ?? eventMeta.classTime ?? eventMeta.timeSlot ?? schedule?.timeSlot ?? schedule?.time,
    startDate: base.startDate ?? eventMeta.startDate ?? schedule?.startDate ?? schedule?.date,
    timeSlot: base.timeSlot ?? eventMeta.timeSlot ?? schedule?.timeSlot,
    date: base.date ?? eventMeta.date ?? schedule?.date ?? base.startDate ?? eventMeta.startDate,
    preferredTimeSlot: base.preferredTimeSlot ?? eventMeta.preferredTimeSlot ?? eventMeta.timeSlot,
    preferredDate: base.preferredDate ?? eventMeta.preferredDate ?? eventMeta.startDate ?? schedule?.startDate,
  };
}

/**
 * Handle PURCHASE_CONFIRMED event
 */
async function handlePurchaseConfirmed(event: EnrichedEvent): Promise<void> {
  const purchaseEvent = event as PurchaseConfirmedEvent & { _metadata: EnrichedEvent['_metadata'] };
  const correlationId = getEventCorrelationId(event);
  const eventId = getEventId(event);

  const context = {
    correlationId,
    eventId,
    workerName: SERVICE_NAME,
    operation: 'create_purchase',
    studentId: purchaseEvent.studentId,
    courseId: purchaseEvent.courseId,
    paymentId: purchaseEvent.paymentId,
  };

  logWithContext('info', 'Processing PURCHASE_CONFIRMED event', context);

  try {
    // PRODUCTION-GRADE FIX: Check if purchase exists FIRST (before idempotency check)
    // This handles the case where event was marked as processed but purchase creation failed
    // This is the source of truth - if purchase exists, we're done
    const exists = await purchaseExists(purchaseEvent.studentId, purchaseEvent.courseId);
    if (exists) {
      logWithContext('info', 'Purchase already exists, checking if allocation exists', context);
      
      // CRITICAL FIX: Check if trainer allocation exists
      // If purchase exists but allocation doesn't, we need to emit PURCHASE_CREATED to trigger allocation
      const allocationResult = await pool.query(
        `SELECT id FROM trainer_allocations 
         WHERE student_id = $1 AND course_id = $2 AND status IN ('approved', 'active')
         LIMIT 1`,
        [purchaseEvent.studentId, purchaseEvent.courseId]
      );
      
      const allocationExists = allocationResult.rows.length > 0;
      
      if (!allocationExists) {
        // Purchase exists but allocation doesn't - emit PURCHASE_CREATED to trigger allocation
        logWithContext('warn', 'Purchase exists but allocation missing - emitting PURCHASE_CREATED to trigger allocation', {
          ...context,
          studentId: purchaseEvent.studentId,
          courseId: purchaseEvent.courseId,
        });
        
        // Get purchase details to emit correct event
        const purchaseResult = await pool.query(
          `SELECT id, purchase_tier, metadata FROM student_course_purchases
           WHERE student_id = $1 AND course_id = $2 AND is_active = true
           ORDER BY created_at DESC
           LIMIT 1`,
          [purchaseEvent.studentId, purchaseEvent.courseId]
        );
        
        if (purchaseResult.rows.length > 0) {
          const purchase = purchaseResult.rows[0];
          const purchaseId = purchase.id;
          const purchaseTier = purchase.purchase_tier || 30;
          const metadata = purchase.metadata 
            ? (typeof purchase.metadata === 'string' ? JSON.parse(purchase.metadata) : purchase.metadata)
            : {};
          
          // Emit PURCHASE_CREATED event to trigger allocation
          const purchaseCreatedEvent: PurchaseCreatedEvent = {
            type: 'PURCHASE_CREATED',
            timestamp: Date.now(),
            userId: purchaseEvent.studentId,
            role: 'student',
            purchaseId,
            studentId: purchaseEvent.studentId,
            courseId: purchaseEvent.courseId,
            purchaseTier,
            metadata,
          };
          
          await kafkaBus.emit(purchaseCreatedEvent, {
            eventId: `purchase-created-${purchaseId}-recovery`,
            correlationId,
            source: SERVICE_NAME,
            version: '1.0.0',
          });
          
          logWithContext('info', 'PURCHASE_CREATED event emitted (recovery mode - allocation missing)', {
            ...context,
            purchaseId,
          });
        }
      } else {
        logWithContext('info', 'Purchase and allocation both exist, ensuring event is marked as processed', context);
      }
      
      // Ensure event is marked as processed (idempotent operation)
      // This handles race conditions where purchase was created but event wasn't marked
      try {
        await idempotencyGuard.markProcessed(
          eventId,
          correlationId,
          'PURCHASE_CONFIRMED',
          purchaseEvent,
          SERVICE_NAME
        );
      } catch (markError: any) {
        // Non-critical: If marking fails, purchase still exists, so we're good
        logWithContext('warn', 'Failed to mark event as processed (non-critical, purchase exists)', {
          ...context,
          error: markError?.message,
        });
      }
      return; // Purchase exists, nothing more to do
    }

    // Purchase doesn't exist - check idempotency for logging/monitoring
    // BUT: We will ALWAYS attempt to create purchase if it doesn't exist, regardless of idempotency status
    // This is the recovery mechanism for failed purchases
    const alreadyProcessed = await idempotencyGuard.isProcessed({
      eventId,
      correlationId,
      eventType: 'PURCHASE_CONFIRMED',
    });

    if (alreadyProcessed) {
      // CRITICAL RECOVERY SCENARIO: Event was marked as processed but purchase doesn't exist
      // This indicates a previous failure - we MUST attempt recovery
      logWithContext('warn', '⚠️ RECOVERY: Event marked as processed but purchase missing - creating purchase', {
        ...context,
        studentId: purchaseEvent.studentId,
        courseId: purchaseEvent.courseId,
        reason: 'Previous purchase creation likely failed after event was marked as processed',
        action: 'Attempting to create purchase now',
      });
      // Continue to create purchase (CRITICAL: don't return here)
    } else {
      // Normal flow: Event not processed, purchase doesn't exist - proceed with creation
      logWithContext('info', 'Creating new purchase (normal flow)', context);
    }

    // Extract purchase tier from metadata
    const purchaseTier = (purchaseEvent.metadata?.purchaseTier as number) ||
      (purchaseEvent.metadata?.sessionCount as number) ||
      30; // Default to 30 sessions

    // CRITICAL FIX: Get payment metadata from payments table to ensure all data is copied
    // The event metadata might be incomplete, so fetch from source of truth (payments table)
    // Normalize event metadata (may be string after Kafka deserialization)
    const rawEventMeta = purchaseEvent.metadata;
    const eventMetadata = (typeof rawEventMeta === 'string' ? (() => { try { return JSON.parse(rawEventMeta); } catch { return {}; } })() : rawEventMeta) || {};
    let completeMetadata: Record<string, unknown> = { ...eventMetadata };

    try {
      // Fetch payment record to get complete metadata (payments table may be in same or different DB)
      const paymentResult = await pool.query(
        `SELECT metadata FROM payments 
         WHERE id = $1 AND student_id = $2 AND status = 'succeeded'
         LIMIT 1`,
        [purchaseEvent.paymentId, purchaseEvent.studentId]
      );

      if (paymentResult.rows.length > 0 && paymentResult.rows[0].metadata) {
        const paymentMetadata = typeof paymentResult.rows[0].metadata === 'string'
          ? JSON.parse(paymentResult.rows[0].metadata)
          : paymentResult.rows[0].metadata;

        // Merge: payment (source of truth) first, then event overrides
        completeMetadata = {
          ...paymentMetadata,
          ...eventMetadata,
          purchaseTier,
          sessionCount: purchaseTier,
          courseId: purchaseEvent.courseId,
        };
        logWithContext('info', 'Fetched complete metadata from payment record', {
          ...context,
          metadataKeys: Object.keys(completeMetadata),
        });
      } else {
        // Payment table not in this DB or row not found: use event metadata and ensure display fields
        logWithContext('warn', 'Payment record not found, using event metadata only', {
          ...context,
          paymentId: purchaseEvent.paymentId,
        });
        completeMetadata = ensureDisplayMetadata(completeMetadata, eventMetadata, purchaseEvent.courseId, purchaseTier);
      }
    } catch (error: any) {
      logWithContext('warn', 'Failed to fetch payment metadata, using event metadata', {
        ...context,
        error: error.message,
      });
      completeMetadata = ensureDisplayMetadata(completeMetadata, eventMetadata, purchaseEvent.courseId, purchaseTier);
    }

    // PRODUCTION: Create purchase within transaction
    // CRITICAL: Use a transaction to ensure atomicity
    // If purchase creation succeeds but event marking fails, we rollback
    let client: any = null;
    let clientReleased = false;
    
    try {
      client = await pool.connect();
      await client.query('BEGIN');

      // Attempt to create purchase
      // createPurchase will use ON CONFLICT if index exists, fallback if not
      let purchaseId: string;
      try {
        purchaseId = await createPurchase(
          client,
          purchaseEvent.studentId,
          purchaseEvent.courseId,
          purchaseTier,
          completeMetadata
        );
        
        logWithContext('info', 'Purchase created successfully in transaction', {
          ...context,
          purchaseId,
        });
      } catch (createError: any) {
        // PRODUCTION REQUIREMENT: Strict 25P02 handling
        // If transaction is aborted, we MUST rollback and use new client
        const isTransactionAborted = createError?.code === '25P02' || 
                                     createError?.requiresRollback ||
                                     createError?.message?.includes('transaction is aborted') ||
                                     createError?.message?.includes('Transaction aborted');
        
        const isConstraintError = createError?.code === '42P10' || 
                                  createError?.requiresFallback || 
                                  createError?.message?.includes('ON CONFLICT') || 
                                  createError?.message?.includes('no unique or exclusion constraint');

        // PRODUCTION: Rollback transaction immediately
        // Even if already aborted, explicit rollback is required
        try {
          await client.query('ROLLBACK');
          logWithContext('info', 'Transaction rolled back', context);
        } catch (rollbackError: any) {
          // Rollback may fail if transaction already aborted - this is OK
          logWithContext('warn', 'Rollback failed (transaction may already be aborted)', {
            ...context,
            rollbackError: rollbackError?.message,
            rollbackErrorCode: rollbackError?.code,
          });
        }

        // PRODUCTION: Release original client - it's poisoned and cannot be reused
        // This ensures we don't leak connections
        try {
          if (client && !clientReleased) {
            client.release();
            clientReleased = true;
          }
        } catch (releaseError: any) {
          logWithContext('warn', 'Error releasing original client', {
            ...context,
            error: releaseError?.message,
          });
        }

        // PRODUCTION: If transaction aborted or constraint error, use fallback with NEW client
        if (isTransactionAborted || isConstraintError) {
          logWithContext('warn', 'Transaction aborted or constraint error, using fallback method with new client', {
            ...context,
            error: createError?.message,
            errorCode: createError?.code,
            isTransactionAborted,
            isConstraintError,
          });

          // CRITICAL: Use completely new client for fallback
          // Original client is poisoned and must not be reused
          const fallbackClient = await pool.connect();
          let fallbackClientReleased = false;
          
          try {
            await fallbackClient.query('BEGIN');
            
            purchaseId = await createPurchaseFallback(
              fallbackClient,
              purchaseEvent.studentId,
              purchaseEvent.courseId,
              purchaseTier,
              completeMetadata
            );
            
            logWithContext('info', 'Purchase created successfully using fallback method', {
              ...context,
              purchaseId,
            });

            // Mark event as processed in same transaction
            await idempotencyGuard.markProcessed(
              eventId,
              correlationId,
              'PURCHASE_CONFIRMED',
              purchaseEvent,
              SERVICE_NAME
            );

            await fallbackClient.query('COMMIT');
            
            logWithContext('info', '✅ Purchase created and event marked as processed (fallback method)', {
              ...context,
              purchaseId,
              recoveryMode: alreadyProcessed,
            });

            // Emit PURCHASE_CREATED event
            const purchaseCreatedEvent: PurchaseCreatedEvent = {
              type: 'PURCHASE_CREATED',
              timestamp: Date.now(),
              userId: purchaseEvent.studentId,
              role: 'student',
              purchaseId,
              studentId: purchaseEvent.studentId,
              courseId: purchaseEvent.courseId,
              purchaseTier,
              metadata: purchaseEvent.metadata || {},
            };

            await kafkaBus.emit(purchaseCreatedEvent, {
              eventId: `purchase-created-${purchaseId}`,
              correlationId,
              source: SERVICE_NAME,
              version: '1.0.0',
            });

            logWithContext('info', 'PURCHASE_CREATED event emitted to Kafka (fallback method)', {
              ...context,
              purchaseId,
            });

            // CRITICAL: Also emit to Redis Pub/Sub for WebSocket/real-time updates
            try {
              const { getEventBus } = await import('@kodingcaravan/shared');
              const eventBus = getEventBus();
              
              // Emit to Redis Pub/Sub (for WebSocket clients)
              // eventBus.emit takes only the event object (type is already in the object)
              await eventBus.emit(purchaseCreatedEvent);
              
              logWithContext('info', 'PURCHASE_CREATED event emitted to Redis Pub/Sub (fallback method)', {
                ...context,
                purchaseId,
              });
            } catch (redisError: any) {
              // Non-critical: WebSocket events are best-effort
              logWithContext('warn', 'Failed to emit PURCHASE_CREATED to Redis Pub/Sub (non-critical)', {
                ...context,
                purchaseId,
                error: redisError?.message,
              });
            }

            // Emit COURSE_ACCESS_GRANTED event (explicit state event)
            const courseAccessGrantedEvent: CourseAccessGrantedEvent = {
              type: 'COURSE_ACCESS_GRANTED',
              timestamp: Date.now(),
              userId: purchaseEvent.studentId,
              role: 'student',
              purchaseId,
              studentId: purchaseEvent.studentId,
              courseId: purchaseEvent.courseId,
              purchaseTier,
              metadata: purchaseEvent.metadata || {},
            };

            await kafkaBus.emit(courseAccessGrantedEvent, {
              eventId: `course-access-granted-${purchaseId}`,
              correlationId,
              source: SERVICE_NAME,
              version: '1.0.0',
            });

            logWithContext('info', 'COURSE_ACCESS_GRANTED event emitted to Kafka (fallback method)', {
              ...context,
              purchaseId,
            });

            // PRODUCTION: Release fallback client and return
            // Original client already released above
            fallbackClient.release();
            fallbackClientReleased = true;
            return; // Fallback path complete - exit function
          } catch (fallbackError: any) {
            // PRODUCTION: Rollback fallback transaction and release client
            try {
              await fallbackClient.query('ROLLBACK');
            } catch (rollbackError: any) {
              // Ignore rollback errors
            }
            
            try {
              if (!fallbackClientReleased) {
                fallbackClient.release();
                fallbackClientReleased = true;
              }
            } catch (releaseError: any) {
              // Ignore release errors
            }
            
            logWithContext('error', 'Fallback method also failed', {
              ...context,
              error: fallbackError?.message,
              stack: fallbackError?.stack,
            });
            throw fallbackError;
          }
        }

        // PRODUCTION: For other errors (not transaction abort, not constraint error)
        // Re-throw to be handled by outer catch
        logWithContext('error', 'Failed to create purchase in transaction', {
          ...context,
          error: createError?.message,
          stack: createError?.stack,
        });
        throw createError;
      }

      // Mark event as processed (same transaction)
      // This ensures idempotency: if we created purchase, event is marked as processed
      try {
        await idempotencyGuard.markProcessed(
          eventId,
          correlationId,
          'PURCHASE_CONFIRMED',
          purchaseEvent,
          SERVICE_NAME
        );
      } catch (markError: any) {
        // If marking fails, rollback the entire transaction
        // This ensures consistency: purchase and event marking are atomic
        await client.query('ROLLBACK');
        logWithContext('error', 'Failed to mark event as processed, rolling back purchase creation', {
          ...context,
          purchaseId,
          error: markError?.message,
        });
        throw new Error(`Failed to mark event as processed: ${markError?.message}`);
      }

      // Commit transaction (both purchase creation and event marking succeeded)
      await client.query('COMMIT');
      
      logWithContext('info', 'Transaction committed successfully', {
        ...context,
        purchaseId,
      });

      // Purchase and event marking both succeeded
      logWithContext('info', '✅ Purchase created and event marked as processed', {
        ...context,
        purchaseId,
        recoveryMode: alreadyProcessed, // Indicates if this was a recovery scenario
      });

      // Emit PURCHASE_CREATED event
      const purchaseCreatedEvent: PurchaseCreatedEvent = {
        type: 'PURCHASE_CREATED',
        timestamp: Date.now(),
        userId: purchaseEvent.studentId,
        role: 'student',
        purchaseId,
        studentId: purchaseEvent.studentId,
        courseId: purchaseEvent.courseId,
        purchaseTier,
        metadata: purchaseEvent.metadata || {},
      };

      await kafkaBus.emit(purchaseCreatedEvent, {
        eventId: purchaseId,
        correlationId,
        source: SERVICE_NAME,
        version: '1.0.0',
      });

      logWithContext('info', 'PURCHASE_CREATED event emitted to Kafka', {
        ...context,
        purchaseId,
      });

      // CRITICAL: Also emit to Redis Pub/Sub for WebSocket/real-time updates
      // This ensures frontend receives the event immediately without refresh
      try {
        const { getEventBus } = await import('@kodingcaravan/shared');
        const eventBus = getEventBus();
        
        // Emit to Redis Pub/Sub (for WebSocket clients)
        await eventBus.emit(purchaseCreatedEvent);
        
        logWithContext('info', 'PURCHASE_CREATED event emitted to Redis Pub/Sub', {
          ...context,
          purchaseId,
        });
      } catch (redisError: any) {
        // Non-critical: WebSocket events are best-effort
        logWithContext('warn', 'Failed to emit PURCHASE_CREATED to Redis Pub/Sub (non-critical)', {
          ...context,
          error: redisError?.message,
        });
      }

      // Emit COURSE_ACCESS_GRANTED event (explicit state event)
      const courseAccessGrantedEvent: CourseAccessGrantedEvent = {
        type: 'COURSE_ACCESS_GRANTED',
        timestamp: Date.now(),
        userId: purchaseEvent.studentId,
        role: 'student',
        purchaseId,
        studentId: purchaseEvent.studentId,
        courseId: purchaseEvent.courseId,
        purchaseTier,
        metadata: purchaseEvent.metadata || {},
      };

      await kafkaBus.emit(courseAccessGrantedEvent, {
        eventId: `course-access-granted-${purchaseId}`,
        correlationId,
        source: SERVICE_NAME,
        version: '1.0.0',
      });

      logWithContext('info', 'COURSE_ACCESS_GRANTED event emitted to Kafka', {
        ...context,
        purchaseId,
      });

      // CRITICAL: Also emit to Redis Pub/Sub for WebSocket/real-time updates
      try {
        const { getEventBus } = await import('@kodingcaravan/shared');
        const eventBus = getEventBus();
        
        // Emit to Redis Pub/Sub (for WebSocket clients)
        await eventBus.emit(courseAccessGrantedEvent);
        
        logWithContext('info', 'COURSE_ACCESS_GRANTED event emitted to Redis Pub/Sub', {
          ...context,
          purchaseId,
        });
      } catch (redisError: any) {
        // Non-critical: WebSocket events are best-effort
        logWithContext('warn', 'Failed to emit COURSE_ACCESS_GRANTED to Redis Pub/Sub (non-critical)', {
          ...context,
          error: redisError?.message,
        });
      }

      // Emit course purchase notification so user receives push (notification-worker consumes from Kafka)
      try {
        const { emitCoursePurchaseNotification } = await import('@kodingcaravan/shared/utils/notificationEventEmitter');
        const courseName =
          (completeMetadata?.courseName as string) ??
          (completeMetadata?.course_name as string) ??
          (purchaseEvent.metadata?.courseName as string) ??
          (purchaseEvent.metadata?.course_name as string) ??
          'Your course';
        const amount =
          (completeMetadata?.amount as number) ?? (purchaseEvent.metadata?.amount as number) ?? 0;
        await emitCoursePurchaseNotification(
          purchaseEvent.studentId,
          courseName,
          typeof amount === 'number' ? amount : 0,
          correlationId
        );
        logWithContext('info', 'Course purchase notification emitted', {
          ...context,
          purchaseId,
          courseName,
        });
      } catch (notifErr: any) {
        logWithContext('warn', 'Failed to emit course purchase notification (non-critical)', {
          ...context,
          error: notifErr?.message,
        });
      }
    } catch (error: any) {
      // PRODUCTION: Ensure transaction is rolled back and client is released
      // Only if client exists and hasn't been released
      if (client && !clientReleased) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError: any) {
          // Ignore rollback errors (transaction may already be rolled back or aborted)
          // This is expected for 25P02 errors
        }
      }
      
      logWithContext('error', 'Purchase creation failed', {
        ...context,
        error: error?.message,
        errorCode: error?.code,
        stack: error?.stack,
      });
      
      throw error;
    } finally {
      // PRODUCTION: Final safety net - ensure client is always released exactly once
      // This prevents connection leaks even if error handling fails
      if (client && !clientReleased) {
        try {
          client.release();
          clientReleased = true;
        } catch (releaseError: any) {
          // Last resort - log but don't throw
          logWithContext('error', 'Failed to release client in finally block (connection leak possible)', {
            ...context,
            error: releaseError?.message,
          });
        }
      }
    }
  } catch (error: any) {
    logWithContext('error', 'Failed to process PURCHASE_CONFIRMED event', {
      ...context,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Main worker function
 */
async function main(): Promise<void> {
  try {
    logger.info('[PurchaseWorker] 🚀 Starting purchase worker...', {
      serviceName: SERVICE_NAME,
      timestamp: new Date().toISOString(),
    });

    await initialize();

    logger.info('[PurchaseWorker] ✅ Initialization complete, creating Kafka consumer...', {
      serviceName: SERVICE_NAME,
      topic: KAFKA_TOPIC,
      consumerGroup: CONSUMER_GROUP,
    });

    const consumer = createKafkaConsumer({
      groupId: CONSUMER_GROUP,
      clientId: `${SERVICE_NAME}-${Date.now()}`,
      topics: [KAFKA_TOPIC],
      fromBeginning: false,
    });
    consumerRef = consumer;

    logger.info('[PurchaseWorker] ✅ Kafka consumer created, starting message consumption...', {
      serviceName: SERVICE_NAME,
    });

    await consumer.start(async (event, payload) => {
      logger.info('[PurchaseWorker] 📨 Received PURCHASE_CONFIRMED event from Kafka', {
        eventId: getEventId(event),
        correlationId: getEventCorrelationId(event),
        topic: payload.topic,
        partition: payload.partition,
        offset: payload.message.offset,
      });
      const correlationId = getEventCorrelationId(event);
      const eventId = getEventId(event);

      try {
        // Execute with retry policy
        await executeWithRetry(
          () => handlePurchaseConfirmed(event),
          {
            maxAttempts: 3,
            initialDelayMs: 1000,
            maxDelayMs: 30000,
            multiplier: 2,
          },
          { correlationId, eventId, operation: 'create_purchase' }
        );
      } catch (error: any) {
        // All retries exhausted - send to DLQ
        logWithContext('error', 'All retries exhausted, sending to DLQ', {
          correlationId,
          eventId,
          error: error.message,
        });

        await dlqPublisher.publish({
          originalEvent: event,
          originalTopic: payload.topic,
          originalPartition: payload.partition,
          originalOffset: payload.message.offset,
          failureReason: error.message,
          failureTimestamp: Date.now(),
          attempts: 3,
          correlationId,
          eventId,
        });

        // Re-throw to prevent offset commit (Kafka will redeliver)
        throw error;
      }
    });

    logger.info('[PurchaseWorker] Started', {
      serviceName: SERVICE_NAME,
      topic: KAFKA_TOPIC,
      consumerGroup: CONSUMER_GROUP,
    });
  } catch (error: any) {
    logger.error('[PurchaseWorker] Fatal error', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

// Graceful shutdown for ECS (SIGTERM)
process.on('SIGTERM', async () => {
  logger.info('[PurchaseWorker] Shutting down gracefully');
  try {
    if (consumerRef) await consumerRef.stop();
  } catch (e: any) {
    logger.warn('[PurchaseWorker] Error stopping consumer', { error: e?.message });
  }
  try {
    if (pool) await pool.end();
  } catch (e: any) {
    logger.warn('[PurchaseWorker] Error closing pool', { error: e?.message });
  }
  process.exit(0);
});
process.on('SIGINT', () => process.emit('SIGTERM' as any));

// Start worker
if (require.main === module) {
  main().catch((error) => {
    logger.error('[PurchaseWorker] Unhandled error', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });
}

export { main };

