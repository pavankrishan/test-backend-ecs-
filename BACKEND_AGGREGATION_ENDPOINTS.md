# Backend Aggregation Endpoints for Bootstrap

## Overview

To support the new bootstrap architecture, backend should provide aggregated endpoints that return all shared data in a single request. This reduces network overhead and ensures consistent data loading.

## Required Endpoints

### 1. Trainer Bootstrap Endpoint

**Endpoint:** `GET /api/v1/trainers/:trainerId/bootstrap`

**Response:**
```typescript
{
  success: true,
  data: {
    overview: {
      profile: TrainerProfile,
      performance: TrainerPerformance,
      documents: Document[],
      location: LocationData
    },
    sessions: Session[], // Summary (limit 200)
    allocations: TrainerAllocation[], // Summary (approved, with details)
    payoutClaims: TrainerPayoutClaim[]
  }
}
```

**Benefits:**
- Single request instead of 4 parallel requests
- Reduced network latency
- Atomic data consistency (all data from same point in time)
- Easier to cache at API gateway level

**Implementation Notes:**
- Should use database transactions or consistent read timestamps
- Can use Redis caching with TTL (5 minutes recommended)
- Should invalidate cache on relevant mutations (session completion, allocation changes, etc.)

### 2. Student Bootstrap Endpoint (Future)

**Endpoint:** `GET /api/v1/students/:studentId/bootstrap`

**Response:**
```typescript
{
  success: true,
  data: {
    overview: {
      profile: StudentProfile,
      progress: ProgressSummary,
      achievements: Achievement[]
    },
    sessions: Session[], // Upcoming sessions
    allocations: StudentAllocation[], // Active allocations
    courses: CourseProgress[] // Course progress summary
  }
}
```

## Redis Cache Strategy

### Cache Keys

```typescript
// Trainer bootstrap cache
`trainer:bootstrap:${trainerId}` // TTL: 5 minutes

// Individual resource caches (for backward compatibility)
`trainer:overview:${trainerId}` // TTL: 5 minutes
`trainer:sessions:${trainerId}` // TTL: 5 minutes
`trainer:allocations:${trainerId}` // TTL: 5 minutes
`trainer:payout-claims:${trainerId}` // TTL: 5 minutes
```

### Cache Invalidation

Cache should be invalidated on:

1. **Session Events:**
   - Session created
   - Session status changed (completed, cancelled, etc.)
   - Session confirmed by student

2. **Allocation Events:**
   - New allocation created
   - Allocation status changed
   - Allocation cancelled

3. **Payout Events:**
   - New payout claim created
   - Payout claim status changed

4. **Profile Events:**
   - Trainer profile updated
   - Performance metrics updated

### Implementation Example

```typescript
// services/trainer-service/src/controllers/trainer.controller.ts

@CacheKey('trainer:bootstrap')
@CacheTTL(300) // 5 minutes
async getBootstrap(req: Request, res: Response) {
  const { trainerId } = req.params;
  
  // Fetch all data in parallel within transaction
  const [overview, sessions, allocations, payoutClaims] = await Promise.all([
    this.trainerService.getOverview(trainerId),
    this.sessionService.getTrainerSessions(trainerId, { limit: 200 }),
    this.allocationService.getTrainerAllocations(trainerId, { status: 'approved', details: true }),
    this.payoutService.getTrainerPayoutClaims(trainerId),
  ]);
  
  return successResponse(res, {
    message: 'Trainer bootstrap data fetched successfully',
    data: {
      overview,
      sessions,
      allocations,
      payoutClaims,
    },
  });
}

// Cache invalidation middleware
async invalidateBootstrapCache(trainerId: string) {
  const redis = getRedisClient();
  await Promise.all([
    redis.del(`trainer:bootstrap:${trainerId}`),
    redis.del(`trainer:overview:${trainerId}`),
    redis.del(`trainer:sessions:${trainerId}`),
    redis.del(`trainer:allocations:${trainerId}`),
    redis.del(`trainer:payout-claims:${trainerId}`),
  ]);
}

// Use in mutation handlers
async completeSession(sessionId: string, trainerId: string) {
  // ... complete session logic
  await invalidateBootstrapCache(trainerId);
  // ... return response
}
```

## Migration Strategy

1. **Phase 1:** Implement bootstrap endpoint (backward compatible with existing endpoints)
2. **Phase 2:** Update mobile app to use bootstrap endpoint
3. **Phase 3:** Deprecate individual endpoints (after mobile app migration)
4. **Phase 4:** Remove individual endpoints (after deprecation period)

## Performance Considerations

- Use database connection pooling
- Optimize queries with proper indexes
- Use Redis for caching to reduce database load
- Consider read replicas for bootstrap endpoints (read-heavy)
- Monitor endpoint performance and add alerts for slow responses

