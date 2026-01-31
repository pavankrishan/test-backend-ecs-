# Purchase Verification & Fix Guide

## Current Situation
- ✅ Database has data (77 tables, payments, purchases exist)
- ✅ Payment exists in `payments` table
- ❓ Purchase may or may not exist in `student_course_purchases` table
- ❓ Frontend not showing the purchased course

## Data Flow

### 1. Payment → Purchase Flow
```
Payment Confirmed (payments table)
  ↓
PURCHASE_CONFIRMED event emitted
  ↓
Purchase Worker processes event
  ↓
Creates record in student_course_purchases table
```

### 2. Frontend Display Flow
```
Frontend calls: GET /api/v1/students/:studentId/learning
  ↓
Student Service: getLearningData()
  ↓
Queries: student_course_purchases (WHERE is_active = true)
  ↓
Fetches course details
  ↓
Combines purchases with courses
  ↓
Returns to frontend
```

## Verification Steps

### Step 1: Check Purchase in Database
```sql
-- Check if purchase exists
SELECT id, student_id, course_id, purchase_tier, is_active, created_at
FROM student_course_purchases
WHERE student_id = '809556c1-e184-4b85-8fd6-a5f1c8014bf6'
  AND course_id = '9e16d892-4324-4568-be60-163aa1665683'
  AND is_active = true;
```

**Expected**: Should return 1 row with `is_active = true`

### Step 2: Check Payment Metadata
```sql
-- Check payment has courseId
SELECT id, status, metadata
FROM payments
WHERE student_id = '809556c1-e184-4b85-8fd6-a5f1c8014bf6'
  AND status = 'succeeded'
ORDER BY created_at DESC
LIMIT 1;
```

**Expected**: `metadata->>'courseId'` should match the course ID

### Step 3: Test Purchase API
```bash
GET http://localhost:3005/api/v1/students/809556c1-e184-4b85-8fd6-a5f1c8014bf6/courses/9e16d892-4324-4568-be60-163aa1665683/purchase
```

**Expected**: Returns purchase data with status 200

### Step 4: Test Learning Data API
```bash
GET http://localhost:3002/api/v1/students/809556c1-e184-4b85-8fd6-a5f1c8014bf6/learning
```

**Expected**: Returns courses array with the purchased course included

### Step 5: Check Redis Cache
The learning data is cached in Redis. If cache is stale, it won't show new purchases.

**Solution**: Clear cache or wait for TTL (5 minutes)

## Common Issues & Fixes

### Issue 1: Purchase Doesn't Exist
**Symptom**: Payment exists but no purchase record

**Fix**: Create purchase manually or re-trigger event
```sql
INSERT INTO student_course_purchases 
(student_id, course_id, purchase_tier, metadata, is_active, created_at, updated_at)
VALUES 
('809556c1-e184-4b85-8fd6-a5f1c8014bf6', '9e16d892-4324-4568-be60-163aa1665683', 30, '{}', true, NOW(), NOW())
ON CONFLICT (student_id, course_id) WHERE is_active = true
DO UPDATE SET updated_at = NOW();
```

### Issue 2: Purchase is Inactive
**Symptom**: Purchase exists but `is_active = false`

**Fix**: Activate the purchase
```sql
UPDATE student_course_purchases
SET is_active = true, updated_at = NOW()
WHERE student_id = '809556c1-e184-4b85-8fd6-a5f1c8014bf6'
  AND course_id = '9e16d892-4324-4568-be60-163aa1665683';
```

### Issue 3: Cache Issue
**Symptom**: Purchase exists but frontend doesn't show it

**Fix**: Clear Redis cache
```bash
# In Redis CLI or via API
DEL student:learning:809556c1-e184-4b85-8fd6-a5f1c8014bf6
```

### Issue 4: Course Doesn't Exist
**Symptom**: Purchase exists but course record missing

**Fix**: The API should still return the purchase with a fallback course object (see aggregation.service.ts line 330-356)

## Quick Fix Script

If purchase doesn't exist, create it:

```javascript
// Run in course-service container
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

const studentId = '809556c1-e184-4b85-8fd6-a5f1c8014bf6';
const courseId = '9e16d892-4324-4568-be60-163aa1665683';

async function createPurchase() {
  const result = await pool.query(
    `INSERT INTO student_course_purchases 
     (student_id, course_id, purchase_tier, metadata, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, true, NOW(), NOW())
     ON CONFLICT (student_id, course_id) WHERE is_active = true
     DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [studentId, courseId, 30, JSON.stringify({})]
  );
  console.log('Purchase created:', result.rows[0].id);
  await pool.end();
}

createPurchase();
```

## Verification Checklist

- [ ] Purchase exists in `student_course_purchases` table
- [ ] Purchase has `is_active = true`
- [ ] Purchase API returns the purchase
- [ ] Learning data API includes the course
- [ ] Redis cache is cleared or expired
- [ ] Frontend refreshes data

