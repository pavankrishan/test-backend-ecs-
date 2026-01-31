# MCQ Upload Guide for Robotics Course

This guide explains how to upload MCQ questions from PDF files to MongoDB for the Robotics course.

## Prerequisites

1. Robotics course must be created in the database
2. MongoDB connection configured
3. PostgreSQL connection configured
4. PDF files in the directory: `e:\Robotics_Growth_Cycle_1\MCQS`

## Installation

Install PDF parsing library:

```bash
cd kc-backend/services/course-service
npm install pdf-parse --save-dev
```

## Option 1: Automated PDF Upload (Recommended)

The script `uploadRoboticsMCQs.ts` attempts to automatically extract questions from PDFs:

```bash
npx tsx scripts/uploadRoboticsMCQs.ts
```

**Note**: PDF parsing is complex and format-dependent. You may need to adjust the parsing logic in the script based on your PDF format.

## Option 2: Manual JSON Upload

If PDF parsing doesn't work well, you can create a JSON file manually:

1. Create a JSON file with the following structure:

```json
{
  "sessionNumber": 1,
  "questions": [
    {
      "id": "q1",
      "question": "What is the primary purpose of robotics?",
      "options": [
        "To replace humans completely",
        "To assist and automate tasks",
        "To create entertainment only",
        "To eliminate jobs"
      ],
      "correctAnswerIndex": 1,
      "explanation": "Robotics aims to assist and automate tasks, making work easier and more efficient.",
      "points": 10
    }
    // ... more questions (12-25 total)
  ],
  "passingScore": 60
}
```

2. Use the manual upload script (to be created) or directly insert into MongoDB.

## PDF Format Requirements

For automated parsing to work, PDFs should have:
- Text-based content (not scanned images)
- Clear question numbering (Q1, Q2, or Question 1, Question 2, etc.)
- Options marked with letters (A, B, C, D) or numbers (1, 2, 3, 4)
- Answer indicated clearly (Answer: B, Correct Answer: C, etc.)

## Session Mapping

The script maps PDF files to sessions based on filename:
- `KC_Growth_Cycle_1_Session1_MCQ.pdf` → Session 1
- `KC_Growth_Cycle_1_Session26_MCQ.pdf` → Session 26

Sessions are mapped sequentially:
- Sessions 1-10: Phase 1, Level 1 (Foundation)
- Sessions 11-20: Phase 1, Level 2 (Development)
- Sessions 21-30: Phase 1, Level 3 (Mastery)
- And so on...

## Troubleshooting

### Error: PDF parsing library not available
- Install pdf-parse: `npm install pdf-parse --save-dev`

### Error: Robotics course not found
- Ensure the robotics course exists in the database
- Check course title includes "robotics" (case-insensitive)

### Error: Session not found
- Verify the course has the expected number of sessions
- Check session numbering in the database

### No questions extracted
- PDF format may not match parsing patterns
- Try manual JSON upload instead
- Adjust parsing logic in the script

## After Upload

After quizzes are created in MongoDB:
1. Note the Quiz IDs from the output
2. Update session records in PostgreSQL to link `quizId` fields
3. Verify quizzes are accessible via API

## Manual Session-Quiz Linking

To link a quiz to a session in PostgreSQL:

```sql
UPDATE course_sessions 
SET quiz_id = '<mongodb-quiz-id>' 
WHERE id = '<session-uuid>';
```

