/**
 * Dead Letter Queue Publisher
 * 
 * Publishes failed messages to DLQ topic for manual review.
 * Used when max retries are exhausted.
 */

import { Kafka, Producer, logLevel } from 'kafkajs';
import logger from '../config/logger';
import type { EnrichedEvent } from '../events/kafkaEventBus';

export interface DeadLetterMessage {
  originalEvent: EnrichedEvent;
  originalTopic: string;
  originalPartition: number;
  originalOffset: string;
  failureReason: string;
  failureTimestamp: number;
  attempts: number;
  correlationId: string;
  eventId: string;
}

/**
 * Dead Letter Queue Publisher
 * 
 * Publishes failed messages to DLQ topic.
 * DLQ messages can be manually reviewed and reprocessed.
 */
export class DeadLetterPublisher {
  private kafka: Kafka;
  private producer: Producer | null = null;
  private dlqTopic: string;
  private isConnected = false;

  constructor(dlqTopic: string = 'dead-letter-queue') {
    this.dlqTopic = dlqTopic;
    const brokers = this.getKafkaBrokers();
    this.kafka = new Kafka({
      clientId: `dlq-publisher-${Date.now()}`,
      brokers,
      logLevel: logLevel.INFO,
    });
  }

  /**
   * Connect producer
   */
  async connect(): Promise<void> {
    if (this.isConnected && this.producer) {
      return;
    }

    this.producer = this.kafka.producer({
      idempotent: true,
      maxInFlightRequests: 1,
    });

    await this.producer.connect();
    this.isConnected = true;

    logger.info('[DeadLetterPublisher] Connected', {
      dlqTopic: this.dlqTopic,
    });
  }

  /**
   * Publish message to DLQ
   */
  async publish(message: DeadLetterMessage): Promise<void> {
    if (!this.producer || !this.isConnected) {
      await this.connect();
    }

    if (!this.producer) {
      throw new Error('DLQ producer not initialized');
    }

    try {
      await this.producer.send({
        topic: this.dlqTopic,
        messages: [
          {
            key: message.correlationId,
            value: JSON.stringify(message),
            headers: {
              originalTopic: message.originalTopic,
              originalPartition: message.originalPartition.toString(),
              originalOffset: message.originalOffset,
              failureReason: message.failureReason,
              correlationId: message.correlationId,
              eventId: message.eventId,
            },
          },
        ],
      });

      logger.error('[DeadLetterPublisher] Message sent to DLQ', {
        correlationId: message.correlationId,
        eventId: message.eventId,
        originalTopic: message.originalTopic,
        failureReason: message.failureReason,
        attempts: message.attempts,
      });
    } catch (error: any) {
      logger.error('[DeadLetterPublisher] Failed to publish to DLQ', {
        error: error.message,
        correlationId: message.correlationId,
        eventId: message.eventId,
      });
      throw error;
    }
  }

  /**
   * Disconnect producer
   */
  async disconnect(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
      this.producer = null;
      this.isConnected = false;
      logger.info('[DeadLetterPublisher] Disconnected');
    }
  }

  private getKafkaBrokers(): string[] {
    const brokers = process.env.KAFKA_BROKERS || process.env.KAFKA_BROKER || 'localhost:9092';
    return brokers.split(',').map((b) => b.trim());
  }
}

/**
 * Singleton DLQ publisher instance
 */
let dlqPublisherInstance: DeadLetterPublisher | null = null;

export function getDeadLetterPublisher(): DeadLetterPublisher {
  if (!dlqPublisherInstance) {
    dlqPublisherInstance = new DeadLetterPublisher();
  }
  return dlqPublisherInstance;
}

