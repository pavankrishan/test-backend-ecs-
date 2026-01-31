/**
 * Exam Model - MongoDB Schema
 * Stores final exam questions for levels
 * Each exam contains exactly 30 MCQ questions
 * 
 * CRITICAL: Uses mongoose singleton from config/mongoose.ts
 * This ensures the model is registered on the same mongoose instance that gets connected
 */

import mongoose from '../config/mongoose';
import { Schema, Document, Model } from 'mongoose';
import { MCQQuestion, MCQQuestionSchema } from './quiz.model';

export interface IExam extends Document {
  levelId: string; // References course_levels.id (PostgreSQL UUID)
  questions: MCQQuestion[]; // Exactly 30 questions
  totalPoints: number; // Always 150 (30 questions * 5 points each)
  maxAttempts: number; // Always 3
  createdAt: Date;
  updatedAt: Date;
}

const ExamSchema = new Schema<IExam>(
  {
    levelId: {
      type: String,
      required: true,
      unique: true, // One exam per level
    },
    questions: {
      type: [MCQQuestionSchema], // Use MCQQuestion structure from quiz.model
      required: true,
      validate: {
        validator: function(v: MCQQuestion[]) {
          return v.length === 30; // Exactly 30 questions for final exam
        },
        message: 'Exam must have exactly 30 questions',
      },
    },
    totalPoints: {
      type: Number,
      required: true,
      default: 150, // 30 questions * 5 points each
    },
    maxAttempts: {
      type: Number,
      required: true,
      default: 3,
    },
  },
  {
    timestamps: true,
  }
);

// Index for level lookup
ExamSchema.index({ levelId: 1 }, { unique: true });

// Auto-calculate totalPoints before save
ExamSchema.pre('save', function(this: IExam) {
  if (this.isNew || this.isModified('questions')) {
    if (this.questions && this.questions.length > 0) {
      // Each question is worth 5 points (correct answer)
      this.totalPoints = this.questions.length * 5;
    } else {
      this.totalPoints = 150; // Default for 30 questions
    }
  }
});

// CRITICAL: Safe guard pattern - prevents OverwriteModelError during retries
// WHY: Mongoose models must be idempotent - check if model exists before creating
export const Exam: Model<IExam> = mongoose.models.Exam || mongoose.model<IExam>('Exam', ExamSchema);
