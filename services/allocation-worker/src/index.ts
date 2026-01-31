/**
 * Trainer Allocation Worker
 * 
 * Consumes PURCHASE_CREATED events and allocates trainers.
 * 
 * Flow:
 * 1. Consume PURCHASE_CREATED from Kafka
 * 2. Check idempotency (processed_events + active allocation)
 * 3. Call AllocationService directly (no HTTP - Phase 1 fix)
 * 4. Mark event as processed
 * 5. Emit TRAINER_ALLOCATED event
 * 
 * Idempotency: UNIQUE constraint on (student_id, course_id) WHERE status IN ('approved', 'active')
 * Retry: Max 5 attempts, then DLQ
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
import type { PurchaseCreatedEvent, TrainerAllocatedEvent } from '@kodingcaravan/shared/events/types';
import type { EnrichedEvent } from '@kodingcaravan/shared/events/kafkaEventBus';
import { getKafkaEventBus } from '@kodingcaravan/shared/events/kafkaEventBus';

const SERVICE_NAME = 'allocation-worker';
const KAFKA_TOPIC = 'purchase-created';
const CONSUMER_GROUP = 'trainer-allocation-workers';
const DLQ_TOPIC = 'dead-letter-queue';

// Initialize dependencies
let pool: Pool;
let idempotencyGuard: IdempotencyGuard;
let kafkaBus: ReturnType<typeof getKafkaEventBus>;
let dlqPublisher: ReturnType<typeof getDeadLetterPublisher>;

// CRITICAL: Cache AllocationService import at module level
// WHY: Prevents re-importing models on each retry, which causes OverwriteModelError
// Dynamic import is cached by Node.js, but we cache the service instance to be safe
// Type definitions are available at build time from admin-service/dist/services/allocation.service.d.ts
let AllocationServiceClass: typeof import('../../admin-service/dist/services/allocation.service').AllocationService | null = null;
let allocationServiceInstance: InstanceType<typeof import('../../admin-service/dist/services/allocation.service').AllocationService> | null = null;
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

  // CRITICAL: Import AllocationService ONCE at initialization (not on each retry)
  // WHY: Prevents re-importing models on each retry, which causes OverwriteModelError
  // Models are imported when AllocationService is first loaded, and cached by Node.js
  // But we cache the service instance to ensure idempotency
  if (!AllocationServiceClass) {
    try {
      // @ts-ignore - Dynamic import from compiled JS, types not available at compile time
      const allocationModule = await import('../../admin-service/dist/services/allocation.service');
      AllocationServiceClass = allocationModule.AllocationService;
      allocationServiceInstance = new AllocationServiceClass();
      
      logger.info('[AllocationWorker] AllocationService imported and cached', {
        serviceName: SERVICE_NAME,
      });
    } catch (error: any) {
      logger.error('[AllocationWorker] Failed to import AllocationService', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  logger.info('[AllocationWorker] Initialized', {
    serviceName: SERVICE_NAME,
    topic: KAFKA_TOPIC,
    consumerGroup: CONSUMER_GROUP,
  });
}

/**
 * Check if allocation already exists
 */
async function allocationExists(studentId: string, courseId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT id FROM trainer_allocations 
     WHERE student_id = $1 AND course_id = $2 AND status IN ('approved', 'active')
     LIMIT 1`,
    [studentId, courseId]
  );

  return result.rows.length > 0;
}

/**
 * Allocate trainer directly (no HTTP call)
 * 
 * PHASE 1 FIX: Removed HTTP call to admin-service.
 * Now calls AllocationService directly from the same codebase.
 * This eliminates service-to-service coupling.
 */
async function allocateTrainer(
  studentId: string,
  courseId: string,
  metadata: Record<string, unknown>
): Promise<{ allocationId: string; trainerId: string }> {
  // Extract preferred time slot and date from metadata
  const schedule = metadata.schedule as Record<string, unknown> | undefined;
  const preferredTimeSlot =
    (metadata.timeSlot as string) ||
    (metadata.preferredTimeSlot as string) ||
    (schedule?.timeSlot as string) ||
    '4:00 PM';

  const preferredDate =
    ((schedule?.startDate as string) ||
    (schedule?.date as string) ||
    (metadata.startDate as string) ||
    (metadata.date as string) ||
    (metadata.preferredDate as string) ||
    new Date().toISOString().split('T')[0]) as string;

  // CRITICAL: Use cached AllocationService instance (imported at initialization)
  // WHY: Prevents re-importing models on each retry, which causes OverwriteModelError
  // The service is imported once during initialize() and cached at module level
  if (!allocationServiceInstance) {
    throw new Error('AllocationService not initialized - call initialize() first');
  }
  
  const allocationService = allocationServiceInstance;

  // Call allocation service directly
  const allocation = await allocationService.autoAssignTrainerAfterPurchase(
    studentId,
    courseId,
    preferredTimeSlot,
    preferredDate,
    studentId, // requestedBy
    metadata // paymentMetadata
  );

  if (!allocation?.id) {
    throw new Error('Allocation service returned allocation without ID');
  }

  if (!allocation.trainerId) {
    throw new Error('Allocation service returned allocation without trainerId');
  }

  return {
    allocationId: allocation.id,
    trainerId: allocation.trainerId,
  };
}

/**
 * Handle PURCHASE_CREATED event
 */
async function handlePurchaseCreated(event: EnrichedEvent): Promise<void> {
  const purchaseEvent = event as PurchaseCreatedEvent & { _metadata: EnrichedEvent['_metadata'] };
  const correlationId = getEventCorrelationId(event);
  const eventId = getEventId(event);

  const context = {
    correlationId,
    eventId,
    purchaseId: purchaseEvent.purchaseId,
    workerName: SERVICE_NAME,
    operation: 'allocate_trainer',
    studentId: purchaseEvent.studentId,
    courseId: purchaseEvent.courseId,
  };

  logWithContext('info', 'Processing PURCHASE_CREATED event', context);

  try {
    // CRITICAL FIX: Check if allocation exists FIRST (before idempotency check)
    // This handles the case where event was marked as processed but allocation creation failed
    const exists = await allocationExists(purchaseEvent.studentId, purchaseEvent.courseId);
    if (exists) {
      logWithContext('info', 'Allocation already exists, marking event as processed', context);

      // Mark as processed even though we didn't create it (idempotency)
      await idempotencyGuard.markProcessed(
        eventId,
        correlationId,
        'PURCHASE_CREATED',
        purchaseEvent,
        SERVICE_NAME
      );
      return;
    }

    // Check idempotency (only if allocation doesn't exist)
    // If event was processed but allocation doesn't exist, we should still try to create it
    const alreadyProcessed = await idempotencyGuard.isProcessed({
      eventId,
      correlationId,
      eventType: 'PURCHASE_CREATED',
    });

    if (alreadyProcessed) {
      // Event was marked as processed but allocation doesn't exist - this is a problem!
      // Log warning but still try to create allocation (recovery scenario)
      logWithContext('warn', 'Event marked as processed but allocation does not exist - attempting recovery', {
        ...context,
        studentId: purchaseEvent.studentId,
        courseId: purchaseEvent.courseId,
      });
      // Continue to create allocation (don't return)
    }

    // Allocate trainer via admin-service API
    logWithContext('info', 'Calling admin-service allocation API', context);
    
    // CRITICAL: Fetch complete metadata from purchase record (same as purchase worker does)
    // The event metadata might be incomplete, so fetch from source of truth
    let completeMetadata = purchaseEvent.metadata || {};
    
    try {
      // Fetch purchase record to get complete metadata
      const purchaseResult = await pool.query(
        `SELECT metadata FROM student_course_purchases 
         WHERE student_id = $1 AND course_id = $2 AND is_active = true
         ORDER BY created_at DESC 
         LIMIT 1`,
        [purchaseEvent.studentId, purchaseEvent.courseId]
      );
      
      if (purchaseResult.rows.length > 0 && purchaseResult.rows[0].metadata) {
        const purchaseMetadata = typeof purchaseResult.rows[0].metadata === 'string' 
          ? JSON.parse(purchaseResult.rows[0].metadata)
          : purchaseResult.rows[0].metadata;
        
        // Merge purchase metadata with event metadata (purchase metadata takes precedence)
        completeMetadata = {
          ...purchaseMetadata,
          ...purchaseEvent.metadata, // Event metadata can override if needed
        };
        
        logWithContext('info', 'Fetched complete metadata from purchase record', {
          ...context,
          metadataKeys: Object.keys(completeMetadata),
        });
      }
    } catch (error: any) {
      logWithContext('warn', 'Failed to fetch purchase metadata, using event metadata', {
        ...context,
        error: error.message,
      });
      // Continue with event metadata if purchase fetch fails
    }
    
    const { allocationId, trainerId } = await allocateTrainer(
      purchaseEvent.studentId,
      purchaseEvent.courseId,
      completeMetadata // Use complete metadata with all purchase details
    );
    logWithContext('info', 'Admin-service allocation API responded', {
      ...context,
      allocationId,
      trainerId,
    });

    // CRITICAL FIX: Verify allocation exists in database before marking as processed
    // This prevents marking event as processed if allocation creation failed
    const allocationVerification = await pool.query(
      `SELECT id, status FROM trainer_allocations WHERE id = $1`,
      [allocationId]
    );

    if (allocationVerification.rows.length === 0) {
      throw new Error(
        `Allocation ${allocationId} not found in database after admin-service API call. ` +
        `API returned success but allocation was not created.`
      );
    }

    logWithContext('info', 'Allocation verified in database', {
      ...context,
      allocationId,
      status: allocationVerification.rows[0].status,
    });

    // Mark event as processed ONLY after verification
    await idempotencyGuard.markProcessed(
      eventId,
      correlationId,
      'PURCHASE_CREATED',
      purchaseEvent,
      SERVICE_NAME
    );

    logWithContext('info', 'Trainer allocated successfully', {
      ...context,
      allocationId,
      trainerId,
    });

    // Emit TRAINER_ALLOCATED event
    const trainerAllocatedEvent: TrainerAllocatedEvent = {
      type: 'TRAINER_ALLOCATED',
      timestamp: Date.now(),
      userId: purchaseEvent.studentId,
      role: 'student',
      allocationId,
      trainerId,
      studentId: purchaseEvent.studentId,
      courseId: purchaseEvent.courseId,
      sessionCount: purchaseEvent.purchaseTier,
      startDate: (((purchaseEvent.metadata?.schedule as Record<string, unknown>)?.startDate as string) ||
        (purchaseEvent.metadata?.startDate as string) ||
        new Date().toISOString().split('T')[0]) as string,
      endDate: (purchaseEvent.metadata?.expiryDate as string || '') as string,
    };

    // Emit to Kafka (for workers)
    await kafkaBus.emit(trainerAllocatedEvent, {
      eventId: allocationId,
      correlationId,
      source: SERVICE_NAME,
      version: '1.0.0',
    });

    logWithContext('info', 'TRAINER_ALLOCATED event emitted to Kafka', {
      ...context,
      allocationId,
      trainerId,
    });

    // CRITICAL: Also emit to Redis Pub/Sub for WebSocket/real-time updates
    // This ensures frontend receives the event immediately without refresh
    // NOTE: getEventBus import is safe - it doesn't import Mongoose models
    try {
      const { getEventBus } = await import('@kodingcaravan/shared');
      const eventBus = getEventBus();
      
      // Emit to Redis Pub/Sub (for WebSocket clients)
      await eventBus.emit(trainerAllocatedEvent);
      
      logWithContext('info', 'TRAINER_ALLOCATED event emitted to Redis Pub/Sub', {
        ...context,
        allocationId,
        trainerId,
      });
    } catch (redisError: any) {
      // Non-critical: WebSocket events are best-effort
      logWithContext('warn', 'Failed to emit TRAINER_ALLOCATED to Redis Pub/Sub (non-critical)', {
        ...context,
        error: redisError?.message,
      });
    }
  } catch (error: any) {
    logWithContext('error', 'Failed to process PURCHASE_CREATED event', {
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
    logger.info('[AllocationWorker] 🚀 Starting allocation worker...', {
      serviceName: SERVICE_NAME,
      timestamp: new Date().toISOString(),
    });

    await initialize();

    logger.info('[AllocationWorker] ✅ Initialization complete, creating Kafka consumer...', {
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

    logger.info('[AllocationWorker] ✅ Kafka consumer created, starting message consumption...', {
      serviceName: SERVICE_NAME,
    });

    await consumer.start(async (event, payload) => {
      logger.info('[AllocationWorker] 📨 Received PURCHASE_CREATED event from Kafka', {
        eventId: getEventId(event),
        correlationId: getEventCorrelationId(event),
        topic: payload.topic,
        partition: payload.partition,
        offset: payload.message.offset,
      });
      const correlationId = getEventCorrelationId(event);
      const eventId = getEventId(event);

      try {
        // Execute with retry policy (max 5 attempts for allocation)
        await executeWithRetry(
          () => handlePurchaseCreated(event),
          {
            maxAttempts: 5,
            initialDelayMs: 2000,
            maxDelayMs: 60000,
            multiplier: 2,
          },
          { correlationId, eventId, operation: 'allocate_trainer' }
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
          attempts: 5,
          correlationId,
          eventId,
        });

        // Re-throw to prevent offset commit (Kafka will redeliver)
        throw error;
      }
    });

    logger.info('[AllocationWorker] Started', {
      serviceName: SERVICE_NAME,
      topic: KAFKA_TOPIC,
      consumerGroup: CONSUMER_GROUP,
    });
  } catch (error: any) {
    logger.error('[AllocationWorker] Fatal error', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

// Graceful shutdown for ECS (SIGTERM)
process.on('SIGTERM', async () => {
  logger.info('[AllocationWorker] Shutting down gracefully');
  try {
    if (consumerRef) await consumerRef.stop();
  } catch (e: any) {
    logger.warn('[AllocationWorker] Error stopping consumer', { error: e?.message });
  }
  try {
    if (pool) await pool.end();
  } catch (e: any) {
    logger.warn('[AllocationWorker] Error closing pool', { error: e?.message });
  }
  process.exit(0);
});
process.on('SIGINT', () => process.emit('SIGTERM' as any));

// Start worker
if (require.main === module) {
  main().catch((error) => {
    logger.error('[AllocationWorker] Unhandled error', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });
}

export { main };

