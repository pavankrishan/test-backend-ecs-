# Purchase Fix - Cloud Database Only

## Root Cause
- All services use **cloud database** (Render.com) via `POSTGRES_URL`
- `processed_events` table was missing in cloud database
- Purchase was never created because event emission failed
- Frontend reads from cloud database via Course Service API

## Fixes Applied

### 1. Added `processed_events` Table Creation
**File**: `kc-backend/services/course-service/src/models/courseStructure.model.ts`

Added table creation in `createCourseStructureTables()` function:
```sql
CREATE TABLE IF NOT EXISTS processed_events (
  event_id UUID PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  correlation_id UUID NOT NULL,
  payload JSONB NOT NULL,
  source VARCHAR(100) NOT NULL,
  version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 2. Fixed Purchase Worker Schema
**File**: `kc-backend/services/purchase-worker/src/index.ts`

Removed `start_date` column reference (table uses `purchase_date` instead).

## Next Steps to Complete Fix

### Option 1: Re-trigger Payment Confirmation (Recommended)
After course-service restarts, the `processed_events` table will be created. Then:
1. Re-confirm the payment via payment API
2. Event will be emitted successfully
3. Purchase worker will create purchase in cloud database

### Option 2: Create Purchase via Course Service API
Call the API directly:
```bash
POST http://localhost:3005/api/v1/purchases
Content-Type: application/json

{
  "studentId": "809556c1-e184-4b85-8fd6-a5f1c8014bf6",
  "courseId": "9e16d892-4324-4568-be60-163aa1665683",
  "purchaseTier": 30,
  "metadata": {}
}
```

### Option 3: Manual SQL (If you have cloud DB access)
```sql
INSERT INTO student_course_purchases 
(student_id, course_id, purchase_tier, metadata, is_active, created_at, updated_at)
VALUES 
('809556c1-e184-4b85-8fd6-a5f1c8014bf6', '9e16d892-4324-4568-be60-163aa1665683', 30, '{}', true, NOW(), NOW())
ON CONFLICT (student_id, course_id) WHERE is_active = true
DO UPDATE SET updated_at = NOW();
```

## Verification

After purchase is created, verify via:
```bash
GET http://localhost:3005/api/v1/students/809556c1-e184-4b85-8fd6-a5f1c8014bf6/courses/9e16d892-4324-4568-be60-163aa1665683/purchase
```

Expected response:
```json
{
  "success": true,
  "data": {
    "id": "...",
    "studentId": "809556c1-e184-4b85-8fd6-a5f1c8014bf6",
    "courseId": "9e16d892-4324-4568-be60-163aa1665683",
    "purchaseTier": 30,
    "isActive": true
  }
}
```

## Important Notes

- **All services use cloud database** - no local database should be used
- `processed_events` table will be created automatically when course-service starts
- Purchase must exist in **cloud database** for frontend to show it
- Frontend fetches from: `GET /api/v1/students/:studentId/courses/:courseId/purchase`

