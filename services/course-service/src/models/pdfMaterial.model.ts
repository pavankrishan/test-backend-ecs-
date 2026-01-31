/**
 * PDF Material Model - MongoDB Schema
 * Stores PDF materials and course resources
 * 
 * CRITICAL: Uses mongoose singleton from config/mongoose.ts
 * This ensures the model is registered on the same mongoose instance that gets connected
 */

import mongoose from '../config/mongoose';
import { Schema, Document, Model } from 'mongoose';

export interface IPDFMaterial extends Document {
  courseId: string;
  title: string;
  description?: string;
  fileUrl: string;
  fileSize?: number;
  pageCount?: number;
  category: 'notes' | 'handout' | 'reference' | 'exercise';
  order: number;
  isDownloadable: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PDFMaterialSchema = new Schema<IPDFMaterial>(
  {
    courseId: {
      type: String,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
    fileUrl: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number,
    },
    pageCount: {
      type: Number,
    },
    category: {
      type: String,
      enum: ['notes', 'handout', 'reference', 'exercise'],
      default: 'notes',
    },
    order: {
      type: Number,
      required: true,
    },
    isDownloadable: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

PDFMaterialSchema.index({ courseId: 1, order: 1 });

// CRITICAL: Safe guard pattern - prevents OverwriteModelError during retries
// WHY: Mongoose models must be idempotent - check if model exists before creating
export const PDFMaterial: Model<IPDFMaterial> = mongoose.models.PDFMaterial || mongoose.model<IPDFMaterial>(
  'PDFMaterial',
  PDFMaterialSchema
);

