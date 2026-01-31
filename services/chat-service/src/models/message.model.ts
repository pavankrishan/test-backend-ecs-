import mongoose, { Schema, model, Types, Document } from 'mongoose';
import type { MediaAttachmentDocument } from './mediaAttachment.model';

export type MessageStatus = 'sent' | 'delivered' | 'read';
export type MessageType = 'text' | 'system' | 'image' | 'video' | 'audio' | 'file';

export interface ReadReceipt {
  userId: Types.ObjectId;
  readAt: Date;
}

export interface ChatMessageDocument extends Document {
  conversationId: Types.ObjectId;
  participants: Types.ObjectId[];
  senderId: Types.ObjectId;
  content: string | null;
  type: MessageType;
  status: MessageStatus;
  attachments: Types.DocumentArray<MediaAttachmentDocument & Document> | Types.ObjectId[];
  metadata?: Record<string, unknown> | null;
  readBy: ReadReceipt[];
  sentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ReadReceiptSchema = new Schema<ReadReceipt>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
      ref: 'User',
    },
    readAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const ChatMessageSchema = new Schema<ChatMessageDocument>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    participants: {
      type: [Schema.Types.ObjectId],
      required: true,
      validate: [(value: Types.ObjectId[]) => value.length >= 2, 'Conversation requires at least two participants'],
      index: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: 'User',
      index: true,
    },
    content: {
      type: String,
      default: null,
    },
    type: {
      type: String,
      enum: ['text', 'system', 'image', 'video', 'audio', 'file'],
      default: 'text',
      index: true,
    },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read'],
      default: 'sent',
      index: true,
    },
    attachments: [
      {
        type: Schema.Types.ObjectId,
        ref: 'ChatMediaAttachment',
      },
    ],
    metadata: {
      type: Schema.Types.Mixed,
      default: null,
    },
    readBy: {
      type: [ReadReceiptSchema],
      default: [],
    },
    sentAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'chat_messages',
  },
);

ChatMessageSchema.index({ conversationId: 1, sentAt: -1 });
ChatMessageSchema.index({ participants: 1, sentAt: -1 });
ChatMessageSchema.index({ senderId: 1, sentAt: -1 });

// CRITICAL: Safe guard pattern - prevents OverwriteModelError during retries
// WHY: Mongoose models must be idempotent - check if model exists before creating
export const ChatMessage = mongoose.models.ChatMessage || model<ChatMessageDocument>('ChatMessage', ChatMessageSchema);

