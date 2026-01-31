/**
 * Safe Connection Pool Limits
 * Purpose: Prevent PostgreSQL max_connections exhaustion
 * Calculation: 150 max_connections - 20 reserved = 130 / 10 services = 13 max per service
 * Conservative: 10 per service
 */

export const SAFE_POOL_LIMITS = {
  // Production limits (per service instance)
  PRODUCTION_MAX: 10,
  PRODUCTION_MIN: 2,
  
  // Read replica limits (per service instance)
  READ_REPLICA_MAX: 5,
  READ_REPLICA_MIN: 1,
  
  // Development limits (higher for local dev)
  DEVELOPMENT_MAX: 20,
  DEVELOPMENT_MIN: 1,
  
  // Get appropriate limits based on environment
  getMax: (): number => {
    const env = process.env.NODE_ENV || 'development';
    return env === 'production' ? SAFE_POOL_LIMITS.PRODUCTION_MAX : SAFE_POOL_LIMITS.DEVELOPMENT_MAX;
  },
  
  getMin: (): number => {
    const env = process.env.NODE_ENV || 'development';
    return env === 'production' ? SAFE_POOL_LIMITS.PRODUCTION_MIN : SAFE_POOL_LIMITS.DEVELOPMENT_MIN;
  },
  
  getReadMax: (): number => {
    return SAFE_POOL_LIMITS.READ_REPLICA_MAX;
  },
  
  getReadMin: (): number => {
    return SAFE_POOL_LIMITS.READ_REPLICA_MIN;
  },
};

