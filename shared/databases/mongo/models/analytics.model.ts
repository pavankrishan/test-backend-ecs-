import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IAnalytics extends Document {
    eventType: string;
    userId: Types.ObjectId;
    courseId?: Types.ObjectId;
    metadata: Record<string, any>;
    timestamp: Date;
    createdAt: Date;
}

const AnalyticsSchema = new Schema<IAnalytics>(
    {
        eventType: {
            type: String,
            required: true,
            index: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            required: true,
            ref: 'User',
            index: true,
        },
        courseId: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
            index: true,
        },
        metadata: {
            type: Schema.Types.Mixed,
            default: {},
        },
        timestamp: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        timestamps: true,
        collection: 'analytics',
    }
);

// Compound indexes for common queries
AnalyticsSchema.index({ eventType: 1, timestamp: -1 });
AnalyticsSchema.index({ userId: 1, eventType: 1, timestamp: -1 });

// CRITICAL: Safe guard pattern - prevents OverwriteModelError during retries
// WHY: Mongoose models must be idempotent - check if model exists before creating
export const Analytics = mongoose.models.Analytics || mongoose.model<IAnalytics>('Analytics', AnalyticsSchema);

