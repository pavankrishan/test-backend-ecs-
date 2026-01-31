# Course Structure System - Comprehensive Documentation

## Overview

This system implements a scalable EdTech course structure optimized for 10K-1M users with proper indexing and relationship management.

## Architecture

### Structure Hierarchy
```
Course
  └── Phase (Scalable - currently 3, must scale infinitely)
      └── Level (Fixed 3 per phase)
          ├── Foundation (Sessions 1-10)
          ├── Development (Sessions 11-20)
          └── Mastery (Sessions 21-30)
              └── Session (10 per level)
                  ├── Expert Video URL
                  ├── Learning Sheet PDF URL
                  ├── MCQ Questions (12-25 questions)
                  ├── Core Activity
                  └── Key Concepts
```

## Database Schema

### Tables Created

1. **course_phases** - Phases within a course
2. **course_levels** - Levels within a phase (Foundation, Development, Mastery)
3. **course_sessions** - Individual sessions with content
4. **student_course_purchases** - Student purchase records
5. **student_progress** - Progress tracking per session
6. **student_projects** - Project submissions per level

### Key Indexes (Optimized for Scale)

- Composite indexes on `(course_id, sequence)` for phases
- Composite indexes on `(phase_id, sequence)` for levels
- Composite indexes on `(level_id, session_number)` for sessions
- Indexes on `(student_id, course_id, is_active)` for purchases
- Composite indexes on `(student_id, course_id, phase_id, level_id)` for progress
- Indexes on `(visibility, status)` for public/community projects

## Access Control Rules

### Purchase Tiers

- **10 Sessions** → Unlocks Level 1 (Foundation) - Sessions 1-10
- **20 Sessions** → Unlocks Level 1 + Level 2 (Foundation + Development) - Sessions 1-20
- **30 Sessions** → Unlocks All 3 Levels (Foundation + Development + Mastery) - Sessions 1-30

### Session Unlocking Logic

Sessions are automatically unlocked based on:
1. Purchase tier
2. Level type (foundation < development < mastery)
3. Session number within level

## Project Submission Rules

### Submission Requirements
- Student must complete **all 10 sessions** in a level before submitting a project
- Only **one project per level** is allowed
- Project must include:
  - Project video URL
  - Project PDF URL
  - Title
  - Description (optional)

### Visibility Rules (Automatic)

- **Level 1 (Foundation)** → `PRIVATE` - Only visible to student
- **Level 2 (Development)** → `COMMUNITY` - Visible to logged-in students, trainers, parents
- **Level 3 (Mastery)** → `PUBLIC` - Visible on public web page for marketing/showcase

### Project Status Flow

1. `pending` - Submitted, awaiting trainer review
2. `approved` - Trainer approved the project
3. `rejected` - Trainer rejected the project
4. `revision_required` - Trainer requested revisions

## Progress Tracking

### Tracked Metrics Per Session

- ✅ Video watched (boolean + timestamp)
- ✅ Learning sheet previewed (boolean + timestamp) - **Sheets are preview-only, not downloadable**
- ✅ Quiz completed (boolean + score + max score + timestamp)
- ✅ Session status: `not_started` | `in_progress` | `completed` | `locked`

**Note:** Learning sheets are **preview-only** in the app. They cannot be downloaded or screenshotted. This protects intellectual property while allowing students to view the content.

### Level Completion

A level is considered complete when:
- All 10 sessions have `status = 'completed'`
- Each session has `video_watched = true` and `quiz_completed = true`

## Usage Examples

### 1. Create Course Structure

```typescript
import { CourseStructureRepository } from './models/courseStructure.model';

const repo = new CourseStructureRepository(pool);

// Create phase
const phase = await repo.createPhase({
  courseId: 'course-uuid',
  title: 'Phase 1: Introduction',
  description: 'Learn the basics',
  sequence: 1
});

// Create level
const level = await repo.createLevel({
  phaseId: phase.id,
  levelType: 'foundation',
  title: 'Foundation Level',
  sequence: 1
});

// Create session
const session = await repo.createSession({
  levelId: level.id,
  sessionNumber: 1,
  title: 'Session 1: Getting Started',
  description: 'Introduction to the course',
  expertVideoUrl: 'https://...',
  learningSheetPdfUrl: 'https://...',
  mcqQuestions: [
    {
      id: 'q1',
      question: 'What is...?',
      options: ['A', 'B', 'C', 'D'],
      correctAnswerIndex: 0,
      explanation: 'Because...',
      points: 10
    }
  ],
  coreActivity: 'Build a simple project',
  keyConcepts: ['Concept 1', 'Concept 2']
});
```

### 2. Student Purchase & Access

```typescript
import { CourseStructureService } from './services/courseStructure.service';

const service = new CourseStructureService(repo);

// Create purchase (automatically unlocks sessions)
const purchase = await service.createPurchase({
  studentId: 'student-uuid',
  courseId: 'course-uuid',
  purchaseTier: 20, // Unlocks Foundation + Development
  expiryDate: new Date('2025-12-31')
});

// Check access
const access = await service.canAccessSession('student-uuid', 'session-uuid');
if (!access.canAccess) {
  console.log(access.reason); // "This session requires a 30 session purchase"
}

// Upgrade purchase
await service.upgradePurchase(purchase.id, 30); // Upgrades to full access
```

### 3. Track Progress

```typescript
// Mark video as watched
await service.markVideoWatched('student-uuid', 'session-uuid');

// Mark sheet as previewed (sheets are preview-only, not downloadable)
await service.markSheetPreviewed('student-uuid', 'session-uuid');

// Submit quiz results
await service.submitQuizResults('student-uuid', 'session-uuid', 85, 100);

// Check level completion
const completion = await service.isLevelCompleted('student-uuid', 'level-uuid');
console.log(`Completed: ${completion.completedSessions}/${completion.totalSessions}`);
```

### 4. Project Submission

```typescript
// Check if can submit (must complete all sessions in level)
const canSubmit = await service.canSubmitProject('student-uuid', 'level-uuid');
if (!canSubmit.canSubmit) {
  console.log(canSubmit.reason);
  return;
}

// Submit project
const project = await service.submitProject({
  studentId: 'student-uuid',
  levelId: 'level-uuid',
  projectVideoUrl: 'https://...',
  projectPdfUrl: 'https://...',
  title: 'My Capstone Project',
  description: 'A comprehensive project...'
});

// Visibility is automatically set:
// - Foundation → private
// - Development → community
// - Mastery → public
```

### 5. Trainer Review

```typescript
// Assign trainer to project
await service.assignTrainerToProject('project-uuid', 'trainer-uuid');

// Submit review
await service.submitProjectReview(
  'project-uuid',
  'trainer-uuid',
  'approved',
  'Excellent work! Great attention to detail.',
  5 // Rating 1-5
);

// Get trainer's projects
const projects = await service.getTrainerProjects('trainer-uuid', 'pending');
```

### 6. Public Showcase

```typescript
// Get public projects (for marketing page)
const publicProjects = await service.getVisibleProjects({
  isPublic: true,
  limit: 50
});

// Get community + public projects (for logged-in users)
const communityProjects = await service.getVisibleProjects({
  userId: 'user-uuid',
  limit: 50
});
```

## Migration & Setup

### Initialize Tables

```typescript
import { createCourseStructureTables } from './models/courseStructure.model';
import { getPool } from './config/database';

const pool = getPool();
await createCourseStructureTables(pool);
```

The migration will:
- Create all tables with proper constraints
- Add indexes for performance
- Set up triggers for `updated_at` timestamps

## Performance Optimizations

### Indexing Strategy

1. **Composite Indexes** - For common query patterns
   - `(student_id, course_id, is_active)` - Active purchases
   - `(student_id, course_id, phase_id, level_id)` - Progress queries
   - `(visibility, status)` - Public/community projects

2. **Partial Indexes** - For filtered queries
   - `WHERE is_active = true` - Only index active purchases
   - `WHERE visibility = 'public' AND status = 'approved'` - Public showcase

3. **Foreign Key Indexes** - Automatic on all foreign keys

### Query Optimization Tips

- Use `LIMIT` for pagination
- Filter by `is_active = true` for purchases
- Use composite indexes for multi-column queries
- Consider caching for public projects

## Scalability Considerations

### For 10K-1M Users

1. **Database Partitioning** (Future)
   - Partition `student_progress` by `course_id`
   - Partition `student_projects` by `visibility`

2. **Caching Strategy**
   - Cache public projects (Redis)
   - Cache course structure (Redis)
   - Cache student progress (Redis with TTL)

3. **Read Replicas**
   - Use read replicas for public project queries
   - Use read replicas for progress tracking

4. **Batch Operations**
   - Batch progress updates
   - Batch unlock operations during purchase

## API Endpoints (To Be Implemented)

### Course Structure
- `GET /api/v1/courses/:courseId/structure` - Get full course structure
- `POST /api/v1/courses/:courseId/phases` - Create phase
- `POST /api/v1/phases/:phaseId/levels` - Create level
- `POST /api/v1/levels/:levelId/sessions` - Create session

### Student Access
- `POST /api/v1/purchases` - Create purchase
- `POST /api/v1/purchases/:purchaseId/upgrade` - Upgrade purchase
- `GET /api/v1/students/:studentId/courses/:courseId/access` - Check access

### Progress
- `POST /api/v1/progress/video-watched` - Mark video watched
- `POST /api/v1/progress/sheet-previewed` - Mark sheet previewed (sheets are preview-only)
- `POST /api/v1/progress/quiz` - Submit quiz results
- `GET /api/v1/students/:studentId/courses/:courseId/progress` - Get progress

### Projects
- `POST /api/v1/projects` - Submit project
- `GET /api/v1/projects/public` - Get public projects
- `GET /api/v1/projects/community` - Get community projects
- `POST /api/v1/projects/:projectId/review` - Trainer review

## Testing Checklist

- [ ] Create course structure (phases, levels, sessions)
- [ ] Purchase with different tiers (10, 20, 30)
- [ ] Verify session unlocking logic
- [ ] Track progress (video, sheet, quiz)
- [ ] Submit project after level completion
- [ ] Verify project visibility rules
- [ ] Trainer review workflow
- [ ] Upgrade purchase functionality
- [ ] Public/community project visibility

## Future Enhancements

1. **Analytics Dashboard**
   - Student completion rates
   - Popular sessions
   - Project submission trends

2. **Gamification**
   - Points system
   - Badges for milestones
   - Leaderboards

3. **Advanced Access Control**
   - Time-based access
   - Prerequisite sessions
   - Custom unlock rules

4. **Project Marketplace**
   - Student-to-student learning
   - Featured projects
   - Project ratings

