import { Request, Response } from 'express';
import {
  successResponse,
  errorResponse,
} from '@kodingcaravan/shared/utils/responseBuilder';
import {
  NotificationService,
  NotificationType,
} from '../services/notification.service';

type MaybeString = string | undefined | null;

export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  createNotification = async (req: Request, res: Response) => {
    try {
      const { userId, title, message, type, read } = req.body;

      if (!userId || !title || !message || !type) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'userId, title, message, and type are required',
        });
      }

      const notification = await this.notificationService.createNotification({
        userId,
        title,
        message,
        type,
        read,
      });

      return successResponse(res, {
        statusCode: 201,
        message: 'Notification created successfully',
        data: notification,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error?.message || 'Failed to create notification',
      });
    }
  };

  createBulkNotifications = async (req: Request, res: Response) => {
    try {
      const { userIds, title, message, type, read } = req.body;

      if (!Array.isArray(userIds) || !userIds.length) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'userIds must be a non-empty array',
        });
      }

      if (!title || !message || !type) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'title, message, and type are required',
        });
      }

      const notifications = await this.notificationService.createBulkNotifications({
        userIds,
        title,
        message,
        type,
        read,
      });

      return successResponse(res, {
        statusCode: 201,
        message: 'Notifications created successfully',
        data: {
          created: notifications.length,
          notifications,
        },
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error?.message || 'Failed to create notifications',
      });
    }
  };

  getUserNotifications = async (req: Request, res: Response) => {
    try {
      const userId = this.resolveUserId(req);
      if (!userId) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'User ID is required to fetch notifications',
        });
      }

      const readQuery = this.parseBoolean(req.query.read as MaybeString);
      const types = this.parseTypes(req.query.type as MaybeString);
      const page = this.parseNumber(req.query.page as MaybeString);
      const limit = this.parseNumber(req.query.limit as MaybeString);
      const sortDirection = (req.query.sortDirection as MaybeString) === 'asc' ? 'asc' : 'desc';

      const from = this.parseDate(req.query.from as MaybeString);
      const to = this.parseDate(req.query.to as MaybeString);

      const result = await this.notificationService.getUserNotifications(userId, {
        read: readQuery ?? undefined,
        types: types ?? undefined,
        page: page ?? undefined,
        limit: limit ?? undefined,
        sortDirection,
        search: (req.query.search as MaybeString)?.trim() || undefined,
        from: from ?? undefined,
        to: to ?? undefined,
      });

      return successResponse(res, {
        message: 'Notifications retrieved successfully',
        data: result,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error?.message || 'Failed to fetch notifications',
      });
    }
  };

  getUnreadCount = async (req: Request, res: Response) => {
    try {
      const userId = this.resolveUserId(req);
      if (!userId) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'User ID is required to fetch unread count',
        });
      }

      const count = await this.notificationService.getUnreadCount(userId);
      return successResponse(res, {
        message: 'Unread notification count retrieved successfully',
        data: { unreadCount: count },
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error?.message || 'Failed to fetch unread notifications count',
      });
    }
  };

  markNotificationRead = async (req: Request, res: Response) => {
    await this.toggleNotificationRead(req, res, true);
  };

  markNotificationUnread = async (req: Request, res: Response) => {
    await this.toggleNotificationRead(req, res, false);
  };

  markAllAsRead = async (req: Request, res: Response) => {
    try {
      const userId = this.resolveUserId(req);
      if (!userId) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'User ID is required to mark notifications as read',
        });
      }

      const updated = await this.notificationService.markAllAsRead(userId);
      return successResponse(res, {
        message: 'Notifications marked as read',
        data: { updated },
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error?.message || 'Failed to mark notifications as read',
      });
    }
  };

  deleteNotification = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        return errorResponse(res, { statusCode: 400, message: 'Notification ID is required' });
      }

      const userId = this.resolveUserId(req);

      const deleted = await this.notificationService.deleteNotification(id, userId ?? undefined);
      if (!deleted) {
        return errorResponse(res, {
          statusCode: 404,
          message: 'Notification not found',
        });
      }

      return successResponse(res, {
        message: 'Notification deleted successfully',
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error?.message || 'Failed to delete notification',
      });
    }
  };

  deleteReadNotifications = async (req: Request, res: Response) => {
    try {
      const userId = this.resolveUserId(req);
      if (!userId) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'User ID is required to delete read notifications',
        });
      }

      const removed = await this.notificationService.deleteReadNotifications(userId);
      return successResponse(res, {
        message: 'Read notifications deleted successfully',
        data: { deleted: removed },
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error?.message || 'Failed to delete read notifications',
      });
    }
  };

  private async toggleNotificationRead(req: Request, res: Response, read: boolean) {
    try {
      const { id } = req.params;
      if (!id) {
        return errorResponse(res, { statusCode: 400, message: 'Notification ID is required' });
      }

      const userId = this.resolveUserId(req);

      const updated = read
        ? await this.notificationService.markNotificationRead(id, userId ?? undefined)
        : await this.notificationService.markNotificationUnread(id, userId ?? undefined);

      if (!updated) {
        return errorResponse(res, {
          statusCode: 404,
          message: 'Notification not found',
        });
      }

      return successResponse(res, {
        message: read ? 'Notification marked as read' : 'Notification marked as unread',
        data: updated,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error?.message || 'Failed to update notification status',
      });
    }
  }

  private resolveUserId(req: Request): string | undefined {
    const user = (req as any).user;
    if (user?.id) return user.id;
    if (user?._id) return user._id;
    if (req.query.userId) return String(req.query.userId);
    if (req.body.userId) return String(req.body.userId);
    return undefined;
  }

  private parseBoolean(value: MaybeString): boolean | null {
    if (value === undefined || value === null) return null;
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return null;
  }

  private parseNumber(value: MaybeString): number | null {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private parseTypes(value: MaybeString): NotificationType[] | NotificationType | null {
    if (!value) return null;
    const parts = value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean) as NotificationType[];

    if (!parts.length) return null;
    return parts.length === 1 ? parts[0] : parts;
  }

  private parseDate(value: MaybeString): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  /**
   * Send SMS notification
   */
  sendSms = async (req: Request, res: Response) => {
    try {
      const { phone, message, templateId } = req.body;

      if (!phone || !message) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'phone and message are required',
        });
      }

      const result = await this.notificationService.sendSms({
        phone,
        message,
        templateId,
      });

      return successResponse(res, {
        message: 'SMS sent successfully',
        data: result,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error?.message || 'Failed to send SMS',
      });
    }
  };

  /**
   * Send OTP SMS
   */
  sendOtpSms = async (req: Request, res: Response) => {
    try {
      const { phone, otpCode, message } = req.body;

      if (!phone || !otpCode) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'phone and otpCode are required',
        });
      }

      const result = await this.notificationService.sendOtpSms(phone, otpCode, message);

      return successResponse(res, {
        message: 'OTP SMS sent successfully',
        data: result,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error?.message || 'Failed to send OTP SMS',
      });
    }
  };

  /**
   * Send bulk SMS
   */
  sendBulkSms = async (req: Request, res: Response) => {
    try {
      const { recipients } = req.body;

      if (!Array.isArray(recipients) || !recipients.length) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'recipients must be a non-empty array of {phone, message} objects',
        });
      }

      // Validate each recipient
      for (const recipient of recipients) {
        if (!recipient.phone || !recipient.message) {
          return errorResponse(res, {
            statusCode: 400,
            message: 'Each recipient must have phone and message',
          });
        }
      }

      const results = await this.notificationService.sendBulkSms(recipients);

      return successResponse(res, {
        message: 'Bulk SMS sent',
        data: {
          total: recipients.length,
          results,
        },
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error?.message || 'Failed to send bulk SMS',
      });
    }
  };

  /**
   * Check SMS service status
   */
  getSmsStatus = async (req: Request, res: Response) => {
    try {
      const isReady = this.notificationService.isSmsReady();

      return successResponse(res, {
        message: 'SMS service status',
        data: {
          ready: isReady,
          provider: isReady ? 'msg91' : 'local',
        },
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error?.message || 'Failed to get SMS status',
      });
    }
  };
}

