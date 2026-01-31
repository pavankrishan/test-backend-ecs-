/**
 * Idempotent Event Emitter
 * 
 * Ensures events are only emitted once, even if called multiple times.
 * Uses database to track emitted events.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Pool, QueryResult } from 'pg';
import type { BusinessEvent } from './types';
import { getKafkaEventBus, type EventMetadata } from './kafkaEventBus';
import logger from '../config/logger';

export interface IdempotentEventEmitterConfig {
  pool: Pool;
  serviceName: string;
  eventVersion?: string;
}

/**
 * Idempotent Event Emitter
 * 
 * Guarantees:
 * - Events are only emitted once (idempotent)
 * - Events are persisted before emission (at-least-once delivery)
 * - Correlation IDs for tracing
 */
export class IdempotentEventEmitter {
  private pool: Pool;
  private serviceName: string;
  private eventVersion: string;
  private kafkaBus = getKafkaEventBus();

  constructor(config: IdempotentEventEmitterConfig) {
    this.pool = config.pool;
    this.serviceName = config.serviceName;
    this.eventVersion = config.eventVersion || '1.0.0';
  }

  /**
   * Emit event with idempotency guarantee
   * 
   * If event with same correlationId and eventType already exists, skip emission.
   * This ensures retries don't create duplicate events.
   */
  async emit(
    event: BusinessEvent,
    correlationId: string,
    options: {
      idempotencyKey?: string; // Optional: custom idempotency key (default: correlationId + eventType)
      force?: boolean; // Force emission even if already exists (use with caution)
    } = {}
  ): Promise<string> {
    const eventId = uuidv4();
    const idempotencyKey = options.idempotencyKey || `${correlationId}:${event.type}`;

    // Check if event already emitted (idempotency check)
    if (!options.force) {
      const existing: QueryResult<{ event_id: string }> = await this.pool.query(
        `SELECT event_id FROM processed_events 
         WHERE correlation_id = $1 AND event_type = $2
         LIMIT 1`,
        [correlationId, event.type]
      );

      if (existing.rows.length > 0 && existing.rows[0]) {
        const existingEventId = existing.rows[0].event_id;
        logger.info('[IdempotentEventEmitter] Event already emitted, skipping', {
          eventId: existingEventId,
          correlationId,
          eventType: event.type,
          idempotencyKey,
        });
        return existingEventId;
      }
    }

    // Persist event to database BEFORE emission (ensures at-least-once delivery)
    try {
      await this.pool.query(
        `INSERT INTO processed_events (event_id, event_type, correlation_id, payload, source, version, processed_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (event_id) DO NOTHING`,
        [
          eventId,
          event.type,
          correlationId,
          JSON.stringify(event),
          this.serviceName,
          this.eventVersion,
        ]
      );
    } catch (error: any) {
      // If insert fails due to duplicate, event was already processed
      if (error.code === '23505') {
        logger.info('[IdempotentEventEmitter] Event already processed (duplicate event_id)', {
          eventId,
          correlationId,
          eventType: event.type,
        });
        return eventId;
      }
      throw error;
    }

    // Emit to Kafka
    try {
      const metadata: EventMetadata = {
        eventId,
        correlationId,
        timestamp: Date.now(),
        source: this.serviceName,
        version: this.eventVersion,
      };

      await this.kafkaBus.emit(event, metadata);

      logger.info('[IdempotentEventEmitter] Event emitted successfully', {
        eventId,
        correlationId,
        eventType: event.type,
        source: this.serviceName,
      });

      return eventId;
    } catch (error: any) {
      // If Kafka emission fails, event is still in DB and can be retried
      logger.error('[IdempotentEventEmitter] Failed to emit event to Kafka', {
        error: error.message,
        eventId,
        correlationId,
        eventType: event.type,
      });
      throw error;
    }
  }

  /**
   * Check if event was already processed
   */
  async isProcessed(correlationId: string, eventType: BusinessEvent['type']): Promise<boolean> {
    const result: QueryResult<{ event_id: string }> = await this.pool.query(
      `SELECT 1 FROM processed_events 
       WHERE correlation_id = $1 AND event_type = $2
       LIMIT 1`,
      [correlationId, eventType]
    );
    return result.rows.length > 0;
  }
}

