import mongoose, { Schema, model, Types, Document } from 'mongoose';

export interface DoubtReplyAttachment {
  url: string;
  type: 'image' | 'audio' | 'pdf';
  size?: number;
  mimeType?: string;
  metadata?: Record<string, unknown> | null;
}

export interface DoubtReplyDocument extends Document {
  doubtId: Types.ObjectId; // MongoDB ObjectId (reference to Doubt)
  trainerId: string; // UUID from PostgreSQL
  reply: string; // Text content
  attachments: DoubtReplyAttachment[];
  createdAt: Date;
  updatedAt: Date;
}

const DoubtReplyAttachmentSchema = new Schema<DoubtReplyAttachment>(
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

const DoubtReplySchema = new Schema<DoubtReplyDocument>(
  {
    doubtId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: 'Doubt',
      index: true,
    },
    trainerId: {
      type: String,
      required: true,
      index: true,
    },
    reply: {
      type: String,
      required: true,
      trim: true,
    },
    attachments: {
      type: [DoubtReplyAttachmentSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'doubt_replies',
  },
);

DoubtReplySchema.index({ doubtId: 1, createdAt: -1 });
DoubtReplySchema.index({ trainerId: 1, createdAt: -1 });

// CRITICAL: Safe guard pattern - prevents OverwriteModelError during retries
// WHY: Mongoose models must be idempotent - check if model exists before creating
export const DoubtReply = mongoose.models.DoubtReply || model<DoubtReplyDocument>('DoubtReply', DoubtReplySchema);

