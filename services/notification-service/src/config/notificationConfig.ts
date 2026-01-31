/**
 * Notification Service Configuration
 */

export interface NotificationConfig {
  serviceName: string;
  port: number;
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };
  firebase?: {
    projectId: string;
    privateKey: string;
    clientEmail: string;
  };
  push?: {
    vapidPublicKey: string;
    vapidPrivateKey: string;
  };
  msg91?: {
    authKey: string;
    sender: string;
    templateId?: string;
  };
}

export const loadNotificationConfig = (): NotificationConfig => {
  const config: NotificationConfig = {
    serviceName: 'notification-service',
    port: parseInt(process.env.NOTIFICATION_SERVICE_PORT || process.env.NOTIFICATION_PORT || '3006', 10),
  };

  if (process.env.SMTP_HOST) {
    config.smtp = {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
      },
    };
  }

  if (process.env.FIREBASE_PROJECT_ID) {
    config.firebase = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') || '',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
    };
  }

  if (process.env.VAPID_PUBLIC_KEY) {
    config.push = {
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
      vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
    };
  }

  if (process.env.MSG91_AUTH_KEY && process.env.MSG91_SENDER) {
    config.msg91 = {
      authKey: process.env.MSG91_AUTH_KEY,
      sender: process.env.MSG91_SENDER,
      templateId: process.env.MSG91_TEMPLATE_ID || undefined,
    };
  }

  return config;
};

