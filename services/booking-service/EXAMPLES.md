# API Examples

## Example 1: Check Service Availability

### Request
```bash
POST /api/v1/booking/check-service-availability
Content-Type: application/json

{
  "lat": 15.5057,
  "lng": 80.0499,
  "course": "550e8400-e29b-41d4-a716-446655440000",
  "timeslot": "09:00"
}
```

### Response (Available)
```json
{
  "success": true,
  "data": {
    "available": true,
    "message": "Service Available",
    "city": {
      "id": "660e8400-e29b-41d4-a716-446655440000",
      "name": "Ongole",
      "isActive": true
    },
    "nearestCluster": {
      "id": "770e8400-e29b-41d4-a716-446655440000",
      "name": "Ongole-Center",
      "distance": 1.2
    },
    "trainersAvailable": 5
  }
}
```

### Response (Not Available - City Inactive)
```json
{
  "success": true,
  "data": {
    "available": false,
    "message": "Service not available in this city yet",
    "city": {
      "id": "660e8400-e29b-41d4-a716-446655440000",
      "name": "Ongole",
      "isActive": false
    },
    "nearestCluster": null,
    "trainersAvailable": 0
  }
}
```

### Response (Not Available - No Trainers)
```json
{
  "success": true,
  "data": {
    "available": false,
    "message": "Coming Soon in your area",
    "city": {
      "id": "660e8400-e29b-41d4-a716-446655440000",
      "name": "Ongole",
      "isActive": true
    },
    "nearestCluster": {
      "id": "770e8400-e29b-41d4-a716-446655440000",
      "name": "Ongole-Center",
      "distance": 1.2
    },
    "trainersAvailable": 0
  }
}
```

## Example 2: Create Pre-Booking

### Request
```bash
POST /api/v1/booking/create-prebooking
Content-Type: application/json

{
  "address": "123 Main Street, Ongole, Andhra Pradesh",
  "lat": 15.5057,
  "lng": 80.0499,
  "course": "550e8400-e29b-41d4-a716-446655440000",
  "timeslot": "09:00",
  "mode": "1on1",
  "groupSize": 1,
  "sessionCount": 20
}
```

### Response
```json
{
  "success": true,
  "data": {
    "id": "880e8400-e29b-41d4-a716-446655440000",
    "address": "123 Main Street, Ongole, Andhra Pradesh",
    "latitude": 15.5057,
    "longitude": 80.0499,
    "courseId": "550e8400-e29b-41d4-a716-446655440000",
    "timeslot": "09:00",
    "mode": "1on1",
    "groupSize": 1,
    "sessionCount": 20,
    "cityId": "660e8400-e29b-41d4-a716-446655440000",
    "clusterId": "770e8400-e29b-41d4-a716-446655440000",
    "status": "pending",
    "convertedToBookingId": null,
    "metadata": null,
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:00Z"
  }
}
```

## Example 3: Get Trainer Demand

### Request
```bash
GET /api/v1/booking/trainer-demand?city=Ongole
```

### Response
```json
{
  "success": true,
  "data": {
    "cityId": "660e8400-e29b-41d4-a716-446655440000",
    "cityName": "Ongole",
    "totalPreBookings": 50,
    "clusterBreakdown": [
      {
        "clusterId": "770e8400-e29b-41d4-a716-446655440000",
        "clusterName": "Ongole-Center",
        "preBookings": 30,
        "trainersNeeded": 30
      },
      {
        "clusterId": "771e8400-e29b-41d4-a716-446655440000",
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
        "preBookings": 15,
        "trainersNeeded": 15
      },
      {
        "timeslot": "17:00",
        "preBookings": 10,
        "trainersNeeded": 10
      }
    ],
    "totalTrainersNeeded": 50,
    "withBuffer": 65
  }
}
```

## Example 4: Assign Trainer

### Request
```bash
POST /api/v1/booking/assign-trainer
Content-Type: application/json

{
  "bookingId": "990e8400-e29b-41d4-a716-446655440000"
}
```

### Response (Success)
```json
{
  "success": true,
  "data": {
    "success": true,
    "trainerId": "aa0e8400-e29b-41d4-a716-446655440000",
    "booking": {
      "id": "990e8400-e29b-41d4-a716-446655440000",
      "studentId": "bb0e8400-e29b-41d4-a716-446655440000",
      "studentIds": [],
      "courseId": "550e8400-e29b-41d4-a716-446655440000",
      "address": "123 Main Street, Ongole",
      "latitude": 15.5057,
      "longitude": 80.0499,
      "timeslot": "09:00",
      "mode": "1on1",
      "groupSize": 1,
      "sessionCount": 20,
      "trainerId": "aa0e8400-e29b-41d4-a716-446655440000",
      "clusterId": "770e8400-e29b-41d4-a716-446655440000",
      "status": "confirmed",
      "startDate": "2024-01-20",
      "endDate": null,
      "completedSessions": 0,
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T11:00:00Z"
    },
    "message": "Trainer assigned successfully"
  }
}
```

### Response (No Trainers Available)
```json
{
  "success": false,
  "message": "No available trainers found within 5km radius",
  "data": {
    "success": false,
    "trainerId": null,
    "booking": {
      "id": "990e8400-e29b-41d4-a716-446655440000",
      ...
    },
    "message": "No available trainers found within 5km radius"
  }
}
```

## Example 5: Get Trainer Schedule

### Request
```bash
GET /api/v1/booking/trainer-schedule/aa0e8400-e29b-41d4-a716-446655440000
```

### Response
```json
{
  "success": true,
  "data": {
    "trainerId": "aa0e8400-e29b-41d4-a716-446655440000",
    "slots": [
      {
        "id": "cc0e8400-e29b-41d4-a716-446655440000",
        "trainerId": "aa0e8400-e29b-41d4-a716-446655440000",
        "bookingId": "990e8400-e29b-41d4-a716-446655440000",
        "date": "2024-01-20",
        "timeslot": "09:00",
        "status": "booked",
        "metadata": null,
        "createdAt": "2024-01-15T11:00:00Z",
        "updatedAt": "2024-01-15T11:00:00Z"
      },
      {
        "id": "cc1e8400-e29b-41d4-a716-446655440000",
        "trainerId": "aa0e8400-e29b-41d4-a716-446655440000",
        "bookingId": "990e8400-e29b-41d4-a716-446655440000",
        "date": "2024-01-21",
        "timeslot": "09:00",
        "status": "booked",
        "metadata": null,
        "createdAt": "2024-01-15T11:00:00Z",
        "updatedAt": "2024-01-15T11:00:00Z"
      },
      ...
    ],
    "period": {
      "startDate": "2024-01-15",
      "endDate": "2024-02-14"
    }
  }
}
```

## Example 6: Record Attendance

### Request
```bash
POST /api/v1/booking/trainer-attendance
Content-Type: application/json

{
  "bookingId": "990e8400-e29b-41d4-a716-446655440000",
  "sessionId": "dd0e8400-e29b-41d4-a716-446655440000",
  "trainerId": "aa0e8400-e29b-41d4-a716-446655440000",
  "studentId": "bb0e8400-e29b-41d4-a716-446655440000",
  "date": "2024-01-20",
  "timeslot": "09:00",
  "status": "present",
  "notes": "Session completed successfully. Student showed good progress."
}
```

### Response
```json
{
  "success": true,
  "data": {
    "id": "ee0e8400-e29b-41d4-a716-446655440000",
    "bookingId": "990e8400-e29b-41d4-a716-446655440000",
    "sessionId": "dd0e8400-e29b-41d4-a716-446655440000",
    "trainerId": "aa0e8400-e29b-41d4-a716-446655440000",
    "studentId": "bb0e8400-e29b-41d4-a716-446655440000",
    "date": "2024-01-20",
    "timeslot": "09:00",
    "status": "present",
    "notes": "Session completed successfully. Student showed good progress.",
    "metadata": null,
    "createdAt": "2024-01-20T09:40:00Z",
    "updatedAt": "2024-01-20T09:40:00Z"
  }
}
```

## Example 7: Create Session Booking (1-on-2)

### Request
```bash
POST /api/v1/booking/create-booking
Content-Type: application/json

{
  "studentId": "bb0e8400-e29b-41d4-a716-446655440000",
  "studentIds": [
    "bb0e8400-e29b-41d4-a716-446655440000",
    "bb1e8400-e29b-41d4-a716-446655440000"
  ],
  "courseId": "550e8400-e29b-41d4-a716-446655440000",
  "address": "123 Main Street, Ongole",
  "latitude": 15.5057,
  "longitude": 80.0499,
  "timeslot": "14:00",
  "mode": "1on2",
  "groupSize": 2,
  "sessionCount": 30,
  "startDate": "2024-01-20"
}
```

### Response
```json
{
  "success": true,
  "data": {
    "id": "990e8400-e29b-41d4-a716-446655440000",
    "studentId": "bb0e8400-e29b-41d4-a716-446655440000",
    "studentIds": [
      "bb0e8400-e29b-41d4-a716-446655440000",
      "bb1e8400-e29b-41d4-a716-446655440000"
    ],
    "courseId": "550e8400-e29b-41d4-a716-446655440000",
    "address": "123 Main Street, Ongole",
    "latitude": 15.5057,
    "longitude": 80.0499,
    "timeslot": "14:00",
    "mode": "1on2",
    "groupSize": 2,
    "sessionCount": 30,
    "trainerId": null,
    "clusterId": "770e8400-e29b-41d4-a716-446655440000",
    "status": "pending",
    "startDate": "2024-01-20",
    "endDate": null,
    "completedSessions": 0,
    "metadata": null,
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:00Z"
  }
}
```

## Ongole Cluster Design Example

### City Setup
```json
{
  "id": "660e8400-e29b-41d4-a716-446655440000",
  "name": "Ongole",
  "state": "Andhra Pradesh",
  "country": "India",
  "isActive": true,
  "franchiseId": "ff0e8400-e29b-41d4-a716-446655440000",
  "activatedAt": "2024-01-01T00:00:00Z",
  "activatedBy": "admin-uuid"
}
```

### Clusters (5 clusters, 2.5km radius each)
```json
[
  {
    "id": "770e8400-e29b-41d4-a716-446655440000",
    "cityId": "660e8400-e29b-41d4-a716-446655440000",
    "name": "Ongole-Center",
    "centerLatitude": 15.5057,
    "centerLongitude": 80.0499,
    "radiusKm": 2.5,
    "isActive": true
  },
  {
    "id": "771e8400-e29b-41d4-a716-446655440000",
    "cityId": "660e8400-e29b-41d4-a716-446655440000",
    "name": "Ongole-North",
    "centerLatitude": 15.5250,
    "centerLongitude": 80.0500,
    "radiusKm": 2.5,
    "isActive": true
  },
  {
    "id": "772e8400-e29b-41d4-a716-446655440000",
    "cityId": "660e8400-e29b-41d4-a716-446655440000",
    "name": "Ongole-South",
    "centerLatitude": 15.4850,
    "centerLongitude": 80.0500,
    "radiusKm": 2.5,
    "isActive": true
  },
  {
    "id": "773e8400-e29b-41d4-a716-446655440000",
    "cityId": "660e8400-e29b-41d4-a716-446655440000",
    "name": "Ongole-East",
    "centerLatitude": 15.5057,
    "centerLongitude": 80.0700,
    "radiusKm": 2.5,
    "isActive": true
  },
  {
    "id": "774e8400-e29b-41d4-a716-446655440000",
    "cityId": "660e8400-e29b-41d4-a716-446655440000",
    "name": "Ongole-West",
    "centerLatitude": 15.5057,
    "centerLongitude": 80.0300,
    "radiusKm": 2.5,
    "isActive": true
  }
]
```

