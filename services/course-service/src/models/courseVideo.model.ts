/**
 * Course Video Model - MongoDB Schema
 * Stores course video content, lessons, and materials
 * 
 * CRITICAL: Uses mongoose singleton from config/mongoose.ts
 * This ensures the model is registered on the same mongoose instance that gets connected
 */

import mongoose from '../config/mongoose';
import { Schema, Document, Model } from 'mongoose';

export interface ICourseVideo extends Document {
  courseId: string;
  moduleNumber: number;
  moduleTitle: string;
  lessonNumber: number;
  lessonTitle: string;
  videoUrl: string;
  videoDuration?: number; // in seconds
  thumbnailUrl?: string;
  description?: string;
  isPreview: boolean;
  order: number;
  resources?: {
    type: 'pdf' | 'link' | 'code';
    title: string;
    url: string;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const CourseVideoSchema = new Schema<ICourseVideo>(
  {
    courseId: {
      type: String,
      required: true,
      index: true,
    },
    moduleNumber: {
      type: Number,
      required: true,
    },
    moduleTitle: {
      type: String,
      required: true,
    },
    lessonNumber: {
      type: Number,
      required: true,
    },
    lessonTitle: {
      type: String,
      required: true,
    },
    videoUrl: {
      type: String,
      required: true,
    },
    videoDuration: {
      type: Number,
    },
    thumbnailUrl: {
      type: String,
    },
    description: {
      type: String,
    },
    isPreview: {
      type: Boolean,
      default: false,
    },
    order: {
      type: Number,
      required: true,
    },
    resources: [
      {
        type: {
          type: String,
          enum: ['pdf', 'link', 'code'],
        },
        title: String,
        url: String,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Compound indexes
CourseVideoSchema.index({ courseId: 1, moduleNumber: 1, lessonNumber: 1 }, { unique: true });
CourseVideoSchema.index({ courseId: 1, order: 1 });

// CRITICAL: Safe guard pattern - prevents OverwriteModelError during retries
// WHY: Mongoose models must be idempotent - check if model exists before creating
export const CourseVideo: Model<ICourseVideo> = mongoose.models.CourseVideo || mongoose.model<ICourseVideo>(
  'CourseVideo',
  CourseVideoSchema
);

