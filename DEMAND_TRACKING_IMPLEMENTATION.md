# Demand Tracking Implementation

## Overview

Enterprise-grade demand tracking system that blocks purchases when no trainers are available while tracking demand signals for analytics and hiring decisions.

## Architecture

### Database Schema

**Table: `demand_signals`**
- `id` (UUID, Primary Key)
- `course_id` (UUID, Foreign Key → courses)
- `user_id` (UUID, Foreign Key → students)
- `city_id` (UUID, Nullable, Foreign Key → cities)
- `signal_type` (ENUM: COURSE_VIEW, CHECKOUT_STARTED, PURCHASE_BLOCKED, WAITLIST)
- `reason` (TEXT, Nullable)
- `metadata` (JSONB, Nullable)
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ)

**Indexes:**
- `idx_demand_signals_course_id` - For course-based queries
- `idx_demand_signals_city_id` - For city-based queries
- `idx_demand_signals_signal_type` - For signal type filtering
- `idx_demand_signals_created_at` - For date range queries
- `idx_demand_signals_analytics` - Composite index for analytics queries

### Backend Services

#### 1. DemandTrackingService (`demandTracking.service.ts`)

**Methods:**
- `createDemandSignal()` - Create any demand signal
- `logPurchaseBlocked()` - Log when purchase is blocked due to no trainer
- `registerWaitlist()` - Register user for waitlist
- `getCourseDemandAnalytics()` - Get analytics for a specific course
- `getAllCoursesDemandAnalytics()` - Get analytics for all courses
- `isUserOnWaitlist()` - Check if user is on waitlist

#### 2. AllocationService Integration

The `checkTrainerAvailabilityForCourse()` method now:
- Returns availability status
- Frontend logs demand signal when purchase is blocked
- Maintains HARD enforcement (no purchase without trainer)

### API Endpoints

#### User Endpoints (Authenticated)
- `POST /api/v1/admin/demand/waitlist` - Register for waitlist
- `POST /api/v1/admin/demand/purchase-blocked` - Log purchase blocked signal
- `GET /api/v1/admin/demand/waitlist/check?courseId={id}` - Check waitlist status

#### Admin Endpoints (Admin Auth Required)
- `GET /api/v1/admin/demand/analytics?courseId={id}&cityId={id}&startDate={date}&endDate={date}` - Get demand analytics

### Frontend Integration

#### Purchase Flow
1. User clicks "Checkout"
2. System checks trainer availability
3. If no trainers:
   - Logs `PURCHASE_BLOCKED` signal
   - Shows alert: "Course Currently Unavailable"
   - Offers "Notify Me" button
4. If user clicks "Notify Me":
   - Registers for waitlist
   - Logs `WAITLIST` signal

#### API Functions (`demandTracking.ts`)
- `registerWaitlist()` - Register user
- `logPurchaseBlocked()` - Log blocked purchase
- `checkWaitlist()` - Check waitlist status

## Analytics Queries

### Get Demand by Course
```sql
SELECT 
  course_id,
  COUNT(*) as total_signals,
  COUNT(*) FILTER (WHERE signal_type = 'PURCHASE_BLOCKED') as blocked_count,
  COUNT(*) FILTER (WHERE signal_type = 'WAITLIST') as waitlist_count
FROM demand_signals
WHERE course_id = $1
  AND created_at >= $2
  AND created_at <= $3
GROUP BY course_id;
```

### Get Demand by City
```sql
SELECT 
  city_id,
  course_id,
  COUNT(*) as total_signals
FROM demand_signals
WHERE city_id = $1
  AND created_at >= $2
  AND created_at <= $3
GROUP BY city_id, course_id;
```

### Top Courses by Demand
```sql
SELECT 
  course_id,
  COUNT(*) as total_demand
FROM demand_signals
WHERE signal_type IN ('PURCHASE_BLOCKED', 'WAITLIST')
  AND created_at >= $1
  AND created_at <= $2
GROUP BY course_id
ORDER BY total_demand DESC
LIMIT 10;
```

## Constraints & Rules

1. **HARD Enforcement**: No purchase allowed without approved trainer
2. **Demand Tracking**: All blocked purchases are logged
3. **Waitlist**: Users can register for notifications
4. **Analytics Ready**: All queries support date ranges and filtering
5. **Extensible**: Ready for PREBOOKING mode (future)

## Migration

Run migration:
```bash
psql -d your_database -f kc-backend/migrations/018-create-demand-signals-table.sql
```

## Testing

### Test Purchase Blocked Flow
1. Create a course with no trainers
2. Attempt purchase
3. Verify:
   - Purchase is blocked
   - `PURCHASE_BLOCKED` signal is logged
   - Alert shows "Notify Me" option

### Test Waitlist Flow
1. Click "Notify Me" on blocked purchase
2. Verify:
   - `WAITLIST` signal is logged
   - User is registered
   - Duplicate registrations are handled

### Test Analytics
1. Query analytics endpoint
2. Verify:
   - Aggregations are correct
   - Date filtering works
   - City filtering works

## Future Enhancements

1. **Email Notifications**: Notify users when trainers become available
2. **Admin Dashboard**: Visual analytics dashboard
3. **Prebooking Mode**: Allow purchases without immediate trainer allocation
4. **Demand Forecasting**: ML-based demand prediction
