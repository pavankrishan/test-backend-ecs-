/**
 * Progress Calculation Worker
 * 
 * Consumes SESSION_COMPLETED events and calculates course progress asynchronously.
 * 
 * This worker replaces the synchronous database trigger that was blocking
 * session confirmation requests under high load.
 * 
 * Flow:
 * 1. Consume SESSION_COMPLETED event from Redis Pub/Sub
 * 2. Count completed sessions for student/course
 * 3. Get total lessons from purchase_tier or course structure
 * 4. Calculate percentage
 * 5. Update student_course_progress table (idempotent)
 * 6. Emit PROGRESS_UPDATED event (for WebSocket clients)
 * 
 * Idempotency: UNIQUE constraint on (student_id, course_id) in student_course_progress
 * Retry: Max 3 attempts, then log error (best-effort, non-critical)
 */

import { createPostgresPool, logger } from '@kodingcaravan/shared';
import { getEventBus } from '@kodingcaravan/shared';
import type { Pool } from 'pg';
import type { SessionCompletedEvent, ProgressUpdatedEvent } from '@kodingcaravan/shared/events/types';

const SERVICE_NAME = 'progress-worker';
const REDIS_CHANNEL = 'session-completed';

// Initialize dependencies
let pool: Pool;
let eventBus: ReturnType<typeof getEventBus>;

/**
 * Initialize worker dependencies
 */
async function initialize(): Promise<void> {
  pool = createPostgresPool({ max: 10 }) as unknown as Pool;
  eventBus = getEventBus();

  logger.info('[ProgressWorker] Initialized', {
    serviceName: SERVICE_NAME,
    channel: REDIS_CHANNEL,
  });
}

/**
 * Get total lessons for a student/course
 * Priority: purchase_tier > course structure count
 */
async function getTotalLessons(studentId: string, courseId: string): Promise<number> {
  // First, try to get from purchase_tier
  const purchaseResult = await pool.query(
    `SELECT purchase_tier 
     FROM student_course_purchases 
     WHERE student_id = $1 
       AND course_id = $2 
       AND is_active = true 
     ORDER BY created_at DESC 
     LIMIT 1`,
    [studentId, courseId]
  );

  if (purchaseResult.rows.length > 0 && purchaseResult.rows[0].purchase_tier) {
    const purchaseTier = parseInt(purchaseResult.rows[0].purchase_tier, 10);
    if (purchaseTier > 0) {
      return purchaseTier;
    }
  }

  // Fallback: count from course structure
  const courseStructureResult = await pool.query(
    `SELECT COUNT(*) as count
     FROM course_sessions cs
     JOIN course_levels cl ON cs.level_id = cl.id
     JOIN course_phases cp ON cl.phase_id = cp.id
     WHERE cp.course_id = $1`,
    [courseId]
  );

  const count = parseInt(courseStructureResult.rows[0]?.count || '0', 10);
  
  // Ensure at least 1 to avoid division by zero
  return Math.max(1, count);
}

/**
 * Handle SESSION_COMPLETED event
 */
async function handleSessionCompleted(event: SessionCompletedEvent): Promise<void> {
  const { sessionId, studentId, courseId } = event;
  
  // Validate required fields
  if (!courseId) {
    logger.warn('[ProgressWorker] SESSION_COMPLETED event missing courseId, skipping', {
      serviceName: SERVICE_NAME,
      sessionId,
      studentId,
    });
    return;
  }

  logger.info('[ProgressWorker] Processing SESSION_COMPLETED event', {
    serviceName: SERVICE_NAME,
    sessionId,
    studentId,
    courseId,
  });

  try {
    // 1. Count completed sessions
    const completedResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM tutoring_sessions
       WHERE student_id = $1 
         AND course_id = $2 
         AND status = 'completed' 
         AND student_confirmed = true`,
      [studentId, courseId]
    );

    const completedCount = parseInt(completedResult.rows[0]?.count || '0', 10);

    // 2. Get total lessons
    const totalLessons = await getTotalLessons(studentId, courseId);

    // 3. Calculate percentage (0-100)
    const percentage = Math.min(100, Math.round((completedCount / totalLessons) * 100));

    // 4. Get last completed timestamp
    const lastCompletedResult = await pool.query(
      `SELECT MAX(ended_at) as last_completed
       FROM tutoring_sessions
       WHERE student_id = $1 
         AND course_id = $2 
         AND status = 'completed' 
         AND student_confirmed = true`,
      [studentId, courseId]
    );

    const lastCompleted = lastCompletedResult.rows[0]?.last_completed || null;

    // 5. Update progress (idempotent - UNIQUE constraint on student_id, course_id)
    await pool.query(
      `INSERT INTO student_course_progress 
       (student_id, course_id, completed_lessons, total_lessons, percentage, last_completed_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (student_id, course_id) 
       DO UPDATE SET 
         completed_lessons = EXCLUDED.completed_lessons,
         total_lessons = EXCLUDED.total_lessons,
         percentage = EXCLUDED.percentage,
         last_completed_at = EXCLUDED.last_completed_at,
         updated_at = NOW()`,
      [studentId, courseId, completedCount, totalLessons, percentage, lastCompleted]
    );

    logger.info('[ProgressWorker] Progress updated successfully', {
      serviceName: SERVICE_NAME,
      studentId,
      courseId,
      completedCount,
      totalLessons,
      percentage,
    });

    // 6. Emit PROGRESS_UPDATED event (for WebSocket clients)
    const progressUpdatedEvent: ProgressUpdatedEvent = {
      type: 'PROGRESS_UPDATED',
      timestamp: Date.now(),
      userId: studentId,
      role: 'student',
      studentId,
      courseId,
      completedLessons: completedCount,
      totalLessons,
      percentage,
      lastCompletedAt: lastCompleted ? new Date(lastCompleted).getTime() : null,
    };

    try {
      await eventBus.emit(progressUpdatedEvent);
      logger.info('[ProgressWorker] PROGRESS_UPDATED event emitted', {
        serviceName: SERVICE_NAME,
        studentId,
        courseId,
        percentage,
      });
    } catch (error: any) {
      // Non-critical: WebSocket events are best-effort
      logger.warn('[ProgressWorker] Failed to emit PROGRESS_UPDATED event (non-critical)', {
        serviceName: SERVICE_NAME,
        studentId,
        courseId,
        error: error?.message,
      });
    }
  } catch (error: any) {
    // Log error but don't throw (best-effort, non-critical)
    // Progress calculation failure shouldn't break session completion
    logger.error('[ProgressWorker] Failed to calculate progress', {
      serviceName: SERVICE_NAME,
      sessionId,
      studentId,
      courseId,
      error: error?.message,
      stack: error?.stack,
    });
  }
}

/**
 * Main worker function
 */
async function main(): Promise<void> {
  try {
    await initialize();

    // Subscribe to SESSION_COMPLETED events from Redis Pub/Sub
    // PHASE 2 FIX: Use eventBus.subscribe() with filter for SESSION_COMPLETED events
    eventBus.subscribe(
      async (event: any) => {
        if (event.type === 'SESSION_COMPLETED') {
          try {
            await handleSessionCompleted(event as SessionCompletedEvent);
          } catch (error: any) {
            logger.error('[ProgressWorker] Error handling SESSION_COMPLETED event', {
              serviceName: SERVICE_NAME,
              error: error?.message,
              stack: error?.stack,
            });
          }
        }
      },
      (event: any) => event.type === 'SESSION_COMPLETED' // Filter for SESSION_COMPLETED only
    );

    logger.info('[ProgressWorker] Started', {
      serviceName: SERVICE_NAME,
      channel: REDIS_CHANNEL,
      subscribedTo: 'SESSION_COMPLETED',
    });
  } catch (error: any) {
    logger.error('[ProgressWorker] Fatal error', {
      error: error?.message,
      stack: error?.stack,
    });
    process.exit(1);
  }
}

// Start worker
if (require.main === module) {
  main().catch((error) => {
    logger.error('[ProgressWorker] Unhandled error', {
      error: error?.message,
      stack: error?.stack,
    });
    process.exit(1);
  });
}

export { main };
