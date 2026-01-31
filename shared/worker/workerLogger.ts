/**
 * Worker Logger
 * 
 * Structured logging for workers with correlation ID tracking.
 */

import logger from '../config/logger';

export interface WorkerLogContext {
  correlationId?: string;
  eventId?: string;
  workerName?: string;
  operation?: string;
  [key: string]: unknown;
}

/**
 * Log with correlation ID context
 */
export function logWithContext(
  level: 'info' | 'warn' | 'error',
  message: string,
  context: WorkerLogContext = {}
): void {
  const logData = {
    ...context,
    message,
    timestamp: new Date().toISOString(),
  };

  switch (level) {
    case 'info':
      logger.info(message, logData);
      break;
    case 'warn':
      logger.warn(message, logData);
      break;
    case 'error':
      logger.error(message, logData);
      break;
  }
}

/**
 * Extract correlation ID from event
 */
export function getEventCorrelationId(event: { _metadata?: { correlationId?: string } }): string {
  return event._metadata?.correlationId || 'unknown';
}

/**
 * Extract event ID from event
 */
export function getEventId(event: { _metadata?: { eventId?: string } }): string {
  return event._metadata?.eventId || 'unknown';
}

