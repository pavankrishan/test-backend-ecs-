/**
 * Notification Worker
 * 
 * Consumes NOTIFICATION_REQUESTED events and sends notifications.
 * 
 * This worker replaces synchronous HTTP calls to notification-service,
 * making notification sending non-blocking and resilient.
 * 
 * Flow:
 * 1. Consume NOTIFICATION_REQUESTED event from Kafka
 * 2. Check idempotency (processed_events)
 * 3. Store notification in MongoDB
 * 4. Send push notification via FCM
 * 5. Mark event as processed
 * 
 * Idempotency: processed_events table
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
import type { NotificationRequestedEvent } from '@kodingcaravan/shared/events/types';
import type { EnrichedEvent } from '@kodingcaravan/shared/events/kafkaEventBus';
import { getKafkaEventBus } from '@kodingcaravan/shared/events/kafkaEventBus';
import { MongoClient, ObjectId } from 'mongodb';

const SERVICE_NAME = 'notification-worker';
const KAFKA_TOPIC = 'notification-requested';
const CONSUMER_GROUP = 'notification-workers';
const DLQ_TOPIC = 'dead-letter-queue';

// Initialize dependencies
let pool: Pool;
let idempotencyGuard: IdempotencyGuard;
let dlqPublisher: ReturnType<typeof getDeadLetterPublisher>;
let kafkaBus: ReturnType<typeof getKafkaEventBus>;
let mongoClient: MongoClient;
let mongoDb: any;
let consumerRef: ReturnType<typeof createKafkaConsumer> | null = null;

const MONGO_RETRY_ATTEMPTS = 5;
const MONGO_RETRY_DELAY_MS = 2000;

/**
 * Initialize worker dependencies. Retries Mongo connection with backoff; fails with clear error if missing env or all retries fail.
 */
async function initialize(): Promise<void> {
  pool = createPostgresPool({ max: 10 }) as unknown as Pool;
  idempotencyGuard = new IdempotencyGuard(pool);
  dlqPublisher = getDeadLetterPublisher();
  await dlqPublisher.connect();
  kafkaBus = getKafkaEventBus();
  await kafkaBus.connect();

  const mongoUrl = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGODB_URL;
  if (!mongoUrl) {
    logger.error('[NotificationWorker] MONGO_URI (or MONGODB_URI / MONGODB_URL) is required. Set MONGO_URI in the task definition or .env.');
    throw new Error(
      'MONGO_URI (or MONGODB_URI / MONGODB_URL) is required. This project uses cloud MongoDB only. ' +
      'Set MONGO_URI to your cloud connection string (e.g. MongoDB Atlas mongodb+srv://...).'
    );
  }
  const dbName = process.env.MONGO_DB_NAME || process.env.MONGODB_DB_NAME || 'kodingcaravan';

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MONGO_RETRY_ATTEMPTS; attempt++) {
    const client = new MongoClient(mongoUrl);
    try {
      await client.connect();
      mongoClient = client;
      mongoDb = mongoClient.db(dbName);
      logger.info('[NotificationWorker] Initialized', {
        serviceName: SERVICE_NAME,
        topic: KAFKA_TOPIC,
        consumerGroup: CONSUMER_GROUP,
      });
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      try { await client.close(); } catch { /* ignore */ }
      if (attempt < MONGO_RETRY_ATTEMPTS) {
        const delay = MONGO_RETRY_DELAY_MS * attempt;
        logger.warn('[NotificationWorker] MongoDB connection failed, retrying', {
          attempt,
          maxAttempts: MONGO_RETRY_ATTEMPTS,
          delayMs: delay,
          error: lastError.message,
        });
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  logger.error('[NotificationWorker] MongoDB connection failed after all retries. Check MONGO_URI and network.', {
    attempts: MONGO_RETRY_ATTEMPTS,
    error: lastError?.message,
  });
  throw lastError ?? new Error('MongoDB connection failed');
}

/** Map event notificationType to MongoDB notification model type */
const NOTIFICATION_TYPE_MAP: Record<string, 'course' | 'assignment' | 'achievement' | 'payment' | 'system'> = {
  payment: 'payment',
  allocation: 'course',
  session: 'course',
  success: 'achievement',
  system: 'system',
  info: 'system',
  warning: 'system',
  error: 'system',
};

function mapNotificationType(
  notificationType: string
): 'course' | 'assignment' | 'achievement' | 'payment' | 'system' {
  return NOTIFICATION_TYPE_MAP[notificationType] ?? 'system';
}

/**
 * Convert userId (string UUID or 24-char hex) to ObjectId so in-app notifications list can find it.
 * Must match notification-service's ensureObjectId logic.
 */
function userIdToObjectId(userId: string): ObjectId {
  if (ObjectId.isValid(userId) && String(new ObjectId(userId)) === userId) {
    return new ObjectId(userId);
  }
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(userId)) {
    const hexString = userId.replace(/-/g, '').substring(0, 24).padEnd(24, '0');
    if (/^[0-9a-f]{24}$/i.test(hexString)) {
      return new ObjectId(hexString);
    }
  }
  return new ObjectId(userId);
}

/**
 * Create notification via notification-service API (stores in MongoDB + sends FCM to user's devices)
 */
async function createNotificationViaService(
  userId: string,
  title: string,
  message: string,
  type: 'course' | 'assignment' | 'achievement' | 'payment' | 'system'
): Promise<void> {
  // In ECS/Docker there is no localhost to notification-service; require URL from env.
  const baseUrl =
    process.env.NOTIFICATION_SERVICE_URL ||
    process.env.NOTIFICATION_SERVICE_INTERNAL_URL ||
    (process.env.DOCKER === 'true' ? '' : 'http://localhost:3006');
  if (!baseUrl) {
    throw new Error('NOTIFICATION_SERVICE_URL or NOTIFICATION_SERVICE_INTERNAL_URL must be set when running in Docker/ECS');
  }
  const url = `${baseUrl.replace(/\/$/, '')}/api/notifications`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, title, message, type }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notification service returned ${res.status}: ${text}`);
  }
}

/**
 * Handle NOTIFICATION_REQUESTED event
 */
async function handleNotificationRequested(event: EnrichedEvent): Promise<void> {
  const notificationEvent = event as NotificationRequestedEvent & { _metadata: EnrichedEvent['_metadata'] };
  const correlationId = getEventCorrelationId(event);
  const eventId = getEventId(event);

  const context = {
    correlationId,
    eventId,
    workerName: SERVICE_NAME,
    operation: 'send_notification',
    userId: notificationEvent.userId,
    notificationType: notificationEvent.notificationType,
  };

  logWithContext('info', 'Processing NOTIFICATION_REQUESTED event', context);

  try {
    // Check idempotency
    const alreadyProcessed = await idempotencyGuard.isProcessed({
      eventId,
      correlationId,
      eventType: 'NOTIFICATION_REQUESTED',
    });

    if (alreadyProcessed) {
      logWithContext('info', 'Event already processed, skipping', context);
      return;
    }

    // 1. Create notification via notification-service (stores in MongoDB + sends FCM to user's devices)
    const modelType = mapNotificationType(notificationEvent.notificationType);
    try {
      await createNotificationViaService(
        notificationEvent.userId,
        notificationEvent.title,
        notificationEvent.body,
        modelType
      );
      logWithContext('info', 'Notification created via notification-service (MongoDB + FCM); in-app list will show it', context);
    } catch (error: any) {
      // Fallback: store in MongoDB only if notification-service is unavailable.
      // Use ObjectId for userId so in-app notifications list (which queries by ObjectId) can find it.
      logWithContext('warn', 'Notification service call failed, storing in MongoDB only (in-app list will still show it)', {
        ...context,
        error: error?.message,
      });
      const now = new Date();
      await mongoDb.collection('notifications').insertOne({
        userId: userIdToObjectId(notificationEvent.userId),
        title: notificationEvent.title,
        message: notificationEvent.body,
        type: modelType,
        read: false,
        createdAt: now,
        updatedAt: now,
      });
      logWithContext('info', 'Fallback insert done; notification will appear in in-app notifications list', context);
    }

    // 2. Mark event as processed
    await idempotencyGuard.markProcessed(
      eventId,
      correlationId,
      'NOTIFICATION_REQUESTED',
      notificationEvent,
      SERVICE_NAME
    );

    logWithContext('info', 'Notification processed successfully', context);
  } catch (error: any) {
    logWithContext('error', 'Failed to process NOTIFICATION_REQUESTED event', {
      ...context,
      error: error?.message,
      stack: error?.stack,
    });
    throw error;
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
      topics: [KAFKA_TOPIC],
      fromBeginning: false,
    });
    consumerRef = consumer;

    await consumer.start(async (event: EnrichedEvent, payload: any) => {
      const correlationId = getEventCorrelationId(event);
      const eventId = getEventId(event);

      try {
        // Execute with retry policy
        await executeWithRetry(
          () => handleNotificationRequested(event),
          {
            maxAttempts: 5,
            initialDelayMs: 2000,
            maxDelayMs: 60000,
            multiplier: 2,
          },
          { correlationId, eventId, operation: 'send_notification' }
        );
      } catch (error: any) {
        // All retries exhausted - send to DLQ
        logWithContext('error', 'All retries exhausted, sending to DLQ', {
          correlationId,
          eventId,
          error: error?.message,
        });

        await dlqPublisher.publish({
          originalEvent: event,
          originalTopic: payload.topic,
          originalPartition: payload.partition,
          originalOffset: payload.message.offset,
          failureReason: error?.message,
          failureTimestamp: Date.now(),
          attempts: 5,
          correlationId,
          eventId,
        });

        // Re-throw to prevent offset commit (Kafka will redeliver)
        throw error;
      }
    });

    logger.info('[NotificationWorker] Started', {
      serviceName: SERVICE_NAME,
      topic: KAFKA_TOPIC,
      consumerGroup: CONSUMER_GROUP,
    });
  } catch (error: any) {
    logger.error('[NotificationWorker] Fatal error', {
      error: error?.message,
      stack: error?.stack,
    });
    process.exit(1);
  }
}

// Graceful shutdown (same pattern as purchase/session/cache/allocation workers)
process.on('SIGTERM', async () => {
  logger.info('[NotificationWorker] Shutting down gracefully');
  try {
    if (consumerRef) await consumerRef.stop();
  } catch (e: any) {
    logger.warn('[NotificationWorker] Error stopping consumer', { error: e?.message });
  }
  try {
    if (mongoClient) await mongoClient.close();
  } catch (e: any) {
    logger.warn('[NotificationWorker] Error closing Mongo client', { error: e?.message });
  }
  try {
    if (pool) await pool.end();
  } catch (e: any) {
    logger.warn('[NotificationWorker] Error closing pool', { error: e?.message });
  }
  process.exit(0);
});
process.on('SIGINT', () => process.emit('SIGTERM' as any));

// Start worker
if (require.main === module) {
  main().catch((error) => {
    logger.error('[NotificationWorker] Unhandled error', {
      error: error?.message,
      stack: error?.stack,
    });
    process.exit(1);
  });
}

export { main };
