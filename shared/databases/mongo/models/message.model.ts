import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IMessage extends Document {
    senderId: Types.ObjectId;
    receiverId: Types.ObjectId;
    content: string;
    type: 'text' | 'image' | 'file' | 'video';
    read: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const MessageSchema = new Schema<IMessage>(
    {
        senderId: {
            type: Schema.Types.ObjectId,
            required: true,
            ref: 'User',
        },
        receiverId: {
            type: Schema.Types.ObjectId,
            required: true,
            ref: 'User',
        },
        content: {
            type: String,
            required: true,
        },
        type: {
            type: String,
            enum: ['text', 'image', 'file', 'video'],
            default: 'text',
        },
        read: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
        collection: 'messages',
    }
);

// Index for faster queries
MessageSchema.index({ senderId: 1, receiverId: 1 });
MessageSchema.index({ createdAt: -1 });

// CRITICAL: Safe guard pattern - prevents OverwriteModelError during retries
// WHY: Mongoose models must be idempotent - check if model exists before creating
export const Message = mongoose.models.Message || mongoose.model<IMessage>('Message', MessageSchema);

