# Course Creation Scripts

## Available Scripts

### Create Robotics Course
See details below.

### Create Coding Course

This script creates a complete Coding Fundamentals course with:
- **1 Course**: Coding Fundamentals
- **3 Phases**: Introduction to Programming, Intermediate Programming, Advanced Development
- **9 Levels**: 3 levels per phase (Foundation, Development, Mastery)
- **90 Sessions**: 10 sessions per level

#### Running the Script

```bash
# From the course-service directory
npx tsx scripts/createCodingCourse.ts
```

**Note**: This script uses the NEW refactored structure:
- Uses `difficulty` instead of `level` for course
- Uses S3 keys instead of public URLs (update with actual S3 keys after uploading files)
- Quizzes are stored separately in MongoDB (create quizzes separately and update `quizId` in sessions)

#### Course Details
- **Title**: Coding Fundamentals
- **Category**: Coding (direct category)
- **Difficulty**: Beginner
- **Price**: ₹2,999 (Discounted: ₹1,999)
- **Duration**: 30 hours (1,800 minutes)
- **Tags**: coding, programming, python, javascript, fundamentals, beginner, algorithms, problem-solving

---

## Create Robotics Course

This script creates a complete Robotics Fundamentals course with:
- **1 Course**: Robotics Fundamentals
- **3 Phases**: Introduction, Advanced Concepts, Mastery
- **9 Levels**: 3 levels per phase (Foundation, Development, Mastery)
- **90 Sessions**: 10 sessions per level

### Prerequisites

1. Ensure the course service database is running
2. Environment variables are configured (`.env` file)
3. All dependencies are installed (`npm install`)

### Running the Script

```bash
# From the course-service directory
npm run create-robotics-course
```

Or directly with tsx:

```bash
npx tsx scripts/createRoboticsCourse.ts
```

### What Gets Created

#### Course Details
- **Title**: Robotics Fundamentals
- **Category**: STEM / Robotics
- **Level**: Beginner
- **Price**: ₹2,999 (Discounted: ₹1,999)
- **Duration**: 30 hours (1,800 minutes)
- **Tags**: robotics, programming, electronics, arduino, sensors, automation

#### Phase 1: Introduction to Robotics
- **Foundation Level** (10 sessions): Basics, components, Arduino, sensors, motors, first robot
- **Development Level** (10 sessions): Intermediate programming and robot building
- **Mastery Level** (10 sessions): Advanced concepts and complex robots

#### Phase 2: Advanced Concepts
- **Foundation Level** (10 sessions): Advanced robotics basics
- **Development Level** (10 sessions): Intermediate advanced concepts
- **Mastery Level** (10 sessions): Master-level advanced concepts

#### Phase 3: Mastery and Applications
- **Foundation Level** (10 sessions): Real-world application basics
- **Development Level** (10 sessions): Intermediate real-world projects
- **Mastery Level** (10 sessions): Advanced real-world applications

### Session Structure

Each session includes:
- **Expert Video URL**: Instructional video
- **Learning Sheet PDF URL**: Study material (preview-only)
- **MCQ Questions**: 12-25 questions per session
- **Core Activity**: Hands-on activity
- **Key Concepts**: Learning objectives

### Access Control

Students can purchase:
- **10 Sessions**: Unlocks Foundation level (Sessions 1-10)
- **20 Sessions**: Unlocks Foundation + Development (Sessions 1-20)
- **30 Sessions**: Unlocks all 3 levels (Sessions 1-30)

### Project Submission

After completing each level (10 sessions), students can submit:
- **Level 1 Project**: Private (only visible to student)
- **Level 2 Project**: Community (visible to logged-in users)
- **Level 3 Project**: Public (visible on showcase page)

### Notes

- The script creates placeholder URLs for videos and PDFs. Replace these with actual content URLs.
- MCQ questions are included for the first few sessions as examples. Add more for other sessions as needed.
- The script automatically handles table creation if they don't exist.

### Troubleshooting

**Error: Cannot connect to database**
- Check your `.env` file has correct database credentials
- Ensure PostgreSQL is running
- Verify database exists

**Error: Table already exists**
- This is normal if tables were already created
- The script will continue and create the course

**Error: Course already exists**
- Delete the existing course from the database if you want to recreate it
- Or modify the script to check for existing courses first

---

## Complete Course Script

This script marks a course as completed for a specific student by updating all sessions in the course.### What It Does

- Marks all sessions in the course as completed
- Updates `student_progress` table for all sessions
- Sets `video_watched`, `sheet_previewed`, `quiz_completed` to `true`
- Sets `status` to `'completed'` for all sessions
- Unlocks all sessions if they were locked
- Provides a summary of completion status

### Prerequisites

1. Ensure the course service database is running
2. Environment variables are configured (`.env` file)
3. Course and student must exist in the database

### Running the Script

```bash
# From the course-service directory
npm run complete-course <studentId> <courseId>
```

Or directly with tsx:

```bash
npx tsx scripts/completeCourse.ts <studentId> <courseId>
```

### Example

```bash
# Complete a course for a student
npx tsx scripts/completeCourse.ts "123e4567-e89b-12d3-a456-426614174000" "123e4567-e89b-12d3-a456-426614174001"
```

### What Gets Updated

For each session in the course:
- `video_watched`: `true`
- `sheet_previewed`: `true`
- `quiz_completed`: `true`
- `quiz_score`: `100` (default)
- `quiz_max_score`: `100` (default)
- `status`: `'completed'`
- `is_unlocked`: `true`
- Timestamps are set for all activities

### Notes

- The script will skip sessions that are already completed
- Progress entries are created if they don't exist
- The `student_course_progress` table will be updated automatically via database triggers
- Course completion notifications should be triggered automatically by the system

### Troubleshooting

**Error: Course not found**
- Verify the course ID is correct
- Ensure the course exists in the database

**Error: No sessions found**
- The course may not have any sessions created yet
- Run the course creation script first

**Error: Database connection failed**
- Check your `.env` file has correct database credentials
- Ensure PostgreSQL is running
- Verify database exists