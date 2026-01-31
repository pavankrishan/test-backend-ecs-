# Booking Service

Complete backend system for Koding Caravan's home tutoring booking and scheduling engine.

## Overview

This service handles:
- **Service Area Management**: City activation, cluster detection, service availability
- **Booking & Scheduling**: Session bookings with trainer assignment
- **Pre-Booking Demand**: Calculate trainer requirements from pre-bookings
- **Trainer Assignment**: Smart algorithm for assigning trainers based on distance and availability
- **Attendance Tracking**: Daily attendance records for sessions

## Architecture

```
booking-service/
├── src/
│   ├── models/           # Database models (City, Cluster, Booking, etc.)
│   ├── services/         # Business logic services
│   ├── controllers/      # HTTP request handlers
│   ├── routes/          # Express routes
│   ├── utils/           # Utility functions (distance calculation)
│   ├── config/          # Database configuration
│   ├── app.ts           # Express app setup
│   └── index.ts         # Service entry point
├── package.json
└── tsconfig.json
```

## Data Models

### 1. City
- Manages city activation (HQ controlled)
- One franchise per city
- Service availability depends on city activation

### 2. Cluster
- Internal operational areas within a city (2-3 km radius)
- Used for operational organization
- Franchise owns all clusters in their city

### 3. SessionBooking
- Represents a booking for home tutoring
- Contains: student address, course, timeslot, mode (1on1/1on2/1on3), session count
- Links to trainer and cluster

### 4. PreBooking
- Stores pre-booking demand data
- Used for trainer requirement calculation

### 5. ScheduleSlot
- Tracks trainer schedule to prevent double-booking
- Locks slots for booking duration

### 6. AttendanceRecord
- Daily attendance tracking
- Links to booking and session

## Core Algorithms

### 1. Haversine Distance Calculation
Calculates great-circle distance between two GPS coordinates.

```typescript
calculateDistance(point1, point2) // Returns distance in km
isWithinRadius(point1, point2, radiusKm) // Boolean check
```

### 2. Service Availability Check
1. Detect city from coordinates
2. Check if city is active
3. Find nearest cluster
4. Check for trainers within 5km radius
5. Return availability status

### 3. Trainer Assignment Algorithm
**Priority System:**
1. **HIGH PRIORITY**: Trainers within 3km (sorted by current load)
2. **SECONDARY PRIORITY**: Trainers 3-5km (sorted by current load)
3. Exclude trainers with timeslot conflicts
4. Select trainer with least load

**Rules:**
- Trainer can only serve students within 5km
- Trainer can take only ONE booking per timeslot
- trainerNeeded = 1 regardless of groupSize (1on1, 1on2, 1on3)

### 4. Pre-Booking Demand Calculator
**Algorithm:**
1. Group by: city → cluster → timeslot
2. Count number of bookings (not students)
3. trainersNeeded = numberOfBookings
4. Add 30% buffer

## API Endpoints

### POST /api/v1/booking/check-service-availability
Check if service is available at a location.

**Request:**
```json
{
  "lat": 15.5057,
  "lng": 80.0499,
  "course": "course-uuid",
  "timeslot": "09:00"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "available": true,
    "message": "Service Available",
    "city": {
      "id": "city-uuid",
      "name": "Ongole",
      "isActive": true
    },
    "nearestCluster": {
      "id": "cluster-uuid",
      "name": "Ongole-Center",
      "distance": 1.2
    },
    "trainersAvailable": 5
  }
}
```

### POST /api/v1/booking/create-prebooking
Create a pre-booking.

**Request:**
```json
{
  "address": "123 Main St, Ongole",
  "lat": 15.5057,
  "lng": 80.0499,
  "course": "course-uuid",
  "timeslot": "09:00",
  "mode": "1on1",
  "groupSize": 1,
  "sessionCount": 20
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "prebooking-uuid",
    "address": "123 Main St, Ongole",
    "latitude": 15.5057,
    "longitude": 80.0499,
    "courseId": "course-uuid",
    "timeslot": "09:00",
    "mode": "1on1",
    "groupSize": 1,
    "sessionCount": 20,
    "status": "pending",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

### GET /api/v1/booking/trainer-demand?city=Ongole
Get trainer requirement summary.

**Response:**
```json
{
  "success": true,
  "data": {
    "cityId": "city-uuid",
    "cityName": "Ongole",
    "totalPreBookings": 50,
    "clusterBreakdown": [
      {
        "clusterId": "cluster-uuid",
        "clusterName": "Ongole-Center",
        "preBookings": 30,
        "trainersNeeded": 30
      },
      {
        "clusterId": "cluster-uuid-2",
        "clusterName": "Ongole-North",
        "preBookings": 20,
        "trainersNeeded": 20
      }
    ],
    "timeslotBreakdown": [
      {
        "timeslot": "09:00",
        "preBookings": 25,
        "trainersNeeded": 25
      },
      {
        "timeslot": "14:00",
        "preBookings": 25,
        "trainersNeeded": 25
      }
    ],
    "totalTrainersNeeded": 50,
    "withBuffer": 65
  }
}
```

### POST /api/v1/booking/assign-trainer
Assign trainer to a booking.

**Request:**
```json
{
  "bookingId": "booking-uuid"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "success": true,
    "trainerId": "trainer-uuid",
    "booking": {
      "id": "booking-uuid",
      "trainerId": "trainer-uuid",
      "status": "confirmed",
      ...
    },
    "message": "Trainer assigned successfully"
  }
}
```

### GET /api/v1/booking/trainer-schedule/:trainerId
Get trainer's 30-day schedule.

**Response:**
```json
{
  "success": true,
  "data": {
    "trainerId": "trainer-uuid",
    "slots": [
      {
        "id": "slot-uuid",
        "date": "2024-01-01",
        "timeslot": "09:00",
        "status": "booked",
        "bookingId": "booking-uuid"
      },
      ...
    ],
    "period": {
      "startDate": "2024-01-01",
      "endDate": "2024-01-31"
    }
  }
}
```

### POST /api/v1/booking/trainer-attendance
Record trainer attendance.

**Request:**
```json
{
  "bookingId": "booking-uuid",
  "sessionId": "session-uuid",
  "trainerId": "trainer-uuid",
  "studentId": "student-uuid",
  "date": "2024-01-01",
  "timeslot": "09:00",
  "status": "present",
  "notes": "Session completed successfully"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "attendance-uuid",
    "bookingId": "booking-uuid",
    "status": "present",
    "date": "2024-01-01",
    ...
  }
}
```

## Example: Ongole Cluster Design

### City Setup
```json
{
  "name": "Ongole",
  "state": "Andhra Pradesh",
  "country": "India",
  "isActive": true,
  "franchiseId": "franchise-uuid"
}
```

### Clusters (2-3 km radius each)
```json
[
  {
    "name": "Ongole-Center",
    "centerLatitude": 15.5057,
    "centerLongitude": 80.0499,
    "radiusKm": 2.5
  },
  {
    "name": "Ongole-North",
    "centerLatitude": 15.5250,
    "centerLongitude": 80.0500,
    "radiusKm": 2.5
  },
  {
    "name": "Ongole-South",
    "centerLatitude": 15.4850,
    "centerLongitude": 80.0500,
    "radiusKm": 2.5
  },
  {
    "name": "Ongole-East",
    "centerLatitude": 15.5057,
    "centerLongitude": 80.0700,
    "radiusKm": 2.5
  },
  {
    "name": "Ongole-West",
    "centerLatitude": 15.5057,
    "centerLongitude": 80.0300,
    "radiusKm": 2.5
  }
]
```

## Business Rules

1. **City Activation**: Only HQ can activate cities. If inactive → "Service not available"
2. **Trainer Radius**: Trainers can only serve students within 5km
3. **Priority**: 3km = HIGH, 3-5km = SECONDARY
4. **Timeslot Conflict**: Trainer can take only ONE booking per timeslot
5. **Group Size**: trainerNeeded = 1 regardless of groupSize (1on1, 1on2, 1on3)
6. **Session Duration**: 40 minutes per session
7. **Session Packages**: 10, 20, or 30 sessions
8. **Daily Schedule**: Same time, same location, daily for sessionCount days

## Setup

1. Install dependencies:
```bash
pnpm install
```

2. Set environment variables:
```env
DATABASE_URL=postgresql://user:password@localhost:5432/kodingcaravan
PORT=3011
```

3. Build:
```bash
pnpm build
```

4. Run:
```bash
pnpm start
# or for development
pnpm dev
```

## Integration Points

### Trainer Service
The service needs to fetch trainer data from trainer-service:
- Trainer locations (latitude, longitude)
- Trainer active status
- Trainer current load (number of active bookings)

### Course Service
The service needs course information:
- Course availability
- Course details

### Student Service
The service needs student information:
- Student addresses
- Student course purchases

## Notes

- **Reverse Geocoding**: The `detectCity` function is a placeholder. In production, use Google Maps Geocoding API, Mapbox, or similar service.
- **Trainer Fetching**: The `getAvailableTrainers` and `getTrainerCandidates` functions are placeholders. Implement integration with trainer-service.
- **PostGIS**: For better spatial queries, consider using PostGIS extension for PostgreSQL.

## Production Considerations

1. **Caching**: Cache city/cluster data for better performance
2. **Rate Limiting**: Add rate limiting to API endpoints
3. **Validation**: Add input validation middleware
4. **Logging**: Add structured logging
5. **Monitoring**: Add metrics and monitoring
6. **Error Handling**: Enhance error handling and retry logic
7. **Geocoding**: Implement proper reverse geocoding service
8. **Trainer Integration**: Implement proper trainer service integration

