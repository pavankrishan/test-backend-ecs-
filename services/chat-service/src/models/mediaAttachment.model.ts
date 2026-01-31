import mongoose, { Schema, model, Types, Document } from 'mongoose';

export type MediaAttachmentType = 'image' | 'video' | 'audio' | 'file';

export interface MediaAttachmentDocument extends Document {
  messageId: Types.ObjectId;
  url: string;
  type: MediaAttachmentType;
  size?: number;
  mimeType?: string;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

const MediaAttachmentSchema = new Schema<MediaAttachmentDocument>(
  {
    messageId: {
      type: Schema.Types.ObjectId,
      ref: 'ChatMessage',
      required: true,
      index: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['image', 'video', 'audio', 'file'],
      default: 'file',
      required: true,
      index: true,
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
  {
    timestamps: true,
    collection: 'chat_media_attachments',
  },
);

// CRITICAL: Safe guard pattern - prevents OverwriteModelError during retries
// WHY: Mongoose models must be idempotent - check if model exists before creating
export const MediaAttachment = mongoose.models.ChatMediaAttachment || model<MediaAttachmentDocument>('ChatMediaAttachment', MediaAttachmentSchema);

