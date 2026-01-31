import express from 'express';
import timeout from 'connect-timeout';
import { connectMongo, globalErrorHandler, createHealthCheckEndpoints } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';
import mongoose from 'mongoose';
import { loadNotificationConfig } from './config/notificationConfig';
import { NotificationService } from './services/notification.service';
import { NotificationController } from './controllers/notification.controller';
import { createNotificationRoutes } from './routes/notification.routes';
import { DeviceTokenService } from './services/deviceToken.service';
import { DeviceTokenController } from './controllers/deviceToken.controller';
import { createDeviceTokenRoutes } from './routes/deviceToken.routes';

const app = express();
const config = loadNotificationConfig();

let servicesReady = false;
let initializationError: Error | null = null;
let initPromise: Promise<void> | null = null;

const notificationService = new NotificationService();
const notificationController = new NotificationController(notificationService);
const notificationRouter = createNotificationRoutes(notificationController);

const deviceTokenService = new DeviceTokenService();
const deviceTokenController = new DeviceTokenController(deviceTokenService);
const deviceTokenRouter = createDeviceTokenRoutes(deviceTokenController);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Request timeout middleware (30 seconds)
app.use(timeout('30s'));

// Timeout handler - must be after timeout middleware
app.use((req, res, next) => {
  if (!req.timedout) next();
});

async function initializeServices(): Promise<void> {
  if (servicesReady) return;

  if (!initPromise) {
    initPromise = (async () => {
      try {
        await connectMongo();
        servicesReady = true;
        initializationError = null;
        logger.info(`${config.serviceName} connected to MongoDB`, { service: config.serviceName });
      } catch (error) {
        initializationError =
          error instanceof Error ? error : new Error('Unknown initialization error');
        logger.error(`Failed to initialize ${config.serviceName}`, { 
          service: config.serviceName,
          error: initializationError.message
        });
        // Don't throw - allow service to start without MongoDB
        // Service will return 503 on /ready endpoint and handle requests gracefully
        logger.warn(`${config.serviceName} starting without MongoDB - some features may be unavailable`, {
          service: config.serviceName
        });
      } finally {
        initPromise = null;
      }
    })();
  }

  return initPromise;
}

// Initialize services but don't crash if MongoDB fails
void initializeServices().catch((err) => {
  logger.error(`Failed to initialize ${config.serviceName} services`, {
    service: config.serviceName,
    error: err instanceof Error ? err.message : String(err)
  });
  // Don't exit - allow service to start and handle requests gracefully
});

// Health check endpoints (will be initialized after MongoDB is ready)
let healthCheckHandlers: { healthHandler: any; readyHandler: any } | null = null;

async function setupHealthChecks() {
  if (!healthCheckHandlers) {
    await initializeServices();
    
    healthCheckHandlers = createHealthCheckEndpoints({
      serviceName: config.serviceName,
      mongoConnection: mongoose.connection,
    });
  }
  return healthCheckHandlers;
}

// Health check (liveness probe)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: config.serviceName,
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe - checks dependencies
app.get('/ready', async (_req, res) => {
  try {
    const handlers = await setupHealthChecks();
    await handlers.readyHandler(_req, res);
  } catch (error) {
    res.status(503).json({
      ready: false,
      service: config.serviceName,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
  }
});

app.use(async (req, res, next) => {
  // Health and readiness endpoints don't require services
  if (req.path === '/' || req.path === '/health' || req.path === '/ready') {
    return next();
  }

  // Try to initialize if not ready, but don't block forever
  if (!servicesReady) {
    try {
      await Promise.race([
        initializeServices(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Initialization timeout')), 5000)
        )
      ]);
    } catch (err) {
      // If initialization fails or times out, return 503 but don't crash
      logger.warn(`Request to ${req.path} failed - services not ready`, {
        service: config.serviceName,
        path: req.path,
        error: err instanceof Error ? err.message : String(err)
      });
      return res.status(503).json({
        success: false,
        message: 'Notification service is temporarily unavailable',
        error: initializationError?.message ?? 'Service initialization in progress',
      });
    }
  }

  return next();
});

app.use('/api/notifications', notificationRouter);
app.use('/api/device-tokens', deviceTokenRouter);

app.get('/', (_req, res) => {
  res.json({
    message: 'Notification Service Running ✅',
    endpoints: {
      health: '/health',
      notifications: '/api/notifications',
      deviceTokens: '/api/device-tokens',
      sms: '/api/notifications/sms',
    },
  });
});

app.use(globalErrorHandler);

export default app;

