# Course Content Architecture Refactoring Summary

## Overview
This document summarizes the comprehensive refactoring of the course content architecture to follow a clean, production-ready structure.

## Key Changes

### 1. Course Model Updates
- **Renamed `level` to `difficulty`** (optional field)
  - `level` field was causing confusion with curriculum levels
  - `difficulty` now represents course difficulty: 'beginner' | 'intermediate' | 'advanced'
  - Database migration handles existing data
- **Made `subcategory` optional** (was already optional in interface, now properly enforced)
- **Category remains direct**: AI, Robotics, Coding (no STEM hierarchy required)

### 2. Quiz Storage Separation
- **Created Quiz Model** (`src/models/quiz.model.ts`)
  - MongoDB schema for quizzes
  - One quiz per session (referenced by `sessionId`)
  - Contains 12-25 MCQ questions
  - Each question has: id, question, options (4), correctAnswerIndex, explanation, points
- **Created Quiz Repository** (`src/repositories/quiz.repository.ts`)
  - CRUD operations for quizzes
  - Separate from session data

### 3. Session Content Updates
- **Replaced public URLs with S3 keys**:
  - `expertVideoUrl` → `expertVideoS3Key`
  - `learningSheetPdfUrl` → `learningSheetPdfS3Key`
  - Backend must generate signed URLs from S3 keys
- **Replaced embedded MCQs with quiz reference**:
  - `mcqQuestions` → `quizId` (references MongoDB Quiz document)
  - Quizzes stored separately in MongoDB
- **Database migration** handles existing columns (backward compatible)

### 4. Database Constraints (Already Enforced)
- **3 levels per phase**:
  - `CONSTRAINT unique_level_sequence UNIQUE (phase_id, sequence)` ensures only sequences 1,2,3
  - `CONSTRAINT unique_level_type_per_phase UNIQUE (phase_id, level_type)` ensures unique types
  - `CHECK (sequence IN (1, 2, 3))` enforces valid sequences
- **10 sessions per level**:
  - `CHECK (session_number >= 1 AND session_number <= 10)` enforces range
  - `CONSTRAINT unique_session_number UNIQUE (level_id, session_number)` ensures uniqueness

### 5. Structure Hierarchy (Unchanged, Documented)
```
Course (catalog & pricing only)
  └── Phase (major curriculum stage, ordered by sequence)
      └── Level (exactly 3 per phase)
          ├── Foundation (sequence: 1)
          ├── Development (sequence: 2)
          └── Mastery (sequence: 3)
              └── Session (exactly 10 per level, sessionNumber: 1-10)
```

## Business Rules Enforced

### Courses
- ✅ Do NOT contain curriculum logic
- ✅ Used only for discovery, pricing, and activation
- ✅ No sessions, phases, or levels stored directly

### Phases
- ✅ Belong to a course
- ✅ Ordered by sequence (1, 2, 3, ...)
- ✅ Scalable (can have many phases)

### Levels
- ✅ Each phase MUST have exactly 3 levels
- ✅ Levels must be: sequence 1 → foundation, sequence 2 → development, sequence 3 → mastery
- ✅ Levels are NOT purchasable (only sessions are purchased)

### Sessions
- ✅ Each level MUST have exactly 10 sessions
- ✅ sessionNumber must be 1–10 within a level
- ✅ Sessions are ordered and sequential
- ✅ Store S3 keys (not public URLs)
- ✅ Reference quizzes via quizId (not embedded)

### Purchases
- ✅ Users purchase number of sessions only: 10 / 20 / 30
- ✅ Do NOT store purchased levels or current phase/level
- ✅ Access rule: `session_global_index ≤ sessions_purchased → unlocked`
- ✅ Levels and phases are derived, never stored in enrollment

## Files Modified

1. **`src/models/course.model.ts`**
   - Renamed `level` → `difficulty` (optional)
   - Updated all interfaces and repository methods
   - Added migration SQL

2. **`src/models/courseStructure.model.ts`**
   - Updated `CourseSession` interface (S3 keys, quizId)
   - Updated `CreateSessionInput` interface
   - Updated database schema (S3 key columns)
   - Updated `rowToSession` mapper
   - Updated `createSession` repository method
   - Added migration SQL

3. **`src/models/quiz.model.ts`** (NEW)
   - MongoDB schema for quizzes
   - MCQQuestion interface
   - Validation: 12-25 questions per quiz

4. **`src/repositories/quiz.repository.ts`** (NEW)
   - Quiz CRUD operations
   - Session-based queries

## Next Steps (TODO)

### Service Layer Updates
1. **S3 URL Generation Service**
   - Create service to generate signed URLs from S3 keys
   - Update session retrieval to include signed URLs

2. **Quiz Service Integration**
   - Update session services to fetch quizzes from MongoDB
   - Handle quiz creation when sessions are created

3. **API Endpoint Updates**
   - Update controllers to use new structure
   - Update request/response DTOs
   - Ensure backward compatibility where needed

### Migration Tasks
1. **Data Migration**
   - Migrate existing URLs to S3 keys (manual process)
   - Migrate embedded MCQs to MongoDB Quiz documents
   - Update session records with quizId references

2. **Testing**
   - Test course creation with new structure
   - Test session creation with S3 keys and quiz references
   - Test quiz operations
   - Verify constraints (3 levels, 10 sessions)

### Documentation
1. Update API documentation
2. Update frontend type definitions
3. Create migration guide for content creators

## Breaking Changes

### API Changes
- Course create/update: `level` → `difficulty` (optional)
- Session create/update: `expertVideoUrl` → `expertVideoS3Key`, `learningSheetPdfUrl` → `learningSheetPdfS3Key`
- Session response: `mcqQuestions` removed, `quizId` added
- New endpoint: Quiz CRUD operations

### Database Changes
- `courses.level` → `courses.difficulty` (with migration)
- `course_sessions.expert_video_url` → `course_sessions.expert_video_s3_key`
- `course_sessions.learning_sheet_pdf_url` → `course_sessions.learning_sheet_pdf_s3_key`
- `course_sessions.mcq_questions` → removed (moved to MongoDB)
- `course_sessions.quiz_id` → added

### Migration Strategy
- All migrations include backward compatibility checks
- Old columns remain until manual data migration is complete
- Services should handle both old and new formats during transition

## Important Notes

1. **S3 Keys**: Never expose S3 keys directly to frontend. Always generate signed URLs.
2. **Quiz Storage**: Quizzes are in MongoDB, sessions in PostgreSQL. Use quizId to link them.
3. **Constraints**: Database constraints enforce business rules. Service layer should also validate.
4. **Naming**: Avoid using "level" in course context. Use "difficulty" for course difficulty, "Level" for curriculum levels.

## Questions & Clarifications

- [ ] S3 bucket configuration (which bucket, region, etc.)
- [ ] Signed URL expiration time (recommend: 1 hour)
- [ ] Quiz migration strategy (one-time script or gradual migration)
- [ ] Frontend update timeline

