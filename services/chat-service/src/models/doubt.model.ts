import mongoose, { Schema, model, Types, Document } from 'mongoose';
// Note: mongoose is already imported above

// CRITICAL: Disable Mongoose buffering BEFORE models are defined
// This prevents "buffering timed out" errors when queries execute before connection is ready
// Must be done at module load time, before any model definitions
// Note: bufferCommands is already set in shared connection module, but set it here again to be safe
mongoose.set('bufferCommands', false);

export type DoubtStatus = 'pending' | 'in_progress' | 'answered' | 'closed';
export type DoubtType = 'text' | 'image' | 'voice';

export interface DoubtAttachment {
  url: string;
  type: 'image' | 'audio' | 'pdf';
  size?: number;
  mimeType?: string;
  metadata?: Record<string, unknown> | null;
}

export interface DoubtDocument extends Document {
  studentId: string; // UUID from PostgreSQL
  trainerId: string | null; // UUID from PostgreSQL, null until assigned
  subject: string;
  topic: string;
  question: string; // Text content
  type: DoubtType;
  attachments: DoubtAttachment[];
  status: DoubtStatus;
  createdAt: Date;
  updatedAt: Date;
  answeredAt?: Date;
  closedAt?: Date;
}

const DoubtAttachmentSchema = new Schema<DoubtAttachment>(
  {
    url: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['image', 'audio', 'pdf'],
      required: true,
    },
    size: {
      type: Number,
    },
    mimeType: {
      type: String,
      trim: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  { _id: false },
);

const DoubtSchema = new Schema<DoubtDocument>(
  {
    studentId: {
      type: String,
      required: true,
      index: true,
    },
    trainerId: {
      type: String,
      default: null,
      index: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    topic: {
      type: String,
      required: true,
      trim: true,
    },
    question: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['text', 'image', 'voice'],
      default: 'text',
      required: true,
    },
    attachments: {
      type: [DoubtAttachmentSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'answered', 'closed'],
      default: 'pending',
      index: true,
    },
    answeredAt: {
      type: Date,
    },
    closedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    collection: 'doubts',
  },
);

DoubtSchema.index({ studentId: 1, createdAt: -1 });
DoubtSchema.index({ trainerId: 1, status: 1, createdAt: -1 });
DoubtSchema.index({ status: 1, createdAt: -1 });

// CRITICAL: Safe guard pattern - prevents OverwriteModelError during retries
// WHY: Mongoose models must be idempotent - check if model exists before creating
export const Doubt = mongoose.models.Doubt || model<DoubtDocument>('Doubt', DoubtSchema);

