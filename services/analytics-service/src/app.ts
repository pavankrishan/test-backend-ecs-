import express from 'express';
import timeout from 'connect-timeout';
import type { Express } from 'express';
import { globalErrorHandler, createHealthCheckEndpoints } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';
import { initMongo, getMongo } from './config/mongo';
import { AnalyticsService } from './services/analytics.service';
import { AnalyticsController } from './controllers/analytics.controller';
import { createAnalyticsRoutes } from './routes/analytics.routes';

const app: Express = express();

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Request timeout middleware (30 seconds)
app.use(timeout('30s'));

// Timeout handler - must be after timeout middleware
app.use((req, res, next) => {
  if (!req.timedout) next();
});

// Health check endpoints (will be initialized after MongoDB is ready)
let healthCheckHandlers: { healthHandler: any; readyHandler: any } | null = null;

async function setupHealthChecks() {
  if (!healthCheckHandlers) {
    await initializeRoutes();
    const mongo = getMongo();
    
    healthCheckHandlers = createHealthCheckEndpoints({
      serviceName: 'analytics-service',
      mongoConnection: mongo.connection,
    });
  }
  return healthCheckHandlers;
}

// Health check (liveness probe)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'analytics-service',
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
      service: 'analytics-service',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
  }
});

// Readiness probe
let routesInitialized = false;

async function initializeRoutes(): Promise<void> {
  if (routesInitialized) {
    return;
  }

  await initMongo();

  const analyticsService = new AnalyticsService();
  const analyticsController = new AnalyticsController(analyticsService);

  app.use('/api/analytics', createAnalyticsRoutes(analyticsController));

  routesInitialized = true;
  // eslint-disable-next-line no-console
  logger.info('Analytics Service routes initialized', { service: 'analytics-service' });
}

app.use(async (req, res, next) => {
  if (!routesInitialized && req.path !== '/' && req.path !== '/health') {
    try {
      await initializeRoutes();
    } catch (error) {
      // eslint-disable-next-line no-console
      logger.error('Failed to initialize Analytics Service', { 
        service: 'analytics-service',
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        success: false,
        message: 'Analytics Service initialization failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  next();
});

app.get('/', (_req, res) => {
  res.json({
    message: 'Analytics Service Running ✅',
    endpoints: {
      recordEvent: '/api/analytics/events',
      metrics: '/api/analytics/metrics/event-types',
      trends: '/api/analytics/metrics/trends',
      health: '/health',
    },
  });
});

app.use(globalErrorHandler);

void initializeRoutes().catch((error) => {
  // eslint-disable-next-line no-console
  logger.error('Analytics Service eager initialization failed', { 
    service: 'analytics-service',
    error: error instanceof Error ? error.message : String(error)
  });
});

export default app;
