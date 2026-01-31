import "@kodingcaravan/shared/config";
import { getServicePortSync } from "@kodingcaravan/shared";
import logger, { logServiceStart } from "@kodingcaravan/shared/config/logger";
import app from './app';
import { disconnectMongo } from '@kodingcaravan/shared/databases/mongo/connection';
import { initializeFirebase } from './config/firebase';

const PORT = getServicePortSync('Notification Service', 'NOTIFICATION_SERVICE_PORT', 3006);

async function start(): Promise<void> {
  try {
    await initializeFirebase();
  } catch (error) {
    logger.error('Notification service cannot start: FCM initialization failed', {
      service: 'notification-service',
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    logServiceStart('Notification Service', PORT);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${PORT} is already in use`, {
        service: 'notification-service',
        port: PORT,
        error: err.message,
        code: err.code,
      });
      process.exit(1);
    } else {
      logger.error('Server error', {
        service: 'notification-service',
        error: err.message,
        code: err.code,
      });
      process.exit(1);
    }
  });

  const gracefulShutdown = (signal: string) => {
    logger.info(`Received ${signal}, starting graceful shutdown`, { service: 'notification-service' });
    server.close(async () => {
      logger.info('HTTP server closed', { service: 'notification-service' });
      try {
        await disconnectMongo();
        logger.info('Database connections closed', { service: 'notification-service' });
      } catch (error) {
        logger.error('Error closing databases', {
          service: 'notification-service',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('Forced shutdown after timeout', { service: 'notification-service' });
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

start().catch((error) => {
  logger.error('Notification service failed to start', {
    service: 'notification-service',
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
