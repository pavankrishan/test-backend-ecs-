# Quiz Data Import Guide

This guide explains how to import quiz questions for the AI Course (Growth Cycle 1).

## Overview

The `importQuizData.ts` script imports quiz questions from a text format into MongoDB and links them to sessions in PostgreSQL.

## Prerequisites

1. ✅ AI Course created (run `createAICourseGrowthCycle1.ts` first)
2. ✅ MongoDB connection configured
3. ✅ PostgreSQL connection configured
4. ✅ All Growth Cycle 1 sessions exist

## Running the Script

```powershell
cd kc-backend\services\course-service
pnpm tsx scripts/importQuizData.ts
```

## Quiz Data Format

The script expects quiz data in the following format:

```
SESSION 1
1. Question text here
A. Option A text
B. Option B text
C. Option C text
D. Option D text
✅ Answer: B
2. Next question...
A. Option A
B. Option B
C. Option C
D. Option D
✅ Answer: C

SESSION 2
1. Question text...
...
```

### Format Rules:

- Each session starts with `SESSION X` where X is the session number (1-25)
- Each question starts with a number followed by a period: `1. Question text`
- Options are labeled A, B, C, D (case-insensitive)
- Answer is marked with `✅ Answer: X` where X is A, B, C, or D
- Questions and answers can optionally have images (add URLs manually after parsing)

## Features

✅ **Image Support**: The quiz model now supports optional images for:
   - Questions (`questionImageUrl`)
   - Options (`optionImageUrls` array)

✅ **Automatic Session Linking**: Quizzes are automatically linked to sessions via `quizId` in PostgreSQL

✅ **Validation**: 
   - Checks for existing quizzes (skips if found)
   - Validates question count (10-15 per session)
   - Validates correct answer format

✅ **Error Handling**: Gracefully handles missing sessions or parsing errors

## Current Status

The script currently includes quiz data for **Sessions 1-4**. 

To add more sessions (5-25):

1. Edit `importQuizData.ts`
2. Find the `QUIZ_DATA_TEXT` constant
3. Add quiz data for additional sessions in the same format
4. Run the script again

## Example Output

```
🚀 Starting Quiz Data Import...

🔌 Connecting to databases...
✅ Databases connected

✅ Found course: AI (course-id)
✅ Found phase: Growth Cycle 1

   Level 1 (Foundation): 10 sessions
   Level 2 (Development): 10 sessions
   Level 3 (Mastery): 10 sessions

✅ Found 30 sessions in Growth Cycle 1

📝 Parsing quiz data...
✅ Parsed 4 sessions with quiz data

  ✅ Created quiz for Session 1: Introduction to AI (15 questions, ID: ...)
     ✅ Linked quiz to session

  ✅ Created quiz for Session 2: AI Applications (15 questions, ID: ...)
     ✅ Linked quiz to session

...

🎉 Import Complete!
   ✅ Created: 4 quizzes
   ⚠️  Skipped: 0 quizzes
```

## Adding Images to Questions

After importing the quiz data, you can manually add image URLs to questions:

1. Access the MongoDB database
2. Find the quiz document
3. Update the `questionImageUrl` or `optionImageUrls` fields

Example MongoDB update:

```javascript
db.quizzes.updateOne(
  { sessionId: "session-uuid" },
  { 
    $set: { 
      "questions.0.questionImageUrl": "https://example.com/question-image.jpg",
      "questions.0.optionImageUrls": [
        "https://example.com/option-a.jpg",
        "https://example.com/option-b.jpg",
        "https://example.com/option-c.jpg",
        "https://example.com/option-d.jpg"
      ]
    }
  }
)
```

## Troubleshooting

### Error: "AI course not found"
- Make sure you've run `createAICourseGrowthCycle1.ts` first
- Verify the course exists in PostgreSQL

### Error: "Growth Cycle 1 phase not found"
- Ensure the course structure was created correctly
- Check that phases exist in the database

### Warning: "Session X not found in database"
- The session number in the quiz data doesn't match any session in the database
- Verify session numbers match (1-30 for Growth Cycle 1)

### Quiz already exists
- The script will skip sessions that already have quizzes
- To update an existing quiz, delete it first or manually update it in MongoDB

## Notes

- Each quiz requires 10-15 questions (current sessions have 15)
- Passing score is set to 60% by default
- Each question is worth 10 points by default
- Quiz questions are stored in MongoDB, linked to PostgreSQL sessions via `sessionId`
