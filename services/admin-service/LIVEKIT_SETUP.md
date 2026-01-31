# LiveKit Integration Setup

## Overview

LiveKit is integrated for live video classes, especially for HYBRID class online sessions. This enables real-time video conferencing between trainers and students.

## Environment Variables

Add these environment variables to your `.env` file or deployment configuration:

```bash
# LiveKit Configuration
LIVEKIT_URL=wss://koding-caravan-live-classes-jmstg2mb.livekit.cloud
LIVEKIT_API_KEY=APIyFS9XaB9hez8
LIVEKIT_API_SECRET=l55yTmRBcZxpRaiE2fVJk666x4tLL4HIaOOajtSglEQ
```

## API Endpoints

### Get LiveKit Access Token

**POST** `/api/v1/admin/sessions/:sessionId/livekit-token`

**Authentication:** Required (Student or Trainer)

**Request:**
- URL Parameter: `sessionId` (UUID)

**Response:**
```json
{
  "success": true,
  "message": "LiveKit token generated successfully",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "url": "wss://koding-caravan-live-classes-jmstg2mb.livekit.cloud",
    "roomName": "session-{sessionId}"
  }
}
```

**Error Responses:**
- `401`: Authentication required
- `403`: User does not have access to this session
- `404`: Session not found
- `400`: Session is cancelled or not accessible

## Usage

### For Online Sessions (HYBRID Classes)

1. Student/Trainer calls the API to get access token
2. Use the token to connect to LiveKit room
3. Room name format: `session-{sessionId}`
4. Token expires in 2 hours

### Access Control

- **Students**: Can only access sessions where they are the student
- **Trainers**: Can only access sessions where they are assigned as trainer
- **Online Sessions**: Can join if status is `scheduled` or `in_progress`
- **Offline Sessions**: Can only join if status is `in_progress` (trainer must start first)

## Room Permissions

- **Trainers**: Can publish video/audio, subscribe, update metadata
- **Students**: Can publish video/audio, subscribe (for interactive classes)

## Integration with HYBRID Classes

Online sessions in HYBRID classes automatically support LiveKit:
- Sessions with `sessionType: 'online'` can use LiveKit
- Fixed time sessions (online) are perfect for scheduled live classes
- Multiple students can join the same room (capacity-based)

## Frontend Integration

See frontend documentation for React Native/Expo integration with LiveKit client SDK.
