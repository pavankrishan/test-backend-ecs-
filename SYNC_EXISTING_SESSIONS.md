# How to Sync Existing Sessions

## Problem
If you purchased courses before the session sync was implemented, your sessions exist in `purchase_sessions` but not in `tutoring_sessions`. The frontend queries `tutoring_sessions`, so they won't appear.

## Solution: Use the Sync Endpoint

### Option 1: Sync All Unsynced Sessions (Recommended)

```bash
POST /api/v1/booking/sync-sessions/all
```

This will:
- Find all purchases with assigned trainers
- Find all `purchase_sessions` that don't exist in `tutoring_sessions`
- Sync them automatically

### Option 2: Sync Specific Purchase

If you know the purchase ID:

```bash
POST /api/v1/booking/sync-sessions/:purchaseId
```

### Option 3: Manual SQL Query (Emergency)

If the API endpoints don't work, you can check manually:

```sql
-- Find purchases that need syncing
SELECT 
    cp.id as purchase_id,
    cp.trainer_id,
    cp.course_id,
    COUNT(ps.id) as purchase_sessions_count,
    COUNT(ts.id) as tutoring_sessions_count
FROM course_purchases cp
LEFT JOIN purchase_sessions ps ON ps.purchase_id = cp.id
LEFT JOIN tutoring_sessions ts ON ts.id = ps.id
WHERE cp.trainer_id IS NOT NULL
    AND cp.status = 'ASSIGNED'
GROUP BY cp.id, cp.trainer_id, cp.course_id
HAVING COUNT(ps.id) > COUNT(ts.id);
```

## Testing the Sync

After running the sync, verify:

```sql
-- Count sessions in each table
SELECT 
    'purchase_sessions' as table_name,
    COUNT(*) as count
FROM purchase_sessions ps
JOIN course_purchases cp ON ps.purchase_id = cp.id
WHERE cp.trainer_id IS NOT NULL
UNION ALL
SELECT 
    'tutoring_sessions' as table_name,
    COUNT(*) as count
FROM tutoring_sessions ts
WHERE ts.metadata->>'purchaseId' IS NOT NULL;
```

The counts should match (or tutoring_sessions should be >= purchase_sessions if some were manually created).

## Troubleshooting

### If sync fails:

1. **Check if trainer is assigned:**
   ```sql
   SELECT id, trainer_id, status 
   FROM course_purchases 
   WHERE id = 'your-purchase-id';
   ```

2. **Check if student has GPS coordinates:**
   ```sql
   SELECT student_location 
   FROM course_purchases 
   WHERE id = 'your-purchase-id';
   ```

3. **Check logs** for specific error messages

### Common Issues:

- **No trainer assigned**: Purchase must have `trainer_id` and `status = 'ASSIGNED'`
- **Missing GPS coordinates**: Student location must have valid `latitude` and `longitude`
- **Allocation creation failed**: Check if `trainer_allocations` table exists and is accessible

