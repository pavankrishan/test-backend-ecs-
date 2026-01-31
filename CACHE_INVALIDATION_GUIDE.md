# Cache Invalidation Guide

## Problem
After updating purchase metadata in the database, the frontend may still show old cached data.

## Solution: Invalidate Redis Cache

The `AggregationService` uses Redis caching with a 5-minute TTL. After updating database records, you need to invalidate the cache.

### Method 1: Direct Redis Cache Clear (Recommended)

```bash
# Clear learning cache for a specific student
docker exec kodingcaravan-redis sh -c "redis-cli DEL 'student:learning:809556c1-e184-4b85-8fd6-a5f1c8014bf6'"

# Clear home cache for a specific student
docker exec kodingcaravan-redis sh -c "redis-cli DEL 'student:home:809556c1-e184-4b85-8fd6-a5f1c8014bf6'"

# Clear both
docker exec kodingcaravan-redis sh -c "redis-cli DEL 'student:learning:809556c1-e184-4b85-8fd6-a5f1c8014bf6' 'student:home:809556c1-e184-4b85-8fd6-a5f1c8014bf6'"
```

### Method 2: Restart Student Service

```bash
docker restart kodingcaravan-student-service
```

This will clear all in-memory caches, but Redis cache will persist until TTL expires.

### Method 3: Use API Endpoint (If accessible)

```bash
POST /api/v1/students/:studentId/invalidate-cache
```

Example:
```bash
curl -X POST http://localhost:3002/api/v1/students/809556c1-e184-4b85-8fd6-a5f1c8014bf6/invalidate-cache
```

## Cache Keys

- Learning cache: `student:learning:{studentId}`
- Home cache: `student:home:{studentId}`

## After Cache Invalidation

1. Wait 2-3 seconds for the cache to clear
2. Refresh your frontend app
3. The next API call will fetch fresh data from the database
4. The updated purchase metadata should now appear

## Verification

After invalidating cache, test the API:

```bash
# Test learning API
curl http://localhost:3002/api/v1/students/809556c1-e184-4b85-8fd6-a5f1c8014bf6/learning
```

The response should include the updated purchase metadata.

