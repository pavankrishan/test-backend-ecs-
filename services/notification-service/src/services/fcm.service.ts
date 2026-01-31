import { Types } from 'mongoose';
import { DeviceToken } from '@kodingcaravan/shared/databases/mongo/models';
import {
  isFirebaseInitialized,
  sendPush,
  getMessaging,
} from '../config/firebase';

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
}

export interface SendNotificationOptions {
  userId: string | Types.ObjectId;
  payload: PushNotificationPayload;
  priority?: 'high' | 'normal';
}

export class FCMService {
  constructor() {
    // FCM is initialized at startup via config/firebase.ts (initializeFirebase).
    // No async init here; fail fast happens in index.ts.
  }

  /**
   * Send push notification to a single user (looks up device tokens, then sends via FCM v1).
   */
  async sendToUser(options: SendNotificationOptions): Promise<{ success: number; failure: number }> {
    if (!isFirebaseInitialized()) {
      console.warn('⚠️  FCM Service not initialized, skipping push notification');
      return { success: 0, failure: 0 };
    }

    try {
      const userObjectId = this.ensureObjectId(options.userId, 'userId');

      const deviceTokens = await DeviceToken.find({
        userId: userObjectId,
        isActive: true,
      }).lean();

      if (deviceTokens.length === 0) {
        return { success: 0, failure: 0 };
      }

      const tokensByRole = deviceTokens.reduce(
        (acc, dt) => {
          const role = dt.role || 'default';
          if (!acc[role]) acc[role] = [];
          acc[role].push(dt.token);
          return acc;
        },
        {} as Record<string, string[]>
      );

      const successfulTokens: string[] = [];
      const failedTokens: string[] = [];
      const invalidTokens: string[] = [];

      for (const [role, tokens] of Object.entries(tokensByRole)) {
        const channelId =
          role === 'trainer'
            ? 'trainer_notifications'
            : role === 'student'
              ? 'student_notifications'
              : 'default';

        const result = await this.sendToMultipleDevices(
          tokens,
          options.payload,
          options.priority ?? 'high',
          channelId
        );
        successfulTokens.push(...result.successfulTokens);
        failedTokens.push(...result.failedTokens);
        invalidTokens.push(...result.invalidTokens);
      }

      if (successfulTokens.length > 0) {
        await DeviceToken.updateMany(
          { token: { $in: successfulTokens } },
          { $set: { lastUsedAt: new Date() } }
        );
      }
      if (invalidTokens.length > 0) {
        await DeviceToken.updateMany(
          { token: { $in: invalidTokens } },
          { $set: { isActive: false } }
        );
      }

      return {
        success: successfulTokens.length,
        failure: failedTokens.length + invalidTokens.length,
      };
    } catch (error) {
      console.error(`❌ Error sending notification to user ${options.userId}:`, error);
      return { success: 0, failure: 1 };
    }
  }

  /**
   * Send push notification to multiple users.
   */
  async sendToUsers(
    userIds: (string | Types.ObjectId)[],
    payload: PushNotificationPayload,
    priority: 'high' | 'normal' = 'high'
  ): Promise<{ success: number; failure: number }> {
    if (!isFirebaseInitialized()) {
      console.warn('⚠️  FCM Service not initialized, skipping push notification');
      return { success: 0, failure: 0 };
    }

    let totalSuccess = 0;
    let totalFailure = 0;
    const uniqueUserIds = [
      ...new Set(userIds.map((id) => this.ensureObjectId(id, 'userId').toString())),
    ];

    for (const userId of uniqueUserIds) {
      const result = await this.sendToUser({ userId, payload, priority });
      totalSuccess += result.success;
      totalFailure += result.failure;
    }

    return { success: totalSuccess, failure: totalFailure };
  }

  /**
   * Send to specific device tokens (uses FCM HTTP v1 via Firebase Admin SDK).
   */
  private async sendToMultipleDevices(
    tokens: string[],
    payload: PushNotificationPayload,
    _priority: 'high' | 'normal' = 'high',
    channelId: string = 'default'
  ): Promise<{
    successfulTokens: string[];
    failedTokens: string[];
    invalidTokens: string[];
  }> {
    if (!isFirebaseInitialized() || tokens.length === 0) {
      return {
        successfulTokens: [],
        failedTokens: [],
        invalidTokens: [],
      };
    }

    const successfulTokens: string[] = [];
    const failedTokens: string[] = [];
    const invalidTokens: string[] = [];

    for (const token of tokens) {
      const result = await sendPush({
        token,
        title: payload.title,
        body: payload.body,
        data: payload.data,
        channelId,
      });

      if (result.success) {
        successfulTokens.push(token);
      } else {
        const err = result.error ?? '';
        if (
          err.includes('INVALID_ARGUMENT') ||
          err.includes('NOT_FOUND') ||
          err.includes('UNREGISTERED')
        ) {
          invalidTokens.push(token);
          console.warn(`⚠️  Invalid token ${token.substring(0, 20)}... (will be deactivated)`);
        } else {
          failedTokens.push(token);
          console.error(`❌ Failed to send to token ${token.substring(0, 20)}...:`, result.error);
        }
      }
    }

    return {
      successfulTokens,
      failedTokens,
      invalidTokens,
    };
  }

  /**
   * Send push notification to a topic (FCM v1).
   */
  async sendToTopic(
    topic: string,
    payload: PushNotificationPayload,
    _priority: 'high' | 'normal' = 'high'
  ): Promise<boolean> {
    if (!isFirebaseInitialized()) {
      console.warn('⚠️  FCM Service not initialized, skipping push notification');
      return false;
    }

    const channelId = topic.includes('trainer') ? 'trainer_notifications' : 'student_notifications';

    try {
      const messaging = getMessaging();
      await messaging.send({
        topic,
        notification: {
          title: payload.title,
          body: payload.body,
          ...(payload.imageUrl && { imageUrl: payload.imageUrl }),
        },
        data: payload.data
          ? Object.fromEntries(Object.entries(payload.data).map(([k, v]) => [k, String(v)]))
          : undefined,
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId,
            color: channelId === 'trainer_notifications' ? '#0066cc' : '#6a0dad',
          },
        },
        apns: {
          headers: { 'apns-priority': '10' },
          payload: { aps: { sound: 'default', badge: 1 } },
        },
      });
      return true;
    } catch (error) {
      console.error('❌ Error sending message to topic:', error);
      return false;
    }
  }

  isInitialized(): boolean {
    return isFirebaseInitialized();
  }

  private ensureObjectId(id: string | Types.ObjectId, fieldName: string): Types.ObjectId {
    if (id instanceof Types.ObjectId) return id;
    if (Types.ObjectId.isValid(id)) return new Types.ObjectId(id);
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof id === 'string' && uuidPattern.test(id)) {
      const hexString = id.replace(/-/g, '').substring(0, 24);
      const paddedHex = hexString.padEnd(24, '0');
      if (/^[0-9a-f]{24}$/i.test(paddedHex)) return new Types.ObjectId(paddedHex);
    }
    throw new Error(`${fieldName} must be a valid ObjectId or UUID. Received: ${id}`);
  }
}
