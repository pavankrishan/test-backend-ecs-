/**
 * Firebase Admin SDK initialization for FCM (HTTP v1).
 * Run initializeFirebase() at application startup; fail fast if credentials are missing.
 *
 * Credentials (use one of):
 * - GOOGLE_APPLICATION_CREDENTIALS: path to service-account JSON (preferred)
 * - FIREBASE_PRIVATE_KEY + FIREBASE_CLIENT_EMAIL: explicit config (Docker/K8s)
 */

import * as admin from 'firebase-admin';
import logger from '@kodingcaravan/shared/config/logger';

let initialized = false;

/**
 * Initialize Firebase Admin SDK. Throws if credentials are missing or invalid.
 * Call once at startup (e.g. in index.ts before app.listen).
 */
export async function initializeFirebase(): Promise<void> {
  if (initialized) {
    return;
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT;

  // 1. Prefer GOOGLE_APPLICATION_CREDENTIALS (file path)
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialsPath) {
    try {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: projectId || undefined,
      });
      initialized = true;
      logger.info('Firebase Admin SDK initialized successfully', {
        method: 'GOOGLE_APPLICATION_CREDENTIALS',
        projectId: admin.app().options.projectId,
        service: 'notification-service',
      });
      return;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Firebase Admin SDK initialization failed (GOOGLE_APPLICATION_CREDENTIALS)', {
        error: message,
        path: credentialsPath,
        service: 'notification-service',
      });
      throw new Error(
        `FCM initialization failed: ${message}. Check GOOGLE_APPLICATION_CREDENTIALS path and file contents.`
      );
    }
  }

  // 2. Explicit service account from env (FIREBASE_PRIVATE_KEY + FIREBASE_CLIENT_EMAIL)
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL || process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL;

  if (privateKey && clientEmail) {
    if (!projectId) {
      throw new Error(
        'FCM initialization failed: FIREBASE_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) is required when using FIREBASE_PRIVATE_KEY + FIREBASE_CLIENT_EMAIL.'
      );
    }
    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
      initialized = true;
      logger.info('Firebase Admin SDK initialized successfully', {
        method: 'FIREBASE_PRIVATE_KEY + FIREBASE_CLIENT_EMAIL',
        projectId,
        service: 'notification-service',
      });
      return;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Firebase Admin SDK initialization failed (env credentials)', {
        error: message,
        projectId,
        service: 'notification-service',
      });
      throw new Error(`FCM initialization failed: ${message}`);
    }
  }

  // Allow running without FCM when FCM_OPTIONAL or SKIP_FCM is set (e.g. dev/Docker without Firebase).
  const fcmOptional =
    process.env.FCM_OPTIONAL === 'true' || process.env.FCM_OPTIONAL === '1' ||
    process.env.SKIP_FCM === 'true' || process.env.SKIP_FCM === '1';
  if (fcmOptional) {
    logger.warn('FCM credentials not configured; running without push. Set FCM env to enable. See kc-backend/FCM_V1_SETUP.md', {
      service: 'notification-service',
    });
    return;
  }

  throw new Error(
    'FCM credentials not configured. Set one of: (1) GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json, or (2) FIREBASE_PRIVATE_KEY + FIREBASE_CLIENT_EMAIL + FIREBASE_PROJECT_ID. See kc-backend/FCM_V1_SETUP.md'
  );
}

/**
 * Whether Firebase Admin SDK has been initialized (and FCM can send).
 */
export function isFirebaseInitialized(): boolean {
  return initialized;
}

/**
 * Get Firebase Messaging instance (FCM HTTP v1). Use after initializeFirebase().
 */
export function getMessaging(): admin.messaging.Messaging {
  if (!initialized) {
    throw new Error('Firebase Admin SDK not initialized. Call initializeFirebase() at startup.');
  }
  return admin.messaging();
}

export interface SendPushOptions {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  /** Android notification channel (e.g. student_notifications, trainer_notifications). */
  channelId?: string;
}

/**
 * Send a single FCM message (HTTP v1) to one device token.
 * Use for backend-triggered push (course purchase, trainer allocation, session events).
 */
export async function sendPush(options: SendPushOptions): Promise<{ success: boolean; error?: string }> {
  if (!initialized) {
    return { success: false, error: 'Firebase Admin SDK not initialized' };
  }

  const { token, title, body, data, channelId = 'default' } = options;

  try {
    const messaging = getMessaging();
    const message: admin.messaging.Message = {
      token,
      notification: {
        title,
        body,
      },
      data: data
        ? Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v)])
          )
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
        payload: {
          aps: { sound: 'default', badge: 1 },
        },
      },
    };

    await messaging.send(message);
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}
