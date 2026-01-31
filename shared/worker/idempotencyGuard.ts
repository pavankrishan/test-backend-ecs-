/**
 * Idempotency Guard
 *
 * Ensures operations are only executed once, even if retried.
 * Uses processed_events table as source of truth.
 *
 * Event IDs are opaque string identifiers (e.g. UUID or "sessions-generated-{id}-{ts}").
 * The processed_events.event_id column is TEXT; no UUID casting is used.
 */

import type { Pool, QueryResult } from 'pg';
import type { BusinessEvent } from '../events/types';
import logger from '../config/logger';

export interface IdempotencyCheck {
  eventId: string;
  correlationId: string;
  eventType: BusinessEvent['type'];
}

/**
 * Idempotency Guard
 * 
 * Checks if an event has already been processed.
 * If processed, returns true (idempotent - safe to skip).
 * If not processed, marks as processed and returns false (proceed).
 */
export class IdempotencyGuard {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Check if event was already processed
   * 
   * Returns true if already processed (idempotent - skip processing).
   * Returns false if not processed (proceed with processing).
   */
  async isProcessed(check: IdempotencyCheck): Promise<boolean> {
    const { eventId, correlationId, eventType } = check;

    try {
      const result: QueryResult<{ event_id: string }> = await this.pool.query(
        `SELECT event_id FROM processed_events 
         WHERE event_id = $1 OR (correlation_id = $2 AND event_type = $3)
         LIMIT 1`,
        [eventId, correlationId, eventType]
      );

      if (result.rows.length > 0 && result.rows[0]) {
        logger.info('[IdempotencyGuard] Event already processed', {
          eventId,
          correlationId,
          eventType,
          existingEventId: result.rows[0].event_id,
        });
        return true;
      }

      return false;
    } catch (error: any) {
      logger.error('[IdempotencyGuard] Failed to check idempotency', {
        error: error.message,
        eventId,
        correlationId,
        eventType,
      });
      // On error, assume not processed (fail-safe)
      // This allows processing to proceed, but idempotency is enforced at DB level
      return false;
    }
  }

  /**
   * Mark event as processed
   * 
   * This should be called AFTER successful business logic execution,
   * within the same transaction as the business write.
   */
  async markProcessed(
    eventId: string,
    correlationId: string,
    eventType: BusinessEvent['type'],
    payload: BusinessEvent,
    source: string,
    version: string = '1.0.0'
  ): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO processed_events (event_id, event_type, correlation_id, payload, source, version, processed_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (event_id) DO NOTHING`,
        [eventId, eventType, correlationId, JSON.stringify(payload), source, version]
      );

      logger.info('[IdempotencyGuard] Event marked as processed', {
        eventId,
        correlationId,
        eventType,
        source,
      });
    } catch (error: any) {
      // If insert fails due to duplicate, that's okay (idempotent)
      if (error.code === '23505') {
        logger.info('[IdempotencyGuard] Event already marked as processed (duplicate event_id)', {
          eventId,
          correlationId,
          eventType,
        });
        return;
      }

      logger.error('[IdempotencyGuard] Failed to mark event as processed', {
        error: error.message,
        eventId,
        correlationId,
        eventType,
      });
      throw error;
    }
  }

  /**
   * Execute operation with idempotency guarantee
   * 
   * Wraps business logic with idempotency checks.
   * If already processed, returns early.
   * If not processed, executes operation and marks as processed.
   */
  async executeWithIdempotency<T>(
    check: IdempotencyCheck,
    operation: () => Promise<T>,
    markProcessedFn: () => Promise<void>
  ): Promise<T | null> {
    // Check if already processed
    if (await this.isProcessed(check)) {
      logger.info('[IdempotencyGuard] Operation already processed, skipping', {
        eventId: check.eventId,
        correlationId: check.correlationId,
        eventType: check.eventType,
      });
      return null; // Indicates already processed
    }

    // Execute operation
    const result = await operation();

    // Mark as processed (should be in same transaction as operation)
    await markProcessedFn();

    return result;
  }
}

