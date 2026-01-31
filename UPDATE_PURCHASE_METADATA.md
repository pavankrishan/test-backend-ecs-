# Update Purchase Metadata - Manual Instructions

## Problem
The existing purchase in `student_course_purchases` has empty metadata, but all required data exists in the `payments` table.

## Solution
Copy metadata from the `payments` table to `student_course_purchases.metadata`.

## SQL Query to Run

Run this in pgAdmin or via psql:

```sql
-- Step 1: Find the payment metadata
SELECT id, metadata 
FROM payments 
WHERE student_id = '809556c1-e184-4b85-8fd6-a5f1c8014bf6'
  AND status = 'succeeded'
  AND (metadata->>'courseId' = '9e16d892-4324-4568-be60-163aa1665683' 
       OR metadata->>'course_id' = '9e16d892-4324-4568-be60-163aa1665683')
ORDER BY created_at DESC 
LIMIT 1;

-- Step 2: Update the purchase with payment metadata
UPDATE student_course_purchases scp
SET metadata = (
  SELECT metadata 
  FROM payments p
  WHERE p.student_id = scp.student_id
    AND p.status = 'succeeded'
    AND (p.metadata->>'courseId' = scp.course_id::text 
         OR p.metadata->>'course_id' = scp.course_id::text)
  ORDER BY p.created_at DESC
  LIMIT 1
),
updated_at = NOW()
WHERE scp.student_id = '809556c1-e184-4b85-8fd6-a5f1c8014bf6'
  AND scp.course_id = '9e16d892-4324-4568-be60-163aa1665683'
  AND scp.is_active = true;

-- Step 3: Verify the update
SELECT id, metadata 
FROM student_course_purchases 
WHERE student_id = '809556c1-e184-4b85-8fd6-a5f1c8014bf6'
  AND course_id = '9e16d892-4324-4568-be60-163aa1665683'
  AND is_active = true;
```

## Alternative: Using Node.js Script

If you prefer to run the script, copy `update-purchase-simple.js` to the container:

```bash
docker cp kc-backend/update-purchase-simple.js kodingcaravan-course-service:/app/update-purchase.js
docker exec kodingcaravan-course-service sh -c "cd /app && node update-purchase.js"
```

## What This Does

1. Finds the payment record for the student and course
2. Extracts the complete metadata from the payment
3. Updates the purchase record with the payment metadata
4. Ensures all required fields are present:
   - `startDate`
   - `classTime` / `timeSlot`
   - `classTypeId`
   - `sessionCount`
   - `scheduleType`
   - All other payment details

## After Update

1. Refresh your frontend app
2. Check the learnings screen
3. The purchased course should now display with all details

