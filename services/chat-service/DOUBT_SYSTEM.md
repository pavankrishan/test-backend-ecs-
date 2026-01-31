# Doubt Clarification System

## Overview

The Doubt Clarification System replaces the direct trainer-student chat with a controlled, ticket-based system that provides better security, monitoring, and professional boundaries.

## Features

### ✅ Security & Safety
- **Content Filtering**: Automatically blocks personal contact information (phone numbers, emails, social media handles)
- **Admin Monitoring**: All doubts and replies are visible to admins
- **Audit Trail**: Complete logging of all interactions
- **No Real-time Chat**: Prevents misuse and maintains professional boundaries

### ✅ Doubt Ticket System
- Students submit doubts with:
  - Subject and Topic selection
  - Text, Image, or Voice question formats
  - File attachments (images, PDFs, audio)
- Trainers respond with:
  - Text replies
  - Image attachments
  - PDF documents
  - Voice messages
- Status tracking:
  - `pending` - Newly submitted
  - `in_progress` - Trainer is working on it
  - `answered` - Trainer has replied
  - `closed` - Resolved and closed

## API Endpoints

### Student Endpoints

#### POST `/api/v1/doubts`
Create a new doubt ticket.

**Request Body:**
```json
{
  "studentId": "string (24 chars)",
  "trainerId": "string (24 chars) | null (optional)",
  "subject": "string",
  "topic": "string",
  "question": "string",
  "type": "text" | "image" | "voice",
  "attachments": [
    {
      "url": "string",
      "type": "image" | "audio" | "pdf",
      "size": "number (optional)",
      "mimeType": "string (optional)"
    }
  ]
}
```

#### GET `/api/v1/doubts`
List doubts with filters.

**Query Parameters:**
- `studentId` (optional)
- `trainerId` (optional)
- `status` (optional): `pending` | `in_progress` | `answered` | `closed`
- `subject` (optional)
- `limit` (optional, default: 20)
- `page` (optional, default: 1)

#### GET `/api/v1/doubts/:doubtId`
Get a specific doubt with all replies.

#### PATCH `/api/v1/doubts/:doubtId/status`
Update doubt status.

**Request Body:**
```json
{
  "status": "pending" | "in_progress" | "answered" | "closed",
  "updatedBy": "string (24 chars)"
}
```

### Trainer Endpoints

#### GET `/api/v1/trainer/doubts`
Get doubts assigned to a trainer.

**Query Parameters:** Same as student list endpoint.

#### POST `/api/v1/doubts/:doubtId/reply`
Reply to a doubt.

**Request Body:**
```json
{
  "trainerId": "string (24 chars)",
  "reply": "string",
  "attachments": [
    {
      "url": "string",
      "type": "image" | "audio" | "pdf",
      "size": "number (optional)",
      "mimeType": "string (optional)"
    }
  ]
}
```

### Admin Endpoints

#### GET `/api/v1/admin/doubts`
View all doubts in the system (admin dashboard).

**Query Parameters:** Same as student list endpoint.

#### POST `/api/v1/doubts/:doubtId/reassign`
Reassign a doubt to another trainer.

**Request Body:**
```json
{
  "newTrainerId": "string (24 chars)"
}
```

## Content Filtering

The system automatically filters and blocks:
- Phone numbers (various formats)
- Email addresses
- Social media handles (Instagram, Facebook, Twitter, LinkedIn, etc.)
- Social media URLs

If personal information is detected, the request is rejected with a clear error message.

## Database Models

### Doubt Model
```typescript
{
  studentId: ObjectId,
  trainerId: ObjectId | null,
  subject: string,
  topic: string,
  question: string,
  type: 'text' | 'image' | 'voice',
  attachments: Array<{
    url: string,
    type: 'image' | 'audio' | 'pdf',
    size?: number,
    mimeType?: string
  }>,
  status: 'pending' | 'in_progress' | 'answered' | 'closed',
  createdAt: Date,
  updatedAt: Date,
  answeredAt?: Date,
  closedAt?: Date
}
```

### DoubtReply Model
```typescript
{
  doubtId: ObjectId,
  trainerId: ObjectId,
  reply: string,
  attachments: Array<{
    url: string,
    type: 'image' | 'audio' | 'pdf',
    size?: number,
    mimeType?: string
  }>,
  createdAt: Date,
  updatedAt: Date
}
```

## Mobile App Screens

### Student Screens
- `/(student)/doubts` - List all doubts
- `/(student)/doubts/new` - Submit new doubt
- `/(student)/doubts/[id]` - View doubt details and replies

### Trainer Screens
- `/(trainer)/doubts` - List assigned doubts
- `/(trainer)/doubts/[id]` - View doubt and reply

## Migration Notes

The old chat system endpoints (`/api/v1/chat/*`) are still available but deprecated. The new doubt system uses `/api/v1/doubts/*` endpoints.

## Security Considerations

1. **No Personal Contact Sharing**: Content filter prevents sharing phone numbers, emails, or social media
2. **Admin Oversight**: All doubts are visible to admins for monitoring
3. **Audit Logging**: All interactions are logged in the database
4. **Controlled Communication**: No real-time chat prevents misuse
5. **Status Tracking**: Clear workflow prevents confusion

## Future Enhancements

- File upload handling for images/PDFs/audio
- Push notifications for new doubts/replies
- Doubt categories and tags
- Search functionality
- Analytics dashboard for admins

