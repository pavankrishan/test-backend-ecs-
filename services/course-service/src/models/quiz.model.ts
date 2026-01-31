/**
 * Quiz Model - MongoDB Schema
 * Stores quizzes separately from sessions
 * Each quiz contains 12-30 MCQ questions
 * 
 * CRITICAL: Uses mongoose singleton from config/mongoose.ts
 * This ensures the model is registered on the same mongoose instance that gets connected
 */

import mongoose from '../config/mongoose';
import { Schema, Document, Model } from 'mongoose';

export interface MCQQuestion {
  id: string;
  question: string;
  questionImageUrl?: string; // Optional image URL for the question
  options: string[]; // 4 options typically
  optionImageUrls?: string[]; // Optional image URLs for each option (same length as options)
  correctAnswerIndex: number; // 0-based index
  explanation?: string;
  points: number; // Points for this question
}

export interface IQuiz extends Document {
  sessionId: string; // References course_sessions.id (PostgreSQL UUID)
  questions: MCQQuestion[]; // 12-30 questions
  totalPoints: number; // Sum of all question points
  passingScore?: number; // Optional passing score threshold
  createdAt: Date;
  updatedAt: Date;
}

export const MCQQuestionSchema = new Schema<MCQQuestion>(
  {
    id: {
      type: String,
      required: true,
    },
    question: {
      type: String,
      required: true,
    },
    questionImageUrl: {
      type: String,
    },
    options: {
      type: [String],
      required: true,
      validate: {
        validator: function(v: string[]) {
          return v.length >= 2 && v.length <= 10; // Typically 4, but allow flexibility
        },
        message: 'Options must have between 2 and 10 items',
      },
    },
    optionImageUrls: {
      type: [String],
    },
    correctAnswerIndex: {
      type: Number,
      required: true,
      min: 0,
    },
    explanation: {
      type: String,
    },
    points: {
      type: Number,
      required: true,
      min: 0,
      default: 1,
    },
  },
  { _id: false }
);

const QuizSchema = new Schema<IQuiz>(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true, // One quiz per session
    },
    questions: {
      type: [MCQQuestionSchema],
      required: true,
      validate: {
        validator: function(v: MCQQuestion[]) {
          return v.length >= 12 && v.length <= 30;
        },
        message: 'Quiz must have between 12 and 30 questions',
      },
    },
    totalPoints: {
      type: Number,
      required: true,
    },
    passingScore: {
      type: Number,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Index for session lookup (unique index - sessionId already has unique: true in schema)
// Note: Removed duplicate index to avoid warning

// Auto-calculate totalPoints before save
QuizSchema.pre('save', function(this: IQuiz) {
  if (this.isNew || this.isModified('questions')) {
    if (this.questions && this.questions.length > 0) {
      this.totalPoints = this.questions.reduce((sum, q) => sum + (q.points || 1), 0);
    } else {
      this.totalPoints = 0;
    }
  }
});

// CRITICAL: Safe guard pattern - prevents OverwriteModelError during retries
// WHY: Mongoose models must be idempotent - check if model exists before creating
export const Quiz: Model<IQuiz> = mongoose.models.Quiz || mongoose.model<IQuiz>('Quiz', QuizSchema);

