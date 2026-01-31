// Export config utilities
export * from './env';
export * from './constants';
export * from './errorHandler';
export * from './configLoader';

// Side-effect initialization
export { default as logger } from './logger';
export { default } from './logger';

// Re-export global-init for side effects
import './global-init';

