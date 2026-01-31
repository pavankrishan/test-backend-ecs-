# MongoDB Schema Files Location Guide

## 📁 Schema File Structure

This document explains where MongoDB Mongoose schema files should be located in the Koding Caravan backend project.

## 🗂️ Directory Structure

```
kodingcaravan-mapp-be/
├── shared/
│   └── databases/
│       └── mongo/
│           ├── connection.ts          # MongoDB connection utility
│           └── models/                # ✅ Shared/Common Schemas
│               ├── user.model.ts
│               ├── course.model.ts
│               ├── message.model.ts
│               ├── analytics.model.ts
│               ├── notification.model.ts
│               └── index.ts           # Export all models
│
└── services/
    ├── analytics-service/
    │   └── src/
    │       └── models/                # ✅ Service-Specific Schemas
    │           └── analytics.model.ts
    │
    ├── chat-service/
    │   └── src/
    │       └── models/                # ✅ Service-Specific Schemas
    │           ├── message.model.ts
    │           └── mediaAttachment.model.ts
    │
    └── [other-services]/
        └── src/
            └── models/                # ✅ Service-Specific Schemas
```

## 📍 Schema Location Rules

### 1. **Shared Schemas** → `shared/databases/mongo/models/`

**Use this location for:**
- Collections used by multiple services
- Common entities (User, Course, etc.)
- Shared data structures

**Examples:**
- `user.model.ts` - User schema (used by auth, student, trainer services)
- `course.model.ts` - Course schema (used by course, student, trainer services)
- `message.model.ts` - Message schema (used by chat, notification services)
- `analytics.model.ts` - Analytics events (used by analytics, admin services)
- `notification.model.ts` - Notifications (used by notification, all services)

**How to import:**
```typescript
import { User, Course, Message } from '@kodingcaravan/shared/databases/mongo/models';
// or
import { User, Course } from '@kodingcaravan/shared';
```

### 2. **Service-Specific Schemas** → `services/{service-name}/src/models/`

**Use this location for:**
- Collections specific to a single service
- Service-specific data structures
- Extended schemas with service-specific fields

**Examples:**
- `services/chat-service/src/models/mediaAttachment.model.ts`
- `services/analytics-service/src/models/customAnalytics.model.ts`

**How to import:**
```typescript
import { MediaAttachment } from '../models/mediaAttachment.model';
```

## 🎯 Current Schema Files

### Shared Schemas (`shared/databases/mongo/models/`)

1. **`user.model.ts`** - User schema
   - Fields: name, email, role, status
   - Collection: `users`

2. **`course.model.ts`** - Course schema
   - Fields: title, description, instructor, duration, price, category
   - Collection: `courses`

3. **`message.model.ts`** - Chat message schema
   - Fields: senderId, receiverId, content, type, read
   - Collection: `messages`

4. **`analytics.model.ts`** - Analytics events schema
   - Fields: eventType, userId, courseId, metadata, timestamp
   - Collection: `analytics`

5. **`notification.model.ts`** - Notification schema
   - Fields: userId, title, message, type, read
   - Collection: `notifications`

### Service-Specific Schemas

- `services/analytics-service/src/models/analytics.model.ts` (if service-specific)
- `services/chat-service/src/models/message.model.ts` (if service-specific)
- `services/chat-service/src/models/mediaAttachment.model.ts`

## 📝 Usage Examples

### Using Shared Schemas

```typescript
// In any service
import { connectMongo } from '@kodingcaravan/shared';
import { User, Course } from '@kodingcaravan/shared/databases/mongo/models';

// Connect to MongoDB
await connectMongo();

// Use the model
const user = await User.findOne({ email: 'user@example.com' });
const courses = await Course.find({ status: 'active' });
```

### Using Service-Specific Schemas

```typescript
// In chat-service/src/services/chat.service.ts
import { MediaAttachment } from '../models/mediaAttachment.model';

const attachment = await MediaAttachment.create({
  messageId: '...',
  url: '...',
  type: 'image'
});
```

## 🔄 Migration from Seed Script

The sample data created by `pnpm seed-mongo` uses raw MongoDB collections. To use these schemas:

1. **Import and use the models** in your services
2. **Replace raw MongoDB operations** with Mongoose model methods
3. **Add validation** using Mongoose validators
4. **Use TypeScript types** for type safety

## ✅ Best Practices

1. **Shared schemas** → Always in `shared/databases/mongo/models/`
2. **Service-specific** → Always in `services/{service}/src/models/`
3. **Export through index.ts** → Easier imports
4. **Use TypeScript interfaces** → Type safety
5. **Add indexes** → For frequently queried fields
6. **Use timestamps** → Automatic createdAt/updatedAt

## 📚 Related Files

- Connection: `shared/databases/mongo/connection.ts`
- Export: `shared/databases/mongo/models/index.ts`
- Seed Script: `scripts/seed-mongo.js`
- Check Script: `scripts/mongo-check.js`

