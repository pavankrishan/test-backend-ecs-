import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller';

export function createNotificationRoutes(controller: NotificationController): Router {
  const router = Router();

  // Notification routes
  router.get('/', controller.getUserNotifications);
  router.get('/unread-count', controller.getUnreadCount);
  router.post('/bulk', controller.createBulkNotifications);
  router.post('/', controller.createNotification);
  router.patch('/mark-all-read', controller.markAllAsRead);
  router.patch('/:id/read', controller.markNotificationRead);
  router.patch('/:id/unread', controller.markNotificationUnread);
  router.delete('/read', controller.deleteReadNotifications);
  router.delete('/:id', controller.deleteNotification);

  // SMS routes
  router.post('/sms', controller.sendSms);
  router.post('/sms/otp', controller.sendOtpSms);
  router.post('/sms/bulk', controller.sendBulkSms);
  router.get('/sms/status', controller.getSmsStatus);

  return router;
}

