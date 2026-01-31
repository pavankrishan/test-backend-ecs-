import { Types } from 'mongoose';
import { DeviceToken, IDeviceToken } from '@kodingcaravan/shared/databases/mongo/models';

export interface RegisterDeviceTokenInput {
  userId: string | Types.ObjectId;
  token: string;
  platform: 'ios' | 'android' | 'web';
  role?: 'student' | 'trainer'; // User role for role-specific notifications
  deviceId?: string;
  deviceName?: string;
  appVersion?: string;
}

export interface UpdateDeviceTokenInput {
  deviceId?: string;
  deviceName?: string;
  appVersion?: string;
  isActive?: boolean;
}

export class DeviceTokenService {
  /**
   * Register or update a device token
   * Uses upsert to handle race conditions and duplicate key errors
   */
  async registerToken(input: RegisterDeviceTokenInput): Promise<IDeviceToken> {
    const userObjectId = this.ensureObjectId(input.userId, 'userId');

    try {
      // Use findOneAndUpdate with upsert to handle both create and update cases
      // This prevents duplicate key errors in race conditions
      const deviceToken = await DeviceToken.findOneAndUpdate(
        { token: input.token },
        {
          $set: {
            userId: userObjectId,
            token: input.token,
            platform: input.platform,
            role: input.role, // Update role when token is re-registered
            deviceId: input.deviceId,
            deviceName: input.deviceName,
            appVersion: input.appVersion,
            isActive: true,
            lastUsedAt: new Date(),
          },
        },
        { 
          new: true, 
          upsert: true, // Create if doesn't exist, update if exists
          runValidators: true 
        }
      );

      return deviceToken.toObject();
    } catch (error: any) {
      // Handle duplicate key error in case of race condition
      // Even with upsert, there's a small window for race conditions
      if (error.code === 11000 || error.message?.includes('duplicate key')) {
        // Token was created by another request, try to fetch and return it
        const existing = await DeviceToken.findOne({ token: input.token }).lean();
        if (existing) {
          // Update it with the latest data
          const updated = await DeviceToken.findOneAndUpdate(
            { token: input.token },
            {
              $set: {
                userId: userObjectId,
                platform: input.platform,
                role: input.role,
                deviceId: input.deviceId,
                deviceName: input.deviceName,
                appVersion: input.appVersion,
                isActive: true,
                lastUsedAt: new Date(),
              },
            },
            { new: true }
          );
          return updated?.toObject() || (existing as unknown as IDeviceToken);
        }
      }
      throw error;
    }
  }

  /**
   * Get all active tokens for a user
   */
  async getUserTokens(userId: string | Types.ObjectId): Promise<IDeviceToken[]> {
    const userObjectId = this.ensureObjectId(userId, 'userId');
    const tokens = await DeviceToken.find({
      userId: userObjectId,
      isActive: true,
    })
      .lean()
      .exec();

    return tokens as unknown as IDeviceToken[];
  }

  /**
   * Deactivate a device token
   */
  async deactivateToken(
    token: string,
    userId?: string | Types.ObjectId
  ): Promise<boolean> {
    const filter: any = { token };

    if (userId) {
      filter.userId = this.ensureObjectId(userId, 'userId');
    }

    const result = await DeviceToken.updateOne(filter, {
      $set: { isActive: false },
    });

    return result.modifiedCount > 0;
  }

  /**
   * Deactivate all tokens for a user
   */
  async deactivateUserTokens(userId: string | Types.ObjectId): Promise<number> {
    const userObjectId = this.ensureObjectId(userId, 'userId');
    const result = await DeviceToken.updateMany(
      { userId: userObjectId, isActive: true },
      { $set: { isActive: false } }
    );

    return result.modifiedCount ?? 0;
  }

  /**
   * Delete a device token
   */
  async deleteToken(token: string, userId?: string | Types.ObjectId): Promise<boolean> {
    const filter: any = { token };

    if (userId) {
      filter.userId = this.ensureObjectId(userId, 'userId');
    }

    const result = await DeviceToken.deleteOne(filter);
    return result.deletedCount > 0;
  }

  private ensureObjectId(id: string | Types.ObjectId, fieldName: string): Types.ObjectId {
    if (id instanceof Types.ObjectId) {
      return id;
    }

    // Check if it's a valid ObjectId format (24 hex characters)
    if (Types.ObjectId.isValid(id)) {
      return new Types.ObjectId(id);
    }

    // Handle UUID format (8-4-4-4-12 hex characters with dashes)
    // Convert UUID to ObjectId by using first 24 hex characters (removing dashes)
    if (typeof id === 'string') {
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidPattern.test(id)) {
        // Remove dashes and take first 24 characters
        const hexString = id.replace(/-/g, '').substring(0, 24);
        // Pad with zeros if needed (shouldn't be, but just in case)
        const paddedHex = hexString.padEnd(24, '0');
        if (/^[0-9a-f]{24}$/i.test(paddedHex)) {
          return new Types.ObjectId(paddedHex);
        }
      }
    }

    throw new Error(`${fieldName} must be a valid ObjectId or UUID. Received: ${id}`);
  }
}

