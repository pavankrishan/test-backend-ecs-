/**
 * Cache Invalidation Worker
 * 
 * Consumes events that require cache invalidation and invalidates Redis caches.
 * 
 * Events Consumed:
 * - PURCHASE_CREATED: Purchase record created
 * - TRAINER_ALLOCATED: Trainer assigned to student
 * - SESSIONS_GENERATED: Sessions created for allocation
 * 
 * Flow:
 * 1. Consume events from Kafka
 * 2. Invalidate Redis caches:
 *    - student:home:{studentId}
 *    - student:learning:{studentId}
 * 3. ACK message (fire-and-forget, non-critical)
 * 
 * Retry: Max 3 attempts, then log-only (non-critical)
 */

import { getRedisClient } from '@kodingcaravan/shared/databases/redis/connection';
import {
  createKafkaConsumer,
  IdempotencyGuard,
  executeWithRetry,
  logWithContext,
  getEventCorrelationId,
  getEventId,
} from '@kodingcaravan/shared/worker';
import { createPostgresPool, logger } from '@kodingcaravan/shared';
import type { Pool } from 'pg';
import type { 
  PurchaseCreatedEvent, 
  TrainerAllocatedEvent, 
  SessionsGeneratedEvent 
} from '@kodingcaravan/shared/events/types';
import type { EnrichedEvent } from '@kodingcaravan/shared/events/kafkaEventBus';
import { getKafkaEventBus } from '@kodingcaravan/shared/events/kafkaEventBus';

const SERVICE_NAME = 'cache-worker';
const KAFKA_TOPICS = ['purchase-created', 'trainer-allocated', 'sessions-generated'];
const CONSUMER_GROUP = 'cache-invalidation-workers';

const REDIS_RETRY_ATTEMPTS = 5;
const REDIS_RETRY_DELAY_MS = 2000;

// Initialize dependencies
let pool: Pool;
let idempotencyGuard: IdempotencyGuard;
let redis: ReturnType<typeof getRedisClient>;
let consumerRef: ReturnType<typeof createKafkaConsumer> | null = null;

/**
 * Initialize worker dependencies. Retries Redis connection with backoff; fails with clear error if all retries fail.
 */
async function initialize(): Promise<void> {
  pool = createPostgresPool({ max: 10 }) as unknown as Pool;
  idempotencyGuard = new IdempotencyGuard(pool);
  redis = getRedisClient();

  if (!redis) {
    logger.error('[CacheWorker] Redis client not available. Set REDIS_URL or REDIS_HOST in the task definition or .env.');
    throw new Error('Redis client not available. Set REDIS_URL or REDIS_HOST.');
  }

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= REDIS_RETRY_ATTEMPTS; attempt++) {
    try {
      if (redis.status !== 'ready') {
        await redis.connect();
      }
      logger.info('[CacheWorker] Initialized', {
        serviceName: SERVICE_NAME,
        topics: KAFKA_TOPICS,
        consumerGroup: CONSUMER_GROUP,
      });
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < REDIS_RETRY_ATTEMPTS) {
        const delay = REDIS_RETRY_DELAY_MS * attempt;
        logger.warn('[CacheWorker] Redis connection failed, retrying', {
          attempt,
          maxAttempts: REDIS_RETRY_ATTEMPTS,
          delayMs: delay,
          error: lastError.message,
        });
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  logger.error('[CacheWorker] Redis connection failed after all retries. Check REDIS_URL/REDIS_HOST and network.', {
    attempts: REDIS_RETRY_ATTEMPTS,
    error: lastError?.message,
  });
  throw lastError ?? new Error('Redis connection failed');
}

/**
 * Invalidate student caches with comprehensive logging
 */
async function invalidateStudentCaches(
  studentId: string, 
  reason: string,
  context?: Record<string, unknown>
): Promise<void> {
  const keys = [
    `student:home:${studentId}`,
    `student:learning:${studentId}`,
  ];

  const startTime = Date.now();
  let successCount = 0;
  let failureCount = 0;

  for (const key of keys) {
    try {
      const before = await redis.exists(key);
      await redis.del(key);
      const after = await redis.exists(key);
      
      successCount++;
      
      logger.info('[CacheWorker] Cache invalidated', {
        key,
        studentId,
        reason,
        existedBefore: before === 1,
        existsAfter: after === 1,
        invalidated: before === 1 && after === 0,
        ...context,
      });
    } catch (error: any) {
      failureCount++;
      logger.warn('[CacheWorker] Failed to invalidate cache key', {
        key,
        studentId,
        reason,
        error: error.message,
        ...context,
      });
      // Continue with other keys
    }
  }

  const duration = Date.now() - startTime;
  logger.info('[CacheWorker] Cache invalidation completed', {
    studentId,
    reason,
    keysProcessed: keys.length,
    successCount,
    failureCount,
    durationMs: duration,
    ...context,
  });
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
    operation: 'invalidate_cache',
    eventType: 'PURCHASE_CREATED',
    studentId: purchaseEvent.studentId,
    courseId: purchaseEvent.courseId,
  };

  logWithContext('info', 'Processing PURCHASE_CREATED event for cache invalidation', context);

  try {
    // Check idempotency (optional - cache invalidation is idempotent by nature)
    const alreadyProcessed = await idempotencyGuard.isProcessed({
      eventId,
      correlationId,
      eventType: 'PURCHASE_CREATED',
    });

    if (alreadyProcessed) {
      logWithContext('info', 'Event already processed, skipping', context);
      return;
    }

    // Invalidate caches
    await invalidateStudentCaches(
      purchaseEvent.studentId,
      'PURCHASE_CREATED',
      { purchaseId: purchaseEvent.purchaseId, courseId: purchaseEvent.courseId }
    );

    // Mark event as processed (optional - cache invalidation is fire-and-forget)
    try {
      await idempotencyGuard.markProcessed(
        eventId,
        correlationId,
        'PURCHASE_CREATED',
        purchaseEvent,
        SERVICE_NAME
      );
    } catch (error: any) {
      // Non-critical - cache invalidation doesn't need strict idempotency tracking
      logger.warn('[CacheWorker] Failed to mark event as processed (non-critical)', {
        ...context,
        error: error.message,
      });
    }

    logWithContext('info', 'Cache invalidation completed', context);
  } catch (error: any) {
    logWithContext('error', 'Failed to invalidate cache', {
      ...context,
      error: error.message,
      stack: error.stack,
    });
    // Don't throw - cache invalidation is non-critical
    // Log error but allow message to be ACKed
  }
}

/**
 * Handle TRAINER_ALLOCATED event
 */
async function handleTrainerAllocated(event: EnrichedEvent): Promise<void> {
  const allocationEvent = event as TrainerAllocatedEvent & { _metadata: EnrichedEvent['_metadata'] };
  const correlationId = getEventCorrelationId(event);
  const eventId = getEventId(event);

  const context = {
    correlationId,
    eventId,
    allocationId: allocationEvent.allocationId,
    workerName: SERVICE_NAME,
    operation: 'invalidate_cache',
    eventType: 'TRAINER_ALLOCATED',
    studentId: allocationEvent.studentId,
    courseId: allocationEvent.courseId,
    trainerId: allocationEvent.trainerId,
  };

  logWithContext('info', 'Processing TRAINER_ALLOCATED event for cache invalidation', context);

  try {
    // Check idempotency
    const alreadyProcessed = await idempotencyGuard.isProcessed({
      eventId,
      correlationId,
      eventType: 'TRAINER_ALLOCATED',
    });

    if (alreadyProcessed) {
      logWithContext('info', 'Event already processed, skipping', context);
      return;
    }

    // Invalidate caches
    await invalidateStudentCaches(
      allocationEvent.studentId,
      'TRAINER_ALLOCATED',
      { 
        allocationId: allocationEvent.allocationId,
        trainerId: allocationEvent.trainerId,
        courseId: allocationEvent.courseId 
      }
    );

    // Mark event as processed
    try {
      await idempotencyGuard.markProcessed(
        eventId,
        correlationId,
        'TRAINER_ALLOCATED',
        allocationEvent,
        SERVICE_NAME
      );
    } catch (error: any) {
      logger.warn('[CacheWorker] Failed to mark event as processed (non-critical)', {
        ...context,
        error: error.message,
      });
    }

    logWithContext('info', 'Cache invalidation completed', context);
  } catch (error: any) {
    logWithContext('error', 'Failed to invalidate cache', {
      ...context,
      error: error.message,
      stack: error.stack,
    });
    // Don't throw - cache invalidation is non-critical
  }
}

/**
 * Handle SESSIONS_GENERATED event
 */
async function handleSessionsGenerated(event: EnrichedEvent): Promise<void> {
  const sessionsEvent = event as SessionsGeneratedEvent & { _metadata: EnrichedEvent['_metadata'] };
  const correlationId = getEventCorrelationId(event);
  const eventId = getEventId(event);

  const context = {
    correlationId,
    eventId,
    workerName: SERVICE_NAME,
    operation: 'invalidate_cache',
    eventType: 'SESSIONS_GENERATED',
    studentId: sessionsEvent.studentId,
    courseId: sessionsEvent.courseId,
    allocationId: sessionsEvent.allocationId,
    sessionCount: sessionsEvent.sessionCount,
  };

  logWithContext('info', 'Processing SESSIONS_GENERATED event for cache invalidation', context);

  try {
    // Check idempotency
    const alreadyProcessed = await idempotencyGuard.isProcessed({
      eventId,
      correlationId,
      eventType: 'SESSIONS_GENERATED',
    });

    if (alreadyProcessed) {
      logWithContext('info', 'Event already processed, skipping', context);
      return;
    }

    // Invalidate caches
    await invalidateStudentCaches(
      sessionsEvent.studentId,
      'SESSIONS_GENERATED',
      { 
        allocationId: sessionsEvent.allocationId,
        sessionCount: sessionsEvent.sessionCount,
        courseId: sessionsEvent.courseId 
      }
    );

    // Mark event as processed
    try {
      await idempotencyGuard.markProcessed(
        eventId,
        correlationId,
        'SESSIONS_GENERATED',
        sessionsEvent,
        SERVICE_NAME
      );
    } catch (error: any) {
      logger.warn('[CacheWorker] Failed to mark event as processed (non-critical)', {
        ...context,
        error: error.message,
      });
    }

    logWithContext('info', 'Cache invalidation completed', context);
  } catch (error: any) {
    logWithContext('error', 'Failed to invalidate cache', {
      ...context,
      error: error.message,
      stack: error.stack,
    });
    // Don't throw - cache invalidation is non-critical
  }
}

/**
 * Main worker function
 */
async function main(): Promise<void> {
  try {
    await initialize();

    const consumer = createKafkaConsumer({
      groupId: CONSUMER_GROUP,
      clientId: `${SERVICE_NAME}-${Date.now()}`,
      topics: KAFKA_TOPICS,
      fromBeginning: false,
    });
    consumerRef = consumer;

    await consumer.start(async (event: EnrichedEvent, payload: any) => {
      const correlationId = getEventCorrelationId(event);
      const eventId = getEventId(event);
      const eventType = (event as any).type;

      try {
        // Route to appropriate handler based on event type
        let handler: (event: EnrichedEvent) => Promise<void>;
        
        switch (eventType) {
          case 'PURCHASE_CREATED':
            handler = handlePurchaseCreated;
            break;
          case 'TRAINER_ALLOCATED':
            handler = handleTrainerAllocated;
            break;
          case 'SESSIONS_GENERATED':
            handler = handleSessionsGenerated;
            break;
          default:
            logger.warn('[CacheWorker] Unknown event type, skipping', {
              eventType,
              correlationId,
              eventId,
            });
            return; // ACK unknown events
        }

        // Execute with retry policy (non-critical, so fewer retries)
        await executeWithRetry(
          () => handler(event),
          {
            maxAttempts: 3,
            initialDelayMs: 500,
            maxDelayMs: 5000,
            multiplier: 2,
          },
          { correlationId, eventId, operation: 'invalidate_cache' }
        );
      } catch (error: any) {
        // Cache invalidation is non-critical - log error but don't send to DLQ
        // ACK the message anyway (cache will be invalidated on next read)
        logWithContext('warn', 'Cache invalidation failed after retries (non-critical)', {
          correlationId,
          eventId,
          eventType,
          error: error.message,
        });
        // Don't throw - allow message to be ACKed
      }
    });

    logger.info('[CacheWorker] Started', {
      serviceName: SERVICE_NAME,
      topics: KAFKA_TOPICS,
      consumerGroup: CONSUMER_GROUP,
    });
  } catch (error: any) {
    logger.error('[CacheWorker] Fatal error', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

// Graceful shutdown for ECS (SIGTERM)
process.on('SIGTERM', async () => {
  logger.info('[CacheWorker] Shutting down gracefully');
  try {
    if (consumerRef) await consumerRef.stop();
  } catch (e: any) {
    logger.warn('[CacheWorker] Error stopping consumer', { error: e?.message });
  }
  try {
    if (pool) await pool.end();
  } catch (e: any) {
    logger.warn('[CacheWorker] Error closing pool', { error: e?.message });
  }
  process.exit(0);
});
process.on('SIGINT', () => process.emit('SIGTERM' as any));

// Start worker
if (require.main === module) {
  main().catch((error) => {
    logger.error('[CacheWorker] Unhandled error', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });
}

export { main };

