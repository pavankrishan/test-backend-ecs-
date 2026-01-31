import mongoose, { Schema, Document } from 'mongoose';

export interface ICourse extends Document {
    title: string;
    description: string;
    instructor: string;
    duration: number; // in hours
    price: number;
    category: string;
    status: 'active' | 'inactive' | 'draft';
    createdAt: Date;
    updatedAt: Date;
}

const CourseSchema = new Schema<ICourse>(
    {
        title: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            required: true,
        },
        instructor: {
            type: String,
            required: true,
        },
        duration: {
            type: Number,
            required: true,
            min: 0,
        },
        price: {
            type: Number,
            required: true,
            min: 0,
        },
        category: {
            type: String,
            required: true,
            trim: true,
        },
        status: {
            type: String,
            enum: ['active', 'inactive', 'draft'],
            default: 'active',
        },
    },
    {
        timestamps: true,
        collection: 'courses',
    }
);

// CRITICAL: Safe guard pattern - prevents OverwriteModelError during retries
// WHY: Mongoose models must be idempotent - check if model exists before creating
export const Course = mongoose.models.Course || mongoose.model<ICourse>('Course', CourseSchema);

