# Purchase Data Storage

This document explains where purchase-related data is stored in the database.

## Tables Overview

### 1. `student_course_purchases` Table
**Location:** Course Service Database (PostgreSQL)  
**Purpose:** Stores the actual course purchase records with session tiers

**Schema:**
```sql
CREATE TABLE student_course_purchases (
  id UUID PRIMARY KEY,
  student_id UUID NOT NULL,           -- Student who purchased
  course_id UUID NOT NULL,             -- Course purchased
  purchase_tier INTEGER NOT NULL,       -- 10, 20, or 30 sessions
  purchase_date TIMESTAMPTZ,           -- When purchased
  expiry_date TIMESTAMPTZ,             -- When purchase expires
  is_active BOOLEAN DEFAULT true,      -- Whether purchase is active
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

**Key Fields:**
- `purchase_tier`: The number of sessions purchased (10, 20, or 30)
- `student_id`: Links to the student
- `course_id`: Links to the course
- `is_active`: Whether this purchase is currently active

**Example Data:**
```
id: 06e798ae-3173-4b5e-81fd-330a7cab3514
student_id: be36fafb-5cfa-444e-822b-132f071f9408
course_id: 9e16d892-4324-4568-be60-163aa1665683
purchase_tier: 20  ← This should be 20, not 30!
purchase_date: 2025-11-27 13:24:18
is_active: true
```

---

### 2. `payments` Table
**Location:** Payment Service Database (PostgreSQL)  
**Purpose:** Stores payment transactions with metadata (sessionCount, time, type, course name)

**Schema:**
```sql
CREATE TABLE payments (
  id UUID PRIMARY KEY,
  student_id UUID NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency VARCHAR(10) DEFAULT 'INR',
  status VARCHAR(20) DEFAULT 'initiated',  -- 'succeeded', 'failed', etc.
  payment_method VARCHAR(50),
  provider VARCHAR(50),                     -- 'razorpay', etc.
  provider_payment_id TEXT,
  description TEXT,
  metadata JSONB,                           ← All purchase details stored here!
  payment_url TEXT,
  expires_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

**Key Field:**
- `metadata` (JSONB): Contains all purchase details:
  ```json
  {
    "sessionCount": "20",              ← Number of sessions
    "courseId": "9e16d892-...",        ← Course ID
    "timeSlot": "4:00 PM",             ← Time
    "classTypeId": "1-on-1",           ← Type
    "learningMode": "home",             ← Type
    "groupSize": "1",                  ← Type
    "schedule": {
      "date": "2025-11-27",
      "timeSlot": "4:00 PM"
    },
    "pricing": {
      "finalPrice": 3000,
      "basePricePerSession": 150
    }
  }
  ```

**Example Data:**
```
id: 4b992874-3d61-4d9a-8b1b-652f30191ca9
student_id: be36fafb-5cfa-444e-822b-132f071f9408
status: 'succeeded'
metadata: {
  "sessionCount": "20",           ← Actual purchase: 20 sessions
  "courseId": "9e16d892-4324-4568-be60-163aa1665683",
  "timeSlot": "4:00 PM",
  "classTypeId": "1-on-1",
  "learningMode": "home",
  "schedule": {
    "date": "2025-11-27",
    "timeSlot": "4:00 PM"
  }
}
```

---

### 3. `courses` Table
**Location:** Course Service Database (PostgreSQL)  
**Purpose:** Stores course information

**Schema:**
```sql
CREATE TABLE courses (
  id UUID PRIMARY KEY,
  title VARCHAR(255) NOT NULL,        ← Course name
  description TEXT,
  price DECIMAL(10,2),
  -- ... other fields
);
```

---

## Data Flow

1. **Payment Created** → Stored in `payments` table with `metadata` containing:
   - `sessionCount`: "20"
   - `courseId`: Course UUID
   - `timeSlot`: "4:00 PM"
   - `classTypeId`: "1-on-1"
   - `learningMode`: "home"

2. **Purchase Record Created** → Stored in `student_course_purchases` table:
   - `purchase_tier`: Extracted from `metadata.sessionCount` (should be 20)
   - `student_id`: From payment
   - `course_id`: From `metadata.courseId`

3. **Problem:** If `metadata.sessionCount` is a string or not parsed correctly, `purchase_tier` defaults to 30 instead of the actual value (20).

---

## How to Query Purchase Data

### Get Purchase with Payment Metadata:
```sql
SELECT 
  scp.id,
  scp.student_id,
  scp.course_id,
  scp.purchase_tier,
  c.title as course_name,
  p.metadata->>'sessionCount' as payment_session_count,
  p.metadata->>'timeSlot' as payment_time_slot,
  p.metadata->>'classTypeId' as payment_class_type,
  p.metadata->>'learningMode' as payment_learning_mode
FROM student_course_purchases scp
LEFT JOIN courses c ON c.id = scp.course_id
LEFT JOIN payments p ON p.student_id = scp.student_id 
  AND (p.metadata->>'courseId')::uuid = scp.course_id
  AND p.status = 'succeeded'
WHERE scp.is_active = true;
```

### Update Purchase Tier from Payment Metadata:
```sql
UPDATE student_course_purchases scp
SET purchase_tier = (
  SELECT 
    CASE 
      WHEN (p.metadata->>'sessionCount')::integer IN (10, 20, 30) 
      THEN (p.metadata->>'sessionCount')::integer
      ELSE scp.purchase_tier
    END
  FROM payments p
  WHERE p.student_id = scp.student_id
    AND (p.metadata->>'courseId')::uuid = scp.course_id
    AND p.status = 'succeeded'
  ORDER BY p.created_at DESC
  LIMIT 1
)
WHERE scp.is_active = true;
```

---

## Summary

- **Purchase Tier (10/20/30 sessions)**: `student_course_purchases.purchase_tier`
- **Session Count (from payment)**: `payments.metadata->>'sessionCount'`
- **Time Slot**: `payments.metadata->>'timeSlot'`
- **Class Type**: `payments.metadata->>'classTypeId'` + `learningMode`
- **Course Name**: `courses.title`

**Note:** The `payments` table might be in a different database than `student_course_purchases`. If so, you'll need to query them separately or use database federation.

