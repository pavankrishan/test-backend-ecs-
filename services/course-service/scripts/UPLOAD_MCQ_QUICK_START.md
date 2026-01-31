# Quick Start: Upload Robotics MCQs to MongoDB

## Prerequisites

1. ✅ Robotics course created in database
2. ✅ MongoDB connection configured
3. ✅ PostgreSQL connection configured
4. ✅ PDF files in: `e:\Robotics_Growth_Cycle_1\MCQS`

## Step 1: Install PDF Parser

```powershell
cd kc-backend\services\course-service
npm install pdf-parse --save-dev
```

## Step 2: Run Upload Script

```powershell
npx tsx scripts/uploadRoboticsMCQs.ts
```

## What the Script Does

1. ✅ Connects to PostgreSQL and MongoDB
2. ✅ Finds the Robotics course
3. ✅ Maps all sessions (Sessions 1-90 across 9 levels)
4. ✅ Reads PDF files from `e:\Robotics_Growth_Cycle_1\MCQS`
5. ✅ Extracts session numbers from filenames (e.g., `Session1`, `Session26`)
6. ✅ Extracts MCQ questions from PDFs
7. ✅ Creates Quiz documents in MongoDB
8. ✅ Links quizzes to sessions in PostgreSQL

## Expected Output

```
🚀 Starting MCQ Upload Process...
🔌 Connecting to databases...
✅ Databases connected
📁 Reading PDF files from: e:\Robotics_Growth_Cycle_1\MCQS
Found 22 PDF files
✅ Found course: Robotics Fundamentals
✅ Mapped 90 sessions
  📄 Processing: KC_Growth_Cycle_1_Session1_MCQ.pdf
    ✅ Extracted 15 questions
  ✅ Created quiz for Session 1 (15 questions, ID: ...)
  ✅ Linked quiz to session
...
🎉 Upload Complete!
   ✅ Uploaded: 22 quizzes
   ⚠️  Skipped: 0 files
```

## Troubleshooting

### Error: PDF parsing library not available
```powershell
npm install pdf-parse --save-dev
```

### Error: Robotics course not found
Create the robotics course first:
```powershell
npm run create-robotics-course
```

### Error: No questions extracted
- PDF format may not match parsing patterns
- Check PDF contains text (not just images)
- Adjust parsing logic in `parseQuestionsFromText()` function

### Error: Session not found
- Verify course has expected number of sessions (90 total)
- Check session numbering in database

## PDF Format Requirements

For automated parsing to work, PDFs should have:
- ✅ Text-based content (not scanned images)
- ✅ Clear question markers: `Q1.`, `Question 1:`, etc.
- ✅ Options marked: `A)`, `B)`, `C)`, `D)` or `(a)`, `(b)`, etc.
- ✅ Answer indicators: `Answer: B`, `Correct Answer: C`, etc.
- ✅ 12-25 questions per PDF

## Manual Review

After upload, verify quizzes in MongoDB:
- Each session should have one quiz
- Each quiz should have 12-25 questions
- Questions should have 4 options each
- Correct answer index should be valid (0-3)

## Next Steps

1. Verify quizzes in MongoDB
2. Test quiz retrieval via API
3. Verify session-quiz linking in PostgreSQL
4. Test quiz display in frontend

