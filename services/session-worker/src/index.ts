/**
 * Session Scheduling Worker
 * 
 * Consumes TRAINER_ALLOCATED events and creates rolling window of sessions.
 * 
 * Strategy: ROLLING WINDOW (7 sessions)
 * - Creates next 7 sessions when allocation happens
 * - Cron job maintains 7-session window (tops up when < 3 remain)
 * 
 * Flow:
 * 1. Consume TRAINER_ALLOCATED from Kafka
 * 2. Count existing future sessions
 * 3. If >= 7 → ACK message
 * 4. If < 7 → Create missing sessions (up to 7 total)
 * 5. Emit SESSION_SCHEDULED event (optional)
 * 
 * Idempotency: UNIQUE constraint on (allocation_id, scheduled_date, scheduled_time)
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
import type { TrainerAllocatedEvent, SessionsGeneratedEvent } from '@kodingcaravan/shared/events/types';
import type { EnrichedEvent } from '@kodingcaravan/shared/events/kafkaEventBus';
import { getKafkaEventBus } from '@kodingcaravan/shared/events/kafkaEventBus';

const SERVICE_NAME = 'session-worker';
const KAFKA_TOPIC = 'trainer-allocated';
const CONSUMER_GROUP = 'session-scheduling-workers';
const DLQ_TOPIC = 'dead-letter-queue';
const ROLLING_WINDOW_SIZE = 7;
const TOP_UP_THRESHOLD = 3; // Top up when < 3 sessions remain

// Initialize dependencies
let pool: Pool;
let idempotencyGuard: IdempotencyGuard;
let dlqPublisher: ReturnType<typeof getDeadLetterPublisher>;
let kafkaBus: ReturnType<typeof getKafkaEventBus>;
let consumerRef: ReturnType<typeof createKafkaConsumer> | null = null;

/**
 * Initialize worker dependencies
 */
async function initialize(): Promise<void> {
  pool = createPostgresPool({ max: 10 }) as unknown as Pool;
  idempotencyGuard = new IdempotencyGuard(pool);
  dlqPublisher = getDeadLetterPublisher();
  await dlqPublisher.connect();
  kafkaBus = getKafkaEventBus();
  await kafkaBus.connect();

  logger.info('[SessionWorker] Initialized', {
    serviceName: SERVICE_NAME,
    topic: KAFKA_TOPIC,
    consumerGroup: CONSUMER_GROUP,
    rollingWindowSize: ROLLING_WINDOW_SIZE,
  });
}

/**
 * Count existing future sessions for allocation
 */
async function countFutureSessions(allocationId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM tutoring_sessions 
     WHERE allocation_id = $1 
     AND scheduled_date >= CURRENT_DATE
     AND status IN ('scheduled', 'pending')`,
    [allocationId]
  );

  return parseInt(result.rows[0]?.count || '0', 10);
}

/**
 * Get allocation details
 */
// Removed getAllocationDetails - startDate is in the TRAINER_ALLOCATED event, not in the database table

/**
 * Generate next session dates (rolling window)
 * 
 * Creates dates for next 7 sessions, skipping weekends.
 * Respects start date from allocation.
 */
function generateSessionDates(startDate: string, count: number): string[] {
  const dates: string[] = [];
  const start = new Date(startDate);
  let current = new Date(start);

  while (dates.length < count) {
    const dayOfWeek = current.getDay();
    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      dates.push(current.toISOString().split('T')[0] as string);
    }
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Create session
 * 
 * Idempotency: UNIQUE constraint prevents duplicates
 */
async function createSession(
  allocationId: string,
  scheduledDate: string,
  scheduledTime: string,
  studentId: string,
  trainerId: string
): Promise<string> {
  // UNIQUE constraint on (allocation_id, scheduled_date, scheduled_time) ensures idempotency
  const result = await pool.query(
    `INSERT INTO tutoring_sessions 
     (allocation_id, student_id, trainer_id, scheduled_date, scheduled_time, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'scheduled', NOW(), NOW())
     ON CONFLICT (allocation_id, scheduled_date, scheduled_time)
     DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [allocationId, studentId, trainerId, scheduledDate, scheduledTime]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to create session');
  }

  return result.rows[0].id;
}

/**
 * Create rolling window of sessions
 */
async function createRollingWindowSessions(
  allocationId: string,
  startDate: string,
  timeSlot: string,
  studentId: string,
  trainerId: string
): Promise<number> {
  // Count existing sessions
  const existingCount = await countFutureSessions(allocationId);
  const needed = Math.max(0, ROLLING_WINDOW_SIZE - existingCount);

  if (needed === 0) {
    return 0;
  }

  // Generate session dates
  const sessionDates = generateSessionDates(startDate, needed + existingCount);
  const newDates = sessionDates.slice(existingCount);

  // Create sessions in transaction
  await pool.query('BEGIN');

  try {
    let created = 0;
    for (const date of newDates) {
      try {
        await createSession(allocationId, date, timeSlot, studentId, trainerId);
        created++;
      } catch (error: any) {
        // If duplicate (UNIQUE constraint violation), that's okay (idempotent)
        if (error.code === '23505') {
          logger.info('[SessionWorker] Session already exists (idempotent)', {
            allocationId,
            date,
            timeSlot,
          });
        } else {
          throw error;
        }
      }
    }

    await pool.query('COMMIT');
    return created;
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
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
    operation: 'create_sessions',
    studentId: allocationEvent.studentId,
    courseId: allocationEvent.courseId,
    trainerId: allocationEvent.trainerId,
  };

  logWithContext('info', 'Processing TRAINER_ALLOCATED event', context);

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

    // Verify allocation exists (but don't query for start_date - it's not in the table)
    const allocationCheck = await pool.query(
      `SELECT student_id, trainer_id, course_id
       FROM trainer_allocations
       WHERE id = $1`,
      [allocationEvent.allocationId]
    );

    if (allocationCheck.rows.length === 0) {
      throw new Error(`Allocation not found: ${allocationEvent.allocationId}`);
    }

    const allocationRow = allocationCheck.rows[0];

    // Use startDate from the event (it's already in TRAINER_ALLOCATED event)
    const sessionStartDate = allocationEvent.startDate || new Date().toISOString().split('T')[0];
    const sessionTimeSlot = '4:00 PM'; // Default time slot (can be enhanced later)
    
    if (!sessionStartDate || !sessionTimeSlot) {
      throw new Error(`Invalid allocation data: startDate=${sessionStartDate}, timeSlot=${sessionTimeSlot}`);
    }
    
    const created = await createRollingWindowSessions(
      allocationEvent.allocationId,
      sessionStartDate,
      sessionTimeSlot,
      String(allocationRow.student_id),
      String(allocationRow.trainer_id)
    );

    // Mark event as processed
    await idempotencyGuard.markProcessed(
      eventId,
      correlationId,
      'TRAINER_ALLOCATED',
      allocationEvent,
      SERVICE_NAME
    );

    logWithContext('info', 'Sessions created successfully', {
      ...context,
      sessionsCreated: created,
      rollingWindowSize: ROLLING_WINDOW_SIZE,
    });

    // Emit SESSIONS_GENERATED event if sessions were created
    if (created > 0) {
      try {
        // Get session IDs that were created
        const sessionIdsResult = await pool.query(
          `SELECT id FROM tutoring_sessions 
           WHERE allocation_id = $1 
           AND scheduled_date >= CURRENT_DATE
           ORDER BY scheduled_date ASC, scheduled_time ASC
           LIMIT $2`,
          [allocationEvent.allocationId, created]
        );
        
        const sessionIds = sessionIdsResult.rows.map((r: any) => r.id);
        
        const sessionsGeneratedEvent: SessionsGeneratedEvent = {
          type: 'SESSIONS_GENERATED',
          timestamp: Date.now(),
          userId: allocationEvent.studentId,
          role: 'student',
          allocationId: allocationEvent.allocationId,
          trainerId: allocationEvent.trainerId,
          studentId: allocationEvent.studentId,
          courseId: allocationEvent.courseId,
          sessionCount: created,
          sessionIds,
          startDate: sessionStartDate,
        };

        await kafkaBus.emit(sessionsGeneratedEvent, {
          eventId: `sessions-generated-${allocationEvent.allocationId}-${Date.now()}`,
          correlationId,
          source: SERVICE_NAME,
          version: '1.0.0',
        });

        logWithContext('info', 'SESSIONS_GENERATED event emitted', {
          ...context,
          sessionsCreated: created,
          sessionIdsCount: sessionIds.length,
        });
      } catch (error: any) {
        // Non-critical - log but don't fail
        logWithContext('warn', 'Failed to emit SESSIONS_GENERATED event (non-critical)', {
          ...context,
          error: error.message,
        });
      }
    }
  } catch (error: any) {
    logWithContext('error', 'Failed to process TRAINER_ALLOCATED event', {
      ...context,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Cron job: Top up sessions for all active allocations
 * 
 * Runs every 6 hours to maintain rolling window.
 */
async function topUpSessionsCron(): Promise<void> {
  try {
    // Get all active allocations (without start_date - it's not in the table)
    const result = await pool.query(
      `SELECT id, student_id, trainer_id, course_id, metadata
       FROM trainer_allocations
       WHERE status IN ('approved', 'active')`
    );

    for (const allocation of result.rows) {
      try {
        const existingCount = await countFutureSessions(allocation.id);
        
        if (existingCount < TOP_UP_THRESHOLD) {
          const needed = ROLLING_WINDOW_SIZE - existingCount;
          logWithContext('info', 'Topping up sessions', {
            workerName: SERVICE_NAME,
            operation: 'top_up_sessions',
            allocationId: allocation.id,
            existingCount,
            needed,
          });

          // Extract startDate from metadata or use today's date
          const metadata = allocation.metadata as Record<string, unknown> | null;
          const startDate: string = ((metadata?.startDate as string) || 
                           ((metadata?.schedule as Record<string, unknown>)?.startDate as string) ||
                           new Date().toISOString().split('T')[0]) as string;
          const timeSlot: string = '4:00 PM'; // Default time slot

          await createRollingWindowSessions(
            allocation.id,
            startDate,
            timeSlot,
            String(allocation.student_id),
            String(allocation.trainer_id)
          );
        }
      } catch (error: any) {
        logWithContext('error', 'Failed to top up sessions for allocation', {
          workerName: SERVICE_NAME,
          allocationId: allocation.id,
          error: error.message,
        });
        // Continue with next allocation
      }
    }
  } catch (error: any) {
    logger.error('[SessionWorker] Cron job failed', {
      error: error.message,
      stack: error.stack,
    });
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
          () => handleTrainerAllocated(event),
          {
            maxAttempts: 3,
            initialDelayMs: 1000,
            maxDelayMs: 30000,
            multiplier: 2,
          },
          { correlationId, eventId, operation: 'create_sessions' }
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

    // Start cron job (every 6 hours)
    setInterval(() => {
      topUpSessionsCron().catch((error) => {
        logger.error('[SessionWorker] Cron job error', {
          error: error.message,
        });
      });
    }, 6 * 60 * 60 * 1000); // 6 hours

    // Run immediately on startup
    topUpSessionsCron().catch((error) => {
      logger.error('[SessionWorker] Initial cron job error', {
        error: error.message,
      });
    });

    logger.info('[SessionWorker] Started', {
      serviceName: SERVICE_NAME,
      topic: KAFKA_TOPIC,
      consumerGroup: CONSUMER_GROUP,
      cronInterval: '6 hours',
    });
  } catch (error: any) {
    logger.error('[SessionWorker] Fatal error', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

// Graceful shutdown for ECS (SIGTERM)
process.on('SIGTERM', async () => {
  logger.info('[SessionWorker] Shutting down gracefully');
  try {
    if (consumerRef) await consumerRef.stop();
  } catch (e: any) {
    logger.warn('[SessionWorker] Error stopping consumer', { error: e?.message });
  }
  try {
    if (pool) await pool.end();
  } catch (e: any) {
    logger.warn('[SessionWorker] Error closing pool', { error: e?.message });
  }
  process.exit(0);
});
process.on('SIGINT', () => process.emit('SIGTERM' as any));

// Start worker
if (require.main === module) {
  main().catch((error) => {
    logger.error('[SessionWorker] Unhandled error', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });
}

export { main };

