import "@kodingcaravan/shared/config";
import express from 'express';
import { globalErrorHandler, getServicePortSync } from "@kodingcaravan/shared";
import logger, { logServiceStart } from "@kodingcaravan/shared/config/logger";
import app from './app';
import { closeDatabases, getMongoConnection } from './config/database';

const PORT = getServicePortSync('Course Service', 'COURSE_SERVICE_PORT', 3005);

// Startup: HTTP server starts immediately so ALB /health can pass; MongoDB does NOT block startup.
// - /health returns 200 as soon as the process is listening.
// - /ready returns 503 until Mongo (and other deps) are connected; initMongo is retried in background.
// - No process.exit(1) due to Mongo unavailability at startup.
function start() {
  const server = app.listen(PORT, () => {
    logServiceStart('Course Service', PORT);
  });

  setupServerHandlers(server);

  // Connect MongoDB in background so /ready can eventually pass; do not block or exit on failure
  getMongoConnection().then(() => {
    logger.info('MongoDB connected (background)', { service: 'course-service' });
  }).catch((error) => {
    logger.warn('MongoDB background connection failed; /ready will stay 503 until Mongo is available', {
      service: 'course-service',
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function setupServerHandlers(server: ReturnType<typeof app.listen>) {

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${PORT} is already in use`, { 
        service: 'course-service',
        port: PORT,
        error: err.message,
        code: err.code
      });
      process.exit(1);
    } else {
      logger.error('Server error', { 
        service: 'course-service',
        error: err.message,
        code: err.code
      });
      process.exit(1);
    }
  });

  // Graceful shutdown handler
  const gracefulShutdown = async (signal: string) => {
    logger.info(`Received ${signal}, starting graceful shutdown`, { service: 'course-service' });
    
    // Stop accepting new connections
    server.close(async () => {
      logger.info('HTTP server closed', { service: 'course-service' });
      // Close database connections
      try {
        await closeDatabases();
        logger.info('Database connections closed', { service: 'course-service' });
      } catch (error) {
        logger.error('Error closing databases', { 
          service: 'course-service',
          error: error instanceof Error ? error.message : String(error)
        });
      }
      process.exit(0);
    });
    
    // Force shutdown after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout', { service: 'course-service' });
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

// Start the service
start();

// Handle uncaught exceptions gracefully (don't crash the service)
process.on('uncaughtException', (error: Error) => {
	logger.error('Uncaught exception', { 
		service: 'course-service',
		error: error.message,
		stack: error.stack
	});
});

process.on('unhandledRejection', (reason: any) => {
	logger.warn('Unhandled rejection', { 
		service: 'course-service',
		reason: reason instanceof Error ? reason.message : String(reason)
	});
});