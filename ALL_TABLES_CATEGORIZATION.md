# All 77 Tables - Categorization & Requirements

## Core Tables (REQUIRED - 9 tables)

These tables are essential for the app to function:

1. **`student_course_purchases`** ⭐⭐⭐
   - **Purpose**: Purchase records with metadata
   - **Critical**: Must have complete metadata from payments
   - **Used by**: Learnings screen, course access control

2. **`payments`** ⭐⭐⭐
   - **Purpose**: Payment transactions (source of truth for purchase metadata)
   - **Critical**: Contains all purchase details in metadata
   - **Used by**: Payment flow, purchase creation

3. **`courses`** ⭐⭐⭐
   - **Purpose**: Course information
   - **Used by**: All course-related screens

4. **`trainer_allocations`** ⭐⭐⭐
   - **Purpose**: Trainer assignment to students
   - **Used by**: Learnings screen (trainer info)

5. **`trainers`** ⭐⭐⭐
   - **Purpose**: Trainer details
   - **Used by**: Learnings screen, allocation system

6. **`student_progress`** or **`student_course_progress`** ⭐⭐⭐
   - **Purpose**: Course progress tracking
   - **Used by**: Learnings screen (progress bar)

7. **`students`** ⭐⭐⭐
   - **Purpose**: Student information
   - **Used by**: All student-related features

8. **`course_phases`**, **`course_levels`**, **`course_sessions`** ⭐⭐⭐
   - **Purpose**: Course structure
   - **Used by**: Course content, progress tracking

9. **`tutoring_sessions`** or **`session_bookings`** ⭐⭐⭐
   - **Purpose**: Session records
   - **Used by**: Session management, progress

## Booking & Session Tables (REQUIRED - 5 tables)

10. **`session_bookings`** ⭐⭐
    - Session bookings

11. **`pre_bookings`** ⭐⭐
    - Pre-booking records

12. **`schedule_slots`** ⭐⭐
    - Available time slots

13. **`attendance_records`** ⭐⭐
    - Attendance tracking

14. **`purchase_sessions`** ⭐⭐
    - Individual sessions within a purchase

## Admin & Management Tables (REQUIRED - 8 tables)

15. **`admin_users`** ⭐⭐
    - Admin user accounts

16. **`franchises`** ⭐⭐
    - Franchise information

17. **`zones`** ⭐⭐
    - Zone management

18. **`cities`** ⭐⭐
    - City data

19. **`clusters`** ⭐⭐
    - Cluster management

20. **`pincodes`** ⭐⭐
    - Pincode resolver

21. **`course_purchases`** ⭐
    - Legacy purchase table? (check if used)

22. **`feature_flags`** ⭐
    - Feature toggles

## Financial Tables (REQUIRED - 4 tables)

23. **`coin_wallets`** ⭐⭐
    - Student coin balances

24. **`coin_transactions`** ⭐⭐
    - Coin transaction history

25. **`coupons`** ⭐
    - Coupon definitions

26. **`coupon_redemptions`** ⭐
    - Coupon usage tracking

## Progress & Learning Tables (REQUIRED - 3 tables)

27. **`student_course_progress`** ⭐⭐
    - Course-level progress (if separate from student_progress)

28. **`assignments`** ⭐
    - Course assignments

29. **`assignment_submissions`** ⭐
    - Student submissions

## Location & Tracking Tables (OPTIONAL - 3 tables)

30. **`location_tracking_sessions`** ⭐
    - GPS tracking sessions

31. **`location_updates`** ⭐
    - GPS location updates

32. **`safety_incidents`** ⭐
    - Safety reporting

## Other Tables (REQUIRED - 5 tables)

33. **`certificates`** ⭐
    - Course completion certificates

34. **`referrals`** ⭐
    - Referral tracking

35. **`skills`** ⭐
    - Skills/competencies

36. **`pricing_config`** ⭐
    - Pricing configuration

37. **`payroll_config`** ⭐
    - Payroll settings

## Course Structure Tables (REQUIRED - 4 tables)

38. **`course_cycles`** ⭐
    - Course cycles

39. **`course_cycle_levels`** ⭐
    - Cycle level mapping

40. **`course_level_sessions`** ⭐
    - Level session mapping

41. **`pre_booking_capacity`** ⭐
    - Capacity management

## Potentially Unnecessary Tables (~36 tables)

These may be:
- Legacy tables from old architecture
- Migration backups
- Unused features
- Duplicate structures

**Need to verify each table's usage in codebase**

## Summary

- **Core Required**: 9 tables
- **Supporting Required**: ~32 tables
- **Potentially Unnecessary**: ~36 tables
- **Total**: 77 tables

## Action Items

1. ✅ Fixed purchase worker to copy metadata from payments
2. ⏳ Update existing purchases with metadata (run update script)
3. ⏳ Verify all required tables have data
4. ⏳ Audit unnecessary tables for removal

