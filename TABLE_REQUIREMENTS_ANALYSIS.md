# Database Table Requirements Analysis

## Learnings Screen Data Requirements

### Required Data Fields (from CourseCard.tsx):
1. **Course Info**: `courseName`, `courseId`, `duration`
2. **Purchase Metadata**:
   - `startDate` / `schedule.startDate` / `schedule.date`
   - `classTime` / `schedule.timeSlot` / `timeSlot`
   - `classTypeId` / `classTypeTitle`
   - `sessionCount` / `purchaseTier`
   - `scheduleType` / `scheduleMode`
   - `studentAddress` / `location`
3. **Trainer Info**: `trainerId`, `trainerName`, `trainerPhoto`
4. **Progress**: `progress` / `percentage`
5. **Status**: `status` (ongoing/completed)

## Current Problem

**Issue**: `student_course_purchases.metadata` is empty, but `payments.metadata` has all details.

**Root Cause**: Purchase worker doesn't fetch payment metadata when creating purchase.

## Required Tables (Core - 9 tables)

### 1. **`student_course_purchases`** ⭐ CRITICAL
- **Purpose**: Store purchase records with complete metadata
- **Required Fields**: 
  - `id`, `student_id`, `course_id`, `purchase_tier`
  - **`metadata`** (JSONB) - MUST contain all payment details
- **Status**: ✅ EXISTS but metadata is incomplete

### 2. **`payments`** ⭐ CRITICAL
- **Purpose**: Payment transactions (source of truth for metadata)
- **Required Fields**: `id`, `student_id`, `status`, **`metadata`** (JSONB)
- **Status**: ✅ EXISTS with complete data

### 3. **`courses`** ⭐ REQUIRED
- **Purpose**: Course details
- **Required Fields**: `id`, `title`, `description`, `duration`, `thumbnail_url`
- **Status**: ✅ EXISTS

### 4. **`trainer_allocations`** ⭐ REQUIRED
- **Purpose**: Trainer assignment to students
- **Required Fields**: `id`, `student_id`, `course_id`, `trainer_id`, `status`
- **Status**: ✅ EXISTS

### 5. **`trainers`** ⭐ REQUIRED
- **Purpose**: Trainer information
- **Required Fields**: `id`, `full_name`, `avatar_url`
- **Status**: ✅ EXISTS

### 6. **`student_progress`** or **`student_course_progress`** ⭐ REQUIRED
- **Purpose**: Progress tracking
- **Required Fields**: `student_id`, `course_id`, `progress` / `percentage`
- **Status**: ✅ EXISTS

### 7. **`students`** ⭐ REQUIRED
- **Purpose**: Student information
- **Status**: ✅ EXISTS

### 8. **`course_phases`**, **`course_levels`**, **`course_sessions`** ⭐ REQUIRED
- **Purpose**: Course structure
- **Status**: ✅ EXISTS

### 9. **`tutoring_sessions`** or **`session_bookings`** ⭐ REQUIRED
- **Purpose**: Session records
- **Status**: ✅ EXISTS

## Supporting Tables (Important - ~15 tables)

### Booking/Session Related:
- `session_bookings` - Session bookings
- `pre_bookings` - Pre-booking records
- `schedule_slots` - Available time slots
- `attendance_records` - Attendance tracking

### Admin/Management:
- `admin_users` - Admin users
- `franchises` - Franchise information
- `zones` - Zone management
- `cities`, `clusters`, `pincodes` - Location data

### Financial:
- `coin_wallets` - Student coin balances
- `coin_transactions` - Coin transaction history
- `coupons`, `coupon_redemptions` - Coupon system

### Other:
- `certificates` - Course completion certificates
- `referrals` - Referral tracking
- `location_tracking_sessions`, `location_updates` - GPS tracking
- `safety_incidents` - Safety reporting

## Potentially Unnecessary Tables (~53 tables)

These tables may be:
- Legacy from old architecture
- Migration backups
- Unused features
- Duplicate data structures

**Need to verify each table's usage in codebase**

## Fix Applied

### Updated Purchase Worker
**File**: `kc-backend/services/purchase-worker/src/index.ts`

**Change**: Purchase worker now fetches complete metadata from `payments` table before creating purchase record.

**Flow**:
1. Receive PURCHASE_CONFIRMED event
2. Fetch payment record from `payments` table
3. Extract complete metadata from payment
4. Create purchase with complete metadata
5. All payment details now stored in `student_course_purchases.metadata`

## Verification

After fix, verify:
1. `student_course_purchases.metadata` contains all required fields
2. Learnings screen displays all course details correctly
3. No data loss from payment to purchase

