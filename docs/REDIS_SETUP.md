# Redis Setup Guide

## Overview

This project supports both **local Redis** and **Upstash Redis** (managed cloud Redis with TLS).

## Configuration

### Option 1: Upstash Redis (Recommended for Production)

Upstash Redis is already configured in `env.template`:

```env
REDIS_URL=rediss://default:AYWdAAIncDJjYjBlN2I1ZjBhNmI0MTg5ODkyOWIxNTcxOWZlY2QxN3AyMzQyMDU@lasting-macaque-34205.upstash.io:6379
```

**Note:** The `rediss://` protocol indicates TLS is enabled (required for Upstash).

### Option 2: Local Redis

If you want to use local Redis instead, comment out `REDIS_URL` and configure:

```env
# REDIS_URL=...
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_TLS=false
```

## Testing Connection

### Method 1: Using Test Script

```bash
cd koding-caravan-mapp-be
npx tsx scripts/test-redis.ts
```

### Method 2: Using Redis CLI (if installed)

For Upstash:
```bash
redis-cli --tls -u rediss://default:AYWdAAIncDJjYjBlN2I1ZjBhNmI0MTg5ODkyOWIxNTcxOWZlY2QxN3AyMzQyMDU@lasting-macaque-34205.upstash.io:6379 ping
```

For local:
```bash
redis-cli ping
```

## Using Redis in Your Services

### 1. Import Redis Connection

```typescript
import { getRedisClient } from '@kodingcaravan/shared/databases/redis/connection';
```

### 2. Create Redis Client

```typescript
// In your service initialization
const redis = getRedisClient();
```

### 3. Use Redis Operations

```typescript
// String operations
await redis.set('key', 'value', 'EX', 3600); // Set with expiration
const value = await redis.get('key');

// Hash operations
await redis.hset('user:123', { name: 'John', email: 'john@example.com' });
const user = await redis.hgetall('user:123');

// List operations
await redis.lpush('queue:orders', 'order1', 'order2');
const order = await redis.rpop('queue:orders');

// Set operations
await redis.sadd('online:users', 'user1', 'user2');
const isOnline = await redis.sismember('online:users', 'user1');

// Sorted sets (for leaderboards, rankings)
await redis.zadd('leaderboard', 100, 'user1', 200, 'user2');
const topUsers = await redis.zrevrange('leaderboard', 0, 9);
```

### 4. Close Connection (on service shutdown)

```typescript
import { closeRedisConnection } from '@kodingcaravan/shared/databases/redis/connection';

// On service shutdown
await closeRedisConnection(redis);
```

## Use Cases for Your Modules

### Courses Module

```typescript
// Cache course listings
await redis.setex(`course:${courseId}`, 3600, JSON.stringify(course));

// Cache popular courses
await redis.zadd('courses:popular', views, courseId);

// Cache course search results
await redis.setex(`search:${query}`, 300, JSON.stringify(results));
```

### Payment Module

```typescript
// Store payment session data
await redis.setex(`payment:session:${sessionId}`, 1800, JSON.stringify(paymentData));

// Payment rate limiting
const attempts = await redis.incr(`payment:attempts:${userId}`);
if (attempts === 1) {
  await redis.expire(`payment:attempts:${userId}`, 3600);
}

// Payment queue
await redis.lpush('payments:queue', JSON.stringify(paymentRequest));
```

### Live Location Module

```typescript
// Store current location
await redis.setex(`location:${userId}`, 60, JSON.stringify({ lat, lng, timestamp }));

// Location history (using sorted sets)
await redis.zadd(`location:history:${userId}`, Date.now(), JSON.stringify({ lat, lng }));

// Nearby users (using geospatial)
await redis.geoadd('locations', lng, lat, userId);
const nearby = await redis.georadius('locations', lng, lat, 5, 'km');
```

## Environment Variables

Make sure to copy `env.template` to `.env` and set your Redis configuration:

```bash
cp env.template .env
# Edit .env with your Redis settings
```

## Troubleshooting

### Connection Timeout

- Check if `REDIS_URL` is set correctly
- Verify Upstash credentials are valid
- Check network/firewall settings

### TLS Errors

- Ensure `rediss://` (with double 's') is used for Upstash
- For local Redis, use `redis://` and set `REDIS_TLS=false`

### Authentication Errors

- Verify password in `REDIS_URL` is correct
- Check if Upstash instance is active

## Best Practices

1. **Always set expiration** for cached data
2. **Use namespaces** for keys (e.g., `course:123`, `user:456`)
3. **Handle connection errors** gracefully
4. **Close connections** on service shutdown
5. **Use Redis for**:
   - Caching
   - Session storage
   - Rate limiting
   - Real-time data (location, presence)
   - Queues and pub/sub

6. **Don't use Redis for**:
   - Primary data storage (use PostgreSQL/MongoDB)
   - Large binary data (use S3)
   - Complex queries (use databases)

## Resources

- [ioredis Documentation](https://github.com/redis/ioredis)
- [Upstash Redis Docs](https://docs.upstash.com/redis)
- [Redis Commands](https://redis.io/commands)

