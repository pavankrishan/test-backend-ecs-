import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IDeviceToken extends Document {
  userId: Types.ObjectId;
  token: string;
  platform: 'ios' | 'android' | 'web';
  role?: 'student' | 'trainer'; // User role for role-specific notifications
  deviceId?: string;
  deviceName?: string;
  appVersion?: string;
  isActive: boolean;
  lastUsedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DeviceTokenSchema = new Schema<IDeviceToken>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: 'User',
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    platform: {
      type: String,
      enum: ['ios', 'android', 'web'],
      required: true,
    },
    role: {
      type: String,
      enum: ['student', 'trainer'],
      index: true, // Index for role-based queries (useful for future app separation)
    },
    deviceId: {
      type: String,
      trim: true,
    },
    deviceName: {
      type: String,
      trim: true,
    },
    appVersion: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'device_tokens',
  }
);

// Compound index for efficient queries
DeviceTokenSchema.index({ userId: 1, isActive: 1 });
DeviceTokenSchema.index({ token: 1, isActive: 1 });
DeviceTokenSchema.index({ role: 1, isActive: 1 }); // Index for role-based notification targeting

// CRITICAL: Safe guard pattern - prevents OverwriteModelError during retries
// WHY: Mongoose models must be idempotent - check if model exists before creating
export const DeviceToken = mongoose.models.DeviceToken || mongoose.model<IDeviceToken>('DeviceToken', DeviceTokenSchema);

