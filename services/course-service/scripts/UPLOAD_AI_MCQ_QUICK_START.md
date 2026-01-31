# Quick Start: Create Mock AI MCQs

## Overview

This script automatically generates and uploads mock MCQ quizzes for all AI course sessions. Each quiz contains 15 AI-related questions tailored to the session topic.

## Prerequisites

1. ✅ AI course created in database (run `createAICourse.ts` first)
2. ✅ MongoDB connection configured
3. ✅ PostgreSQL connection configured
4. ✅ All AI course sessions exist

## Step 1: Run the Script

```powershell
cd kc-backend\services\course-service
npx tsx scripts/uploadAIMCQs.ts
```

## What the Script Does

1. ✅ Connects to PostgreSQL and MongoDB
2. ✅ Finds the AI course (searches for "AI" or "Artificial Intelligence")
3. ✅ Gets all sessions from all phases and levels
4. ✅ Generates 15 mock MCQ questions per session (tailored to session topic)
5. ✅ Creates Quiz documents in MongoDB
6. ✅ Links quizzes to sessions in PostgreSQL via `quizId`

## Question Generation

The script generates questions based on session topics:

- **Base Questions** (3): General AI concepts applicable to all sessions
- **Topic-Specific Questions** (2): Questions tailored to session title (e.g., Neural Networks, NLP, CNN, etc.)
- **Additional Questions** (10): General ML/AI questions to reach 15 total

### Topics Covered

- Introduction to AI
- Machine Learning basics
- Python for AI
- Neural Networks & Deep Learning
- CNNs (Convolutional Neural Networks)
- RNNs (Recurrent Neural Networks)
- NLP (Natural Language Processing)
- Regression & Classification
- Model Evaluation
- Ensemble Learning
- Clustering
- Model Deployment
- And more...

## Expected Output

```
🚀 Starting AI MCQ Quiz Creation...

🔌 Connecting to databases...
✅ Databases connected

✅ Found course: AI Fundamentals (course-id)
   Found 3 phases
   Phase 1: Introduction to Artificial Intelligence - 3 levels
     Level 1 (foundation): 10 sessions
     Level 2 (development): 10 sessions
     Level 3 (mastery): 10 sessions
   Phase 2: Advanced AI and Deep Learning - 3 levels
     ...
   Phase 3: AI Mastery and Real-World Applications - 3 levels
     ...

✅ Found 90 sessions total

  ✅ Created quiz for Session 1: What is Artificial Intelligence? (15 questions, ID: ...)
     ✅ Linked quiz to session

  ✅ Created quiz for Session 2: Introduction to Machine Learning (15 questions, ID: ...)
     ✅ Linked quiz to session

  ...

🎉 Upload Complete!
   ✅ Created: 90 quizzes
   ⚠️  Skipped: 0 quizzes (already exist)
```

## Question Structure

Each quiz contains:
- **15 questions** (meets requirement of 12-25)
- **4 options** per question
- **Correct answer index** (0-3)
- **Explanation** for each question
- **10 points** per question (150 total points)
- **60% passing score** (90 points)

## Troubleshooting

### Error: AI course not found

Create the AI course first:
```powershell
npx tsx scripts/createAICourse.ts
```

### Error: No sessions found

Ensure the AI course has phases, levels, and sessions created.

### Error: Quiz already exists

The script skips sessions that already have quizzes. To recreate:
1. Delete existing quizzes from MongoDB
2. Or update the script to handle existing quizzes differently

### Error: Database connection failed

Check your `.env` file in `kc-backend/`:
- `POSTGRES_URI` or PostgreSQL connection details
- `MONGODB_URI` or MongoDB connection details

## Verification

After running the script:

1. **Check MongoDB**: Verify quizzes were created
   ```javascript
   db.quizzes.find().count() // Should be 90 (or number of sessions)
   ```

2. **Check PostgreSQL**: Verify `quiz_id` is set in sessions
   ```sql
   SELECT COUNT(*) FROM course_sessions WHERE quiz_id IS NOT NULL;
   ```

3. **Test API**: Verify quizzes are accessible via course API

4. **Test Frontend**: Verify quizzes display correctly in session detail page

## Customization

To customize questions:

1. Edit `generateMockQuestions()` function in `uploadAIMCQs.ts`
2. Add more topic-specific question sets
3. Adjust question count (must be 12-25)
4. Modify points per question
5. Change passing score percentage

## Next Steps

1. ✅ Verify quizzes in MongoDB
2. ✅ Test quiz retrieval via API
3. ✅ Verify session-quiz linking in PostgreSQL
4. ✅ Test quiz display in frontend
5. ✅ Replace mock questions with real questions if needed

## Notes

- Questions are automatically generated and may need review
- Consider replacing mock questions with real, curated questions later
- Each session gets unique questions based on its topic
- Questions follow the MCQ format: question, 4 options, correct answer, explanation

