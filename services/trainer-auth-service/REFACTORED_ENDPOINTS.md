# Refactored Trainer Application Endpoints

## Overview

The refactored trainer application system provides enterprise-grade endpoints with legal compliance, proper validation, and normalized data structures.

## Endpoints

### 1. Submit Refactored Application

**Endpoint:** `POST /api/v1/trainers/auth/apply/refactored`

**Description:** Submit a trainer application using the refactored schema with:
- Date of birth (instead of age)
- Consent checkboxes
- Raw location (no city/zone selection)
- Time range to slot conversion
- Max 3 courses enforcement

**Request Body:**
```json
{
  "fullName": "John Doe",
  "dateOfBirth": "1995-06-15",
  "gender": "male",
  "phone": "+911234567890",
  "email": "john@example.com",
  "location": {
    "address_text": "Near Benz Circle, Vijayawada",
    "latitude": 16.5062,
    "longitude": 80.6480,
    "pincode": "520010"
  },
  "qualification": "B.Tech",
  "experienceYears": 5,
  "courses": ["AI", "Robotics", "Coding"],
  "availability": {
    "employmentType": "part-time",
    "availableDays": ["Monday", "Tuesday", "Wednesday"],
    "timeRange": {
      "startTime": "18:00",
      "endTime": "21:00"
    }
  },
  "documents": [
    {
      "type": "id_proof",
      "fileUrl": "https://...",
      "fileName": "aadhar.pdf"
    }
  ],
  "consents": {
    "consentInfoCorrect": true,
    "consentBackgroundVerification": true,
    "consentTravelToStudents": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Trainer application created successfully. Awaiting admin review.",
  "data": {
    "trainerId": "uuid",
    "applicationId": "uuid",
    "status": "created",
    "nextSteps": [
      "Application submitted successfully",
      "Documents are being verified",
      "Wait for admin review and city/zone assignment"
    ]
  }
}
```

### 2. Preview Availability

**Endpoint:** `POST /api/v1/trainers/auth/apply/preview-availability`

**Description:** Get a preview of time slots that will be created from a time range.

**Request Body:**
```json
{
  "employmentType": "part-time",
  "timeRange": {
    "startTime": "18:00",
    "endTime": "21:00"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Availability preview generated",
  "data": {
    "slots": [
      {
        "start": "18:00:00",
        "end": "19:00:00",
        "display": "6:00 PM – 7:00 PM"
      },
      {
        "start": "19:00:00",
        "end": "20:00:00",
        "display": "7:00 PM – 8:00 PM"
      },
      {
        "start": "20:00:00",
        "end": "21:00:00",
        "display": "8:00 PM – 9:00 PM"
      }
    ],
    "count": 3
  }
}
```

## Validation Rules

### Date of Birth
- Required
- Must result in age >= 18
- Maximum age: 100

### Location
- Either GPS coordinates OR address text required
- No city/zone selection at application time
- City and zone assigned during admin review

### Time Range (Part-Time)
- Start time: 06:00 - 21:00
- End time: Must be after start time
- Minimum duration: 1 hour
- Only full-hour values (minutes = 00)

### Courses
- Minimum: 1 course
- Maximum: 3 courses
- Enforced at backend level

### Documents
- Required: ID Proof, Face Verification, Qualification Certificate
- Conditionally required: Experience Certificate (if experienceYears > 0)

### Consents
- All three consents must be accepted:
  1. Consent Info Correct
  2. Consent Background Verification
  3. Consent Travel To Students

## Error Responses

All endpoints return standard error format:

```json
{
  "success": false,
  "message": "Validation error",
  "errors": [
    {
      "field": "dateOfBirth",
      "message": "You must be at least 18 years old"
    }
  ]
}
```

## Migration Notes

The old endpoint (`POST /api/v1/trainers/auth/apply`) remains available for backward compatibility. New applications should use the refactored endpoint.

