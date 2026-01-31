/**
 * Kafka Consumer Framework
 * 
 * Reusable Kafka consumer with:
 * - Consumer group support (horizontal scaling)
 * - Automatic offset management
 * - Error handling and retry integration
 * - Correlation ID tracking
 */

import { Kafka, Consumer, EachMessagePayload, logLevel } from 'kafkajs';
import logger from '../config/logger';
import type { EnrichedEvent } from '../events/kafkaEventBus';

export interface KafkaConsumerConfig {
  brokers: string[];
  groupId: string;
  clientId: string;
  topics: string[];
  fromBeginning?: boolean;
}

export interface MessageHandler {
  (event: EnrichedEvent, payload: EachMessagePayload): Promise<void>;
}

/**
 * Kafka Consumer Wrapper
 * 
 * Handles:
 * - Consumer group management
 * - Message deserialization
 * - Error handling
 * - Offset commits
 */
export class KafkaConsumer {
  private kafka: Kafka;
  private consumer: Consumer | null = null;
  private config: KafkaConsumerConfig;
  private isRunning = false;

  constructor(config: KafkaConsumerConfig) {
    this.config = config;
    this.kafka = new Kafka({
      clientId: config.clientId,
      brokers: config.brokers,
      logLevel: logLevel.INFO,
    });
  }

  /**
   * Connect and subscribe to topics
   */
  async connect(): Promise<void> {
    if (this.consumer) {
      return;
    }

    this.consumer = this.kafka.consumer({
      groupId: this.config.groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxBytesPerPartition: 1048576, // 1MB
      minBytes: 1,
      maxBytes: 10485760, // 10MB
    });

    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: this.config.topics,
      fromBeginning: this.config.fromBeginning || false,
    });

    logger.info('[KafkaConsumer] Connected and subscribed', {
      groupId: this.config.groupId,
      topics: this.config.topics,
      clientId: this.config.clientId,
    });
  }

  /**
   * Start consuming messages
   * 
   * Messages are processed one at a time per partition to ensure ordering.
   * Offset is committed only after successful processing.
   */
  async start(handler: MessageHandler): Promise<void> {
    if (!this.consumer) {
      await this.connect();
    }

    if (this.isRunning) {
      logger.warn('[KafkaConsumer] Already running');
      return;
    }

    this.isRunning = true;

    await this.consumer!.run({
      eachMessage: async (payload: EachMessagePayload) => {
        const correlationId = payload.message.headers?.correlationId?.toString() || 'unknown';
        const eventId = payload.message.headers?.eventId?.toString() || 'unknown';

        try {
          if (!payload.message.value) {
            logger.warn('[KafkaConsumer] Message without value, skipping', {
              topic: payload.topic,
              partition: payload.partition,
              offset: payload.message.offset,
              correlationId,
            });
            return;
          }

          // Deserialize event
          const event = JSON.parse(payload.message.value.toString()) as EnrichedEvent;

          // Attach correlation ID to logger context
          logger.info('[KafkaConsumer] Processing message', {
            eventId,
            correlationId,
            eventType: (event as any).type || 'unknown',
            topic: payload.topic,
            partition: payload.partition,
            offset: payload.message.offset,
          });

          // Process message
          await handler(event, payload);

          // Message processed successfully
          // Offset will be committed automatically by Kafka consumer
          logger.info('[KafkaConsumer] Message processed successfully', {
            eventId,
            correlationId,
            eventType: (event as any).type || 'unknown',
            topic: payload.topic,
            partition: payload.partition,
            offset: payload.message.offset,
          });
        } catch (error: any) {
          // Log error but don't throw - let retry policy handle it
          logger.error('[KafkaConsumer] Message processing failed', {
            error: error.message,
            stack: error.stack,
            eventId,
            correlationId,
            topic: payload.topic,
            partition: payload.partition,
            offset: payload.message.offset,
          });

          // Re-throw to trigger Kafka retry mechanism
          // Kafka will redeliver the message
          throw error;
        }
      },
    });

    logger.info('[KafkaConsumer] Started consuming', {
      groupId: this.config.groupId,
      topics: this.config.topics,
    });
  }

  /**
   * Stop consuming messages
   */
  async stop(): Promise<void> {
    if (!this.consumer || !this.isRunning) {
      return;
    }

    this.isRunning = false;
    await this.consumer.disconnect();
    this.consumer = null;

    logger.info('[KafkaConsumer] Stopped consuming', {
      groupId: this.config.groupId,
    });
  }
}

/**
 * Get Kafka brokers from environment
 */
function getKafkaBrokers(): string[] {
  const brokers = process.env.KAFKA_BROKERS || process.env.KAFKA_BROKER || 'localhost:9092';
  return brokers.split(',').map((b) => b.trim());
}

/**
 * Create a Kafka consumer instance
 */
export function createKafkaConsumer(config: Omit<KafkaConsumerConfig, 'brokers'>): KafkaConsumer {
  return new KafkaConsumer({
    ...config,
    brokers: getKafkaBrokers(),
  });
}

