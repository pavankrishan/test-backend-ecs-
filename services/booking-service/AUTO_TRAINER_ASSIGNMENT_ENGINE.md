# Auto Trainer Assignment Engine

## Overview

This document describes the production-grade AUTO TRAINER ASSIGNMENT ENGINE for the zone-based EdTech home-tutoring platform that supports both **COMPANY-managed** and **FRANCHISE-managed** cities.

## Ownership Model

### Important Ownership Rule

- Every city is always active
- A city or zone can be operated by:
  - **COMPANY** (default, when `franchise_id` is NULL)
  - **FRANCHISE** (when a franchise partner is assigned)
- If no franchise is interested in a city, the company operates it directly
- Assignment logic works **identically** for both ownership types

## Architecture

### Models

1. **Zone Model** (`zone.model.ts`)
   - Zones have `center_lat`, `center_lng`, and `radius_km`
   - `franchise_id` is nullable:
     - `NULL` = COMPANY-operated zone
     - Non-NULL = FRANCHISE-operated zone
   - Used to determine service coverage and operator type

2. **Franchise Model** (`franchise.model.ts`)
   - Represents franchise entities
   - Links to state and city

3. **Course Purchase Model** (`coursePurchase.model.ts`)
   - Main purchase record
   - Stores booking details, class type, delivery mode, students
   - Status: `ASSIGNED`, `WAITLISTED`, `SERVICE_NOT_AVAILABLE`, `INVALID_PURCHASE`

4. **Purchase Session Model** (`purchaseSession.model.ts`)
   - Individual sessions linked to a purchase
   - Supports both `offline` and `online` session types
   - Tracks session number, date, time, and status

5. **Certificate Model** (`certificate.model.ts`)
   - Certificates generated for 30-session courses
   - One certificate per student

### Services

1. **Session Schedule Generator** (`sessionScheduleGenerator.service.ts`)
   - Generates session schedules based on delivery mode
   - **WEEKDAY_DAILY**: 1 session per school day (Mon-Sun), consecutive (all 7 days)
   - **SUNDAY_ONLY**: 2 sessions back-to-back every Sunday (80 minutes total)
   - **HYBRID**: 30 sessions split into 18 online + 12 offline

2. **Purchase Validator** (`purchaseValidator.service.ts`)
   - Validates purchase combinations
   - Rules:
     - HYBRID must have exactly 30 sessions
     - SUNDAY_ONLY must have even number of sessions
     - ONE_ON_TWO must have exactly 2 students
     - ONE_ON_THREE must have exactly 3 students
     - ONE_ON_ONE must have exactly 1 student

3. **Trainer Eligibility Checker** (`trainerEligibilityChecker.service.ts`)
   - Checks trainer eligibility based on:
     - Active status
     - **Operator match** (COMPANY or FRANCHISE) for offline sessions
     - Franchise match (if FRANCHISE-operated zone)
     - Zone match (for offline sessions)
     - Course certification
     - Maximum 3 certified courses
     - Availability for ALL sessions
     - Travel feasibility (distance within zone radius)

4. **Auto Trainer Assignment Service** (`autoTrainerAssignment.service.ts`)
   - Main orchestration service
   - Flow:
     1. Validate purchase
     2. **Determine zone and operator** (COMPANY or FRANCHISE)
     3. Generate session schedule
     4. Fetch eligible trainers (filtered by operator)
     5. Filter eligible trainers (check operator match)
     6. Select best trainer
     7. Create purchase and sessions
     8. Lock trainer availability
     9. Generate certificates (if 30 sessions)

## API Endpoint

### POST `/api/v1/booking/auto-assign-trainer`

**Request Body:**
```json
{
  "bookingId": "uuid",
  "courseId": "uuid",
  "classType": "ONE_ON_ONE" | "ONE_ON_TWO" | "ONE_ON_THREE" | "HYBRID",
  "totalSessions": 10 | 20 | 30,
  "deliveryMode": "WEEKDAY_DAILY" | "SUNDAY_ONLY",
  "startDate": "2024-01-01",
  "preferredTimeSlot": "09:00",
  "studentLocation": {
    "latitude": 17.6868,
    "longitude": 83.2185
  },
  "students": [
    {
      "id": "uuid",
      "name": "Student Name",
      "email": "student@example.com",
      "phone": "+1234567890"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "result": "ASSIGNED" | "WAITLISTED" | "SERVICE_NOT_AVAILABLE" | "INVALID_PURCHASE",
  "data": {
    "purchaseId": "uuid",
    "trainerId": "uuid" | null,
    "message": "Trainer assigned successfully"
  }
}
```

## Business Rules

### Class Types

- **ONE_ON_ONE**: 1 student, single purchase
- **ONE_ON_TWO**: 2 students, same room, same time, single purchase
- **ONE_ON_THREE**: 3 students, same room, same time, single purchase
- **HYBRID**: Only for 30 sessions (18 online + 12 offline)

### Delivery Modes

- **WEEKDAY_DAILY**: 1 session per school day (Mon-Sun), consecutive days (all 7 days)
- **SUNDAY_ONLY**: 2 sessions every Sunday, back-to-back (80 minutes total)

### Session Rules

- One session = 40 minutes
- Sunday delivery = 2 sessions back-to-back (80 minutes)
- Same trainer must handle ALL sessions
- All students under a booking share the same schedule and trainer

### Trainer Eligibility

Trainer must:
- Be active
- **Belong to same operator** (COMPANY or FRANCHISE) for offline sessions
- **Belong to same franchise** (if FRANCHISE-operated zone)
- Belong to same zone (for offline sessions)
- Be certified for the course
- Have ≤ 3 certified courses
- Be available for ALL generated sessions
- Pass travel feasibility for offline sessions (within zone radius)

### Assignment Logic

1. If no trainer qualifies → `WAITLISTED`
2. If location not in any zone → `SERVICE_NOT_AVAILABLE`
3. If purchase invalid → `INVALID_PURCHASE`
4. If trainer found → `ASSIGNED`

### Certificates

- Generated automatically for 30-session courses
- One certificate per student
- Created when purchase is assigned

## Integration Points

### Trainer Service Integration

The engine requires a `FetchTrainersFunction` that fetches trainers from the trainer service. This function should:

```typescript
type FetchTrainersFunction = (filters: {
  franchiseId?: string | null; // null = COMPANY, non-null = FRANCHISE
  zoneId?: string | null;
  courseId: string;
  isActive?: boolean;
}) => Promise<TrainerInfo[]>;
```

**TrainerInfo** should include:
- `id`: Trainer ID
- `isActive`: Active status
- `franchiseId`: Franchise ID (null for COMPANY trainers, non-null for FRANCHISE trainers)
- `zoneId`: Zone ID
- `certifiedCourses`: Array of course IDs
- `location`: Optional location coordinates

**Operator Matching:**
- If `franchiseId` is `null` in filters → fetch COMPANY trainers
- If `franchiseId` is set in filters → fetch FRANCHISE trainers for that franchise
- Trainer's `franchiseId` must match zone's operator type

**TODO**: Implement actual trainer service integration in `booking.controller.ts` `autoAssignTrainer` method.

## Database Tables

The following tables are created automatically:

1. `zones` - Service zones with franchise association
2. `franchises` - Franchise entities
3. `course_purchases` - Purchase records
4. `purchase_sessions` - Individual session records
5. `certificates` - Certificate records

## Error Handling

- Invalid purchase combinations return `INVALID_PURCHASE`
- Location outside service area returns `SERVICE_NOT_AVAILABLE`
- No eligible trainers returns `WAITLISTED`
- Successful assignment returns `ASSIGNED`

All operations are transactional - if any step fails, the entire operation is rolled back.

## Notes

- **Ownership**: Zones can be COMPANY-operated (`franchise_id` is NULL) or FRANCHISE-operated (`franchise_id` is set)
- **Operator Matching**: Trainers must match the zone's operator (COMPANY or FRANCHISE)
- **Assignment Logic**: Works identically for both COMPANY and FRANCHISE zones
- Online sessions (HYBRID mode) ignore zone & travel rules
- Offline sessions must respect zone & travel rules
- All students in ONE_ON_TWO and ONE_ON_THREE are in the same room/location
- Trainer teaches once per session to all students together
- No dynamic grouping or joining later
- WEEKDAY_DAILY includes all 7 days (Mon-Sun), consecutive

