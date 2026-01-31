import express from 'express';
import timeout from 'connect-timeout';
import type { Express } from 'express';
import { globalErrorHandler, createHealthCheckEndpoints } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';
import { initMongo, getMongo } from './config/mongo';
import { ChatService } from './services/chat.service';
import { ChatController } from './controllers/chat.controller';
import { createChatRoutes } from './routes/chat.routes';
import { DoubtService } from './services/doubt.service';
import { DoubtController } from './controllers/doubt.controller';
import { createDoubtRoutes } from './routes/doubt.routes';

const app: Express = express();

app.use(express.json({ limit: '10mb' })); // Increased for file uploads
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
      serviceName: 'chat-service',
      mongoConnection: mongo.connection,
    });
  }
  return healthCheckHandlers;
}

// Health check (liveness probe)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'chat-service',
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
      service: 'chat-service',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
  }
});

// Readiness probe
let routesInitialized = false;

async function initializeRoutes() {
  if (routesInitialized) {
    return;
  }

  await initMongo();

  // Chat routes (legacy - can be deprecated)
  const chatService = new ChatService();
  const chatController = new ChatController(chatService);
  app.use('/api/chat', createChatRoutes(chatController));

  // Doubt clarification system routes
  const doubtService = new DoubtService();
  const doubtController = new DoubtController(doubtService);
  app.use('/api', createDoubtRoutes(doubtController));

  routesInitialized = true;
  logger.info('Chat Service routes initialized', { service: 'chat-service' });
}

app.use(async (req, res, next) => {
  if (!routesInitialized && req.path !== '/' && req.path !== '/health') {
    try {
      await initializeRoutes();
    } catch (error) {
      // eslint-disable-next-line no-console
      logger.error('Failed to initialize Chat Service', { 
        service: 'chat-service',
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        success: false,
        message: 'Chat Service initialization failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  next();
});

app.get('/', (_req, res) => {
  res.json({
    message: 'Chat Service & Doubt Clarification System Running ✅',
    endpoints: {
      chat: {
        sendMessage: '/api/chat/messages',
        conversations: '/api/chat/conversations',
      },
      doubts: {
        createDoubt: 'POST /api/doubts',
        listDoubts: 'GET /api/doubts',
        getDoubt: 'GET /api/doubts/:doubtId',
        createReply: 'POST /api/doubts/:doubtId/reply',
        updateStatus: 'PATCH /api/doubts/:doubtId/status',
        trainerDoubts: 'GET /api/trainer/doubts',
        adminDoubts: 'GET /api/admin/doubts',
        reassign: 'POST /api/doubts/:doubtId/reassign',
      },
      health: '/health',
    },
  });
});

app.use(globalErrorHandler);

// Eager initialization - attempt to initialize routes on startup (non-blocking)
void initializeRoutes().catch((error) => {
  // eslint-disable-next-line no-console
  logger.error('Chat Service eager initialization failed', { 
    service: 'chat-service',
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  // Error already logged above with logger.error
});

export default app;
