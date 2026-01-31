/**
 * Shared Package - Main Export
 * Central export point for all shared utilities, types, and configurations
 */

// Config
export * from './config/env';
export * from './config/constants';
export * from './config/errorHandler';
export * from './config/logger';
export * from './config/retryConfig';
export * from './config/rateLimitConfig';
export * from './config/accountLockoutConfig';
export * from './config'; // Includes global-init side-effect

// Database connections
export * from './databases/index';

// Middlewares
export * from './middlewares/authMiddleware';
export * from './middlewares/rateLimiter';
export * from './middlewares/validateRequest';
export * from './middlewares/correlationId';
export * from './middlewares/healthChecks';
export { globalErrorHandler } from './middlewares/globalErrorHandler';

// Utils
export * from './utils/encryption';
export * from './utils/helper';
export * from './utils/responseBuilder';
export * from './utils/tokenManager';
export * from './utils/portHelper';
export * from './utils/notificationClient';
export * from './utils/retryQueue';
export * from './utils/accountLockout';
export * from './utils/httpClient';
export * from './utils/typeGuards';
export * from './utils/errorMessages';
export * from './utils/redisWithTimeout';
export * from './utils/eventBridgeClient';
export * from './utils/s3Client';

// Types
export * from './types/common';

// Services
export * from './src/services/geocoding.service';

// Events
export * from './events/eventBus';
export * from './events/kafkaClient';
export * from './events/types';
export * from './events/idempotentEventEmitter';

// Workers
export * from './worker';

// Config loader (zod-based)
export * from './config/configLoader';

// Side-effect imports (for initialization)
export { default as logger } from './config/logger';
