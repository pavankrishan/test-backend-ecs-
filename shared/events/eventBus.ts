/**
 * Event Bus Implementation
 * 
 * Production-grade event bus for emitting and subscribing to business events.
 * Supports in-memory (development) and Redis Pub/Sub (production).
 */

import type { BusinessEvent } from './types';
import logger from '../config/logger';

export interface EventBus {
  /**
   * Emit an event to all subscribers
   */
  emit(event: BusinessEvent): Promise<void>;
  
  /**
   * Subscribe to events
   */
  subscribe(
    handler: (event: BusinessEvent) => Promise<void>,
    filter?: (event: BusinessEvent) => boolean
  ): () => void; // Returns unsubscribe function
  
  /**
   * Emit event and wait for all handlers to complete
   */
  emitAndWait(event: BusinessEvent): Promise<void>;
}

/**
 * In-memory event bus (development)
 */
class InMemoryEventBus implements EventBus {
  private handlers: Array<{
    handler: (event: BusinessEvent) => Promise<void>;
    filter?: (event: BusinessEvent) => boolean;
  }> = [];
  
  async emit(event: BusinessEvent): Promise<void> {
    const promises = this.handlers
      .filter(({ filter }) => !filter || filter(event))
      .map(({ handler }) => handler(event).catch(err => {
        logger.error('EventBus handler error', {
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          eventType: event.type,
          service: 'event-bus',
        });
      }));
    
    await Promise.allSettled(promises);
  }
  
  subscribe(
    handler: (event: BusinessEvent) => Promise<void>,
    filter?: (event: BusinessEvent) => boolean
  ): () => void {
    const handlerEntry = filter 
      ? { handler, filter }
      : { handler };
    this.handlers.push(handlerEntry);
    return () => {
      const index = this.handlers.findIndex(h => h.handler === handler);
      if (index >= 0) {
        this.handlers.splice(index, 1);
      }
    };
  }
  
  async emitAndWait(event: BusinessEvent): Promise<void> {
    await this.emit(event);
  }
}

/**
 * Redis Pub/Sub event bus (production)
 */
class RedisEventBus implements EventBus {
  private redis: any; // RedisClient type
  private handlers: Map<string, Array<(event: BusinessEvent) => Promise<void>>> = new Map();
  private subscriber: any;
  
  constructor(redis: any) {
    this.redis = redis;
    this.setupSubscriber();
  }
  
  private setupSubscriber(): void {
    try {
      // Ensure Redis is connected before setting up subscriber
      if (this.redis.status !== 'ready') {
        logger.warn('Redis not ready, will retry subscriber setup when connected', {
          status: this.redis.status,
          service: 'event-bus',
        });
        this.redis.once('ready', () => {
          this.setupSubscriber();
        });
        return;
      }
      
      this.subscriber = this.redis.duplicate();
      this.subscriber.subscribe('business-events');
      logger.info('Redis subscriber setup complete, listening on business-events channel', {
        service: 'event-bus',
      });
      
      this.subscriber.on('message', async (channel: string, message: string) => {
        try {
          const event = JSON.parse(message) as BusinessEvent;
          logger.debug('Received event from Redis', {
            eventType: event.type,
            channel,
            service: 'event-bus',
          });
          const handlers = this.handlers.get(event.type) || [];
          logger.debug('Found handlers for event type', {
            eventType: event.type,
            handlerCount: handlers.length,
            service: 'event-bus',
          });
          await Promise.allSettled(
            handlers.map(handler => handler(event).catch(err => {
              logger.error('EventBus handler error', {
                error: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
                eventType: event.type,
                service: 'event-bus',
              });
            }))
          );
        } catch (error) {
          logger.error('Failed to process event', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            service: 'event-bus',
          });
        }
      });
    } catch (error) {
      logger.error('Failed to setup Redis subscriber', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        service: 'event-bus',
      });
    }
  }
  
  async emit(event: BusinessEvent): Promise<void> {
    try {
      // Ensure Redis is connected
      if (this.redis.status === 'end' || this.redis.status === 'close') {
        // Connection was closed, need to reconnect
        await this.redis.connect();
      } else if (this.redis.status === 'wait' || this.redis.status === 'connecting') {
        // Already connecting, wait for it
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Redis connection timeout'));
          }, 5000);
          
          if (this.redis.status === 'ready') {
            clearTimeout(timeout);
            resolve();
            return;
          }
          
          this.redis.once('ready', () => {
            clearTimeout(timeout);
            resolve();
          });
          
          this.redis.once('error', (err: Error) => {
            clearTimeout(timeout);
            reject(err);
          });
        });
      } else if (this.redis.status !== 'ready') {
        // Other states, try to connect
        try {
          await this.redis.connect();
        } catch (err: any) {
          // If already connecting, wait for it
          if (err.message?.includes('already connecting') || err.message?.includes('already connected')) {
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
              this.redis.once('ready', () => {
                clearTimeout(timeout);
                resolve();
              });
              this.redis.once('error', (err: Error) => {
                clearTimeout(timeout);
                reject(err);
              });
            });
          } else {
            throw err;
          }
        }
      }
      
      await this.redis.publish('business-events', JSON.stringify(event));
      logger.debug('Event emitted to Redis', {
        eventType: event.type,
        service: 'event-bus',
      });
    } catch (error: any) {
      logger.error('Failed to emit event', {
        error: error?.message || String(error),
        stack: error?.stack,
        eventType: event.type,
        service: 'event-bus',
      });
      throw error;
    }
  }
  
  subscribe(
    handler: (event: BusinessEvent) => Promise<void>,
    filter?: (event: BusinessEvent) => boolean
  ): () => void {
    // For Redis, we subscribe to all event types and filter in handler
    const wrappedHandler = async (event: BusinessEvent) => {
      if (!filter || filter(event)) {
        await handler(event);
      }
    };
    
    // Store handler for all event types (we'll filter in the handler)
    const eventTypes: BusinessEvent['type'][] = [
      'COURSE_PURCHASED',
      'TRAINER_ALLOCATED',
      'STUDENT_DEALLOCATED',
      'SESSION_RESCHEDULED',
      'SESSION_SUBSTITUTED',
      'SESSION_COMPLETED',
      'COURSE_COMPLETED',
      'CERTIFICATE_ISSUED',
      'ADMIN_OVERRIDE',
      'PAYROLL_RECALCULATED',
    ];
    
    eventTypes.forEach(type => {
      if (!this.handlers.has(type)) {
        this.handlers.set(type, []);
      }
      this.handlers.get(type)!.push(wrappedHandler);
    });
    
    return () => {
      eventTypes.forEach(type => {
        const handlers = this.handlers.get(type);
        if (handlers) {
          const index = handlers.indexOf(wrappedHandler);
          if (index >= 0) {
            handlers.splice(index, 1);
          }
        }
      });
    };
  }
  
  async emitAndWait(event: BusinessEvent): Promise<void> {
    await this.emit(event);
    // Wait a bit for handlers to process
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

// Export singleton instance
let eventBusInstance: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!eventBusInstance) {
    try {
      const { getRedisClient } = require('../databases/redis/connection');
      const redis = getRedisClient();
      
      if (redis) {
        // Check if Redis is actually connected or connecting
        const isConnected = redis.status === 'ready' || redis.status === 'connecting' || redis.status === 'wait';
        
        if (isConnected) {
          // Try to use Redis, but handle connection issues gracefully
          try {
            eventBusInstance = new RedisEventBus(redis);
            logger.info('Using Redis Pub/Sub event bus', {
              status: redis.status,
              service: 'event-bus',
            });
            
            // If not ready, try to connect
            if (redis.status !== 'ready') {
              logger.info('Redis not ready, attempting to connect', {
                status: redis.status,
                service: 'event-bus',
              });
              redis.connect().catch((err: Error) => {
                logger.warn('Redis connection failed, events will be in-memory until connected', {
                  error: err.message,
                  service: 'event-bus',
                });
              });
              
              // Wait a bit and verify connection
              setTimeout(() => {
                if (redis.status === 'ready') {
                  logger.info('Redis connected successfully', {
                    service: 'event-bus',
                  });
                } else {
                  logger.warn('Redis still not ready', {
                    status: redis.status,
                    service: 'event-bus',
                  });
                }
              }, 2000);
            } else {
              logger.info('Redis already connected', {
                service: 'event-bus',
              });
            }
          } catch (error: any) {
            logger.warn('Failed to create RedisEventBus, using in-memory', {
              error: error?.message || String(error),
              service: 'event-bus',
            });
            eventBusInstance = new InMemoryEventBus();
          }
        } else {
          logger.warn('Redis not connected, using in-memory bus', {
            status: redis.status,
            service: 'event-bus',
          });
          eventBusInstance = new InMemoryEventBus();
        }
      } else {
        logger.warn('Redis client not available, using in-memory bus', {
          service: 'event-bus',
        });
        eventBusInstance = new InMemoryEventBus();
      }
    } catch (error: any) {
      // Fallback to in-memory if Redis not available
      logger.warn('Redis not available, using in-memory bus', {
        error: error?.message || String(error),
        service: 'event-bus',
      });
      eventBusInstance = new InMemoryEventBus();
    }
  }
  return eventBusInstance;
}

