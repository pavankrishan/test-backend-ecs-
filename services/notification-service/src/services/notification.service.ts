import { FilterQuery, Types } from 'mongoose';
import {
  Notification,
  INotification,
} from '@kodingcaravan/shared/databases/mongo/models';
import { FCMService } from './fcm.service';
import { Msg91Service, SendSmsOptions } from './msg91.service';

export type NotificationType = INotification['type'];
export type NotificationDocument = {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  message: string;
  type: NotificationType;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export interface CreateNotificationInput {
  userId: string | Types.ObjectId;
  title: string;
  message: string;
  type: NotificationType;
  read?: boolean;
}

export interface CreateBulkNotificationInput
  extends Omit<CreateNotificationInput, 'userId' | 'read'> {
  userIds: Array<string | Types.ObjectId>;
  read?: boolean;
}

export interface NotificationQueryOptions {
  read?: boolean;
  types?: NotificationType[] | NotificationType;
  from?: Date;
  to?: Date;
  search?: string;
  page?: number;
  limit?: number;
  sortDirection?: 'asc' | 'desc';
}

export interface NotificationListResult {
  items: NotificationDocument[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  unreadCount: number;
}

export class NotificationService {
  private fcmService: FCMService;
  private msg91Service: Msg91Service;

  constructor() {
    this.fcmService = new FCMService();
    this.msg91Service = new Msg91Service();
  }

  async createNotification(input: CreateNotificationInput): Promise<NotificationDocument> {
    const userObjectId = this.ensureObjectId(input.userId, 'userId');

    const notification = await Notification.create({
      userId: userObjectId,
      title: input.title.trim(),
      message: input.message.trim(),
      type: input.type,
      read: input.read ?? false,
    });

    // Send push notification asynchronously
    const notificationId = notification._id?.toString() || String(notification._id);
    this.sendPushNotification(userObjectId, {
      title: input.title.trim(),
      body: input.message.trim(),
      data: {
        notificationId: notificationId,
        type: input.type,
      },
    })
      .then((result) => {
        if (result.failure > 0) {
          console.warn(`⚠️  Push notification failed for ${result.failure} device(s)`);
        }
      })
      .catch((error) => {
        console.error('❌ Failed to send push notification:', error);
      });

    return notification.toObject() as NotificationDocument;
  }

  async createBulkNotifications(
    input: CreateBulkNotificationInput,
  ): Promise<NotificationDocument[]> {
    if (!input.userIds.length) {
      return [];
    }

    const docs = input.userIds.map((userId) => ({
      userId: this.ensureObjectId(userId, 'userId'),
      title: input.title.trim(),
      message: input.message.trim(),
      type: input.type,
      read: input.read ?? false,
    }));

    const created = await Notification.insertMany(docs, { ordered: false });

    // Send push notifications asynchronously
    const userIds = input.userIds.map((id) => this.ensureObjectId(id, 'userId').toString());
    this.sendPushNotificationToUsers(userIds, {
      title: input.title.trim(),
      body: input.message.trim(),
      data: {
        type: input.type,
      },
    }).catch((error) => {
      console.error('Failed to send bulk push notifications:', error);
    });

    return created.map((doc) => doc.toObject() as NotificationDocument);
  }

  async getUserNotifications(
    userId: string | Types.ObjectId,
    options: NotificationQueryOptions = {},
  ): Promise<NotificationListResult> {
    const userObjectId = this.ensureObjectId(userId, 'userId');
    const filters = this.buildFilters(userObjectId, options);

    const page = options.page && options.page > 0 ? options.page : 1;
    const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 100) : 20;
    const skip = (page - 1) * limit;
    const sortDirection = options.sortDirection === 'asc' ? 1 : -1;

    const [items, total, unreadCount] = await Promise.all([
      Notification.find(filters)
        .sort({ createdAt: sortDirection })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec()
        .then((docs) => docs as unknown as NotificationDocument[]),
      Notification.countDocuments(filters),
      Notification.countDocuments({ userId: userObjectId, read: false }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      unreadCount,
    };
  }

  async getUnreadCount(userId: string | Types.ObjectId): Promise<number> {
    const userObjectId = this.ensureObjectId(userId, 'userId');
    return Notification.countDocuments({ userId: userObjectId, read: false });
  }

  async markNotificationRead(
    notificationId: string | Types.ObjectId,
    userId?: string | Types.ObjectId,
  ): Promise<NotificationDocument | null> {
    return this.setNotificationReadStatus(notificationId, true, userId);
  }

  async markNotificationUnread(
    notificationId: string | Types.ObjectId,
    userId?: string | Types.ObjectId,
  ): Promise<NotificationDocument | null> {
    return this.setNotificationReadStatus(notificationId, false, userId);
  }

  async markAllAsRead(userId: string | Types.ObjectId): Promise<number> {
    const userObjectId = this.ensureObjectId(userId, 'userId');
    const result = await Notification.updateMany(
      { userId: userObjectId, read: false },
      { $set: { read: true } },
    );

    return result.modifiedCount ?? 0;
  }

  async deleteNotification(
    notificationId: string | Types.ObjectId,
    userId?: string | Types.ObjectId,
  ): Promise<boolean> {
    const filter: FilterQuery<INotification> = {
      _id: this.ensureObjectId(notificationId, 'notificationId'),
    };

    if (userId) {
      filter.userId = this.ensureObjectId(userId, 'userId');
    }

    const deleted = await Notification.findOneAndDelete(filter).lean();
    return Boolean(deleted);
  }

  async deleteReadNotifications(userId: string | Types.ObjectId): Promise<number> {
    const userObjectId = this.ensureObjectId(userId, 'userId');
    const result = await Notification.deleteMany({ userId: userObjectId, read: true });
    return result.deletedCount ?? 0;
  }

  private async setNotificationReadStatus(
    notificationId: string | Types.ObjectId,
    read: boolean,
    userId?: string | Types.ObjectId,
  ): Promise<NotificationDocument | null> {
    const filter: FilterQuery<INotification> = {
      _id: this.ensureObjectId(notificationId, 'notificationId'),
    };

    if (userId) {
      filter.userId = this.ensureObjectId(userId, 'userId');
    }

    const updated = await Notification.findOneAndUpdate(
      filter,
      { $set: { read } },
      { new: true },
    )
      .lean<NotificationDocument>()
      .exec();

    return updated;
  }

  private buildFilters(
    userId: Types.ObjectId,
    options: NotificationQueryOptions,
  ): FilterQuery<INotification> {
    const filters: FilterQuery<INotification> = { userId };

    if (typeof options.read === 'boolean') {
      filters.read = options.read;
    }

    if (options.types) {
      filters.type = Array.isArray(options.types)
        ? { $in: options.types }
        : options.types;
    }

    if (options.from || options.to) {
      filters.createdAt = {};
      if (options.from) {
        filters.createdAt.$gte = options.from;
      }
      if (options.to) {
        filters.createdAt.$lte = options.to;
      }
    }

    if (options.search) {
      const pattern = new RegExp(options.search.trim(), 'i');
      filters.$or = [{ title: pattern }, { message: pattern }];
    }

    return filters;
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

  /**
   * Send push notification to a single user
   */
  private async sendPushNotification(
    userId: string | Types.ObjectId,
    payload: { title: string; body: string; data?: Record<string, string> }
  ): Promise<{ success: number; failure: number }> {
    if (!this.fcmService.isInitialized()) {
      console.warn('⚠️  FCM Service not initialized, cannot send push notification');
      console.warn('   Check backend startup logs for FCM initialization status');
      return { success: 0, failure: 0 };
    }

    // Convert to ObjectId if it's a string
    const userObjectId = userId instanceof Types.ObjectId ? userId : this.ensureObjectId(userId, 'userId');
    
    const result = await this.fcmService.sendToUser({
      userId: userObjectId,
      payload,
      priority: 'high',
    });
    
    return result;
  }

  /**
   * Send push notification to multiple users
   */
  private async sendPushNotificationToUsers(
    userIds: string[],
    payload: { title: string; body: string; data?: Record<string, string> }
  ): Promise<void> {
    if (!this.fcmService.isInitialized() || userIds.length === 0) {
      return;
    }

    await this.fcmService.sendToUsers(userIds, payload, 'high');
  }

  /**
   * Send SMS notification
   */
  async sendSms(options: SendSmsOptions): Promise<{
    success: boolean;
    provider: 'msg91' | 'local';
    messageId?: string;
    error?: string;
    warning?: string;
  }> {
    return this.msg91Service.sendSms(options);
  }

  /**
   * Send OTP SMS
   */
  async sendOtpSms(phone: string, otpCode: string, message?: string): Promise<{
    success: boolean;
    provider: 'msg91' | 'local';
    messageId?: string;
    error?: string;
    warning?: string;
  }> {
    return this.msg91Service.sendOtp(phone, otpCode, message);
  }

  /**
   * Send bulk SMS notifications
   */
  async sendBulkSms(
    recipients: Array<{ phone: string; message: string }>
  ): Promise<Array<{
    success: boolean;
    provider: 'msg91' | 'local';
    phone: string;
    messageId?: string;
    error?: string;
    warning?: string;
  }>> {
    return this.msg91Service.sendBulkSms(recipients);
  }

  /**
   * Check if SMS service is ready
   */
  isSmsReady(): boolean {
    return this.msg91Service.isReady();
  }
}

