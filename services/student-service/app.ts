import express from 'express';
import timeout from 'connect-timeout';
import { globalErrorHandler, getEventBus, correlationIdMiddleware, createHealthCheckEndpoints } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';
import type { Express } from 'express';
import { initDatabases, getPostgresPool, getRedis } from './config/database';
import { ensureStudentProfileTable, StudentProfileRepository } from './models/studentProfile.model';
import { ensureStudentProgressTable, StudentProgressRepository } from './models/studentProgress.model';
import { ensureProjectSubmissionTable, ProjectSubmissionRepository } from './models/projectSubmission.model';
import { ensureRescheduleTable, RescheduleRepository } from './models/reschedule.model';
import { ensureSupportTicketTable, SupportTicketRepository } from './models/supportTicket.model';
import { StudentService } from './services/student.service';
import { AggregationService } from './services/aggregation.service';
import { RescheduleService } from './services/reschedule.service';
import { StudentController } from './controllers/student.controller';
import { RequestRescheduleController } from './controllers/requestReschedule.controller';
import { createStudentRoutes } from './routes/student.routes';
import { createRescheduleRoutes } from './routes/reschedule.routes';

const app: Express = express();

// Correlation ID middleware - must be early in the chain
app.use(correlationIdMiddleware);

// Request timeout middleware (60 seconds for aggregation endpoints)
app.use(timeout('60s'));

// Timeout handler - must be after timeout middleware
app.use((req, res, next) => {
  if (!req.timedout) next();
});

app.use((req, _res, next) => {
  // TODO: replace with actual authentication middleware
  (req as any).user = (req as any).user ?? {
    id: 'student-service-system',
    roles: ['system'],
  };
  next();
});

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Health check endpoints (will be initialized after databases are ready)
let healthCheckHandlers: { healthHandler: any; readyHandler: any } | null = null;

async function setupHealthChecks() {
  if (!healthCheckHandlers) {
    await initDatabases();
    const pool = getPostgresPool();
    const redis = getRedis();
    
    healthCheckHandlers = createHealthCheckEndpoints({
      serviceName: 'student-service',
      postgresPool: pool,
      redisClient: redis,
    });
  }
  return healthCheckHandlers;
}

// Health check endpoints
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'student-service',
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
      service: 'student-service',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
  }
});

// Readiness probe
let servicesInitialized = false;

async function initializeServices() {
  if (servicesInitialized) {
    return;
  }

  await initDatabases();
  const pool = getPostgresPool();

  await ensureStudentProfileTable(pool);
  await ensureStudentProgressTable(pool);
  await ensureProjectSubmissionTable(pool);
  await ensureRescheduleTable(pool);
  await ensureSupportTicketTable(pool);

  const profileRepo = new StudentProfileRepository(pool);
  const progressRepo = new StudentProgressRepository(pool);
  const projectRepo = new ProjectSubmissionRepository(pool);
  const rescheduleRepo = new RescheduleRepository(pool);
  const supportTicketRepo = new SupportTicketRepository(pool);

  const studentService = new StudentService(profileRepo, progressRepo, projectRepo, supportTicketRepo, pool);
  const aggregationService = new AggregationService(studentService, pool);
  const rescheduleService = new RescheduleService(rescheduleRepo, pool);

  const studentController = new StudentController(studentService, aggregationService);
  const rescheduleController = new RequestRescheduleController(rescheduleService);

  app.use('/api/students', createStudentRoutes(studentController));
  app.use('/api/reschedules', createRescheduleRoutes(rescheduleController));

  // Setup event listeners for cache invalidation
  setupEventListeners(aggregationService);

  servicesInitialized = true;
}

/**
 * Setup event listeners for automatic cache invalidation
 */
function setupEventListeners(aggregationService: AggregationService): void {
  try {
    const eventBus = getEventBus();
    
    // Subscribe to SESSION_COMPLETED events to invalidate cache
    eventBus.subscribe(
      async (event: any) => {
        if (event.type === 'SESSION_COMPLETED') {
          const sessionEvent = event as any;
          const studentId = sessionEvent.studentId;
          
          if (studentId) {
            try {
              logger.debug('SESSION_COMPLETED event received, invalidating cache', { 
                service: 'student-service',
                studentId
              });
              await aggregationService.invalidateAllCaches(studentId);
              logger.debug('Cache invalidated', { 
                service: 'student-service',
                studentId
              });
            } catch (error: any) {
              logger.error('Failed to invalidate cache', { 
                service: 'student-service',
                studentId,
                error: error.message
              });
            }
          }
        }
      },
      (event: any) => event.type === 'SESSION_COMPLETED'
    );

    // Subscribe to PURCHASE_CREATED so Learnings screen gets fresh data (class format, schedule)
    eventBus.subscribe(
      async (event: any) => {
        if (event.type === 'PURCHASE_CREATED') {
          const studentId = (event as any).studentId;
          if (studentId) {
            try {
              logger.debug('PURCHASE_CREATED event received, invalidating learning cache', {
                service: 'student-service',
                studentId,
              });
              await aggregationService.invalidateLearningCache(studentId, 'purchase_created');
              logger.debug('Learning cache invalidated', { service: 'student-service', studentId });
            } catch (error: any) {
              logger.error('Failed to invalidate learning cache after purchase', {
                service: 'student-service',
                studentId,
                error: error.message,
              });
            }
          }
        }
      },
      (event: any) => event.type === 'PURCHASE_CREATED'
    );
    
    logger.info('Event listeners initialized for cache invalidation', { service: 'student-service' });
  } catch (error: any) {
    logger.warn('Failed to setup event listeners (non-critical)', { 
      service: 'student-service',
      error: error.message
    });
    logger.warn('Cache will still be invalidated by complete-session.js script', { service: 'student-service' });
  }
}

app.use(async (req, res, next) => {
  if (!servicesInitialized && req.path !== '/health' && req.path !== '/') {
    try {
      await initializeServices();
    } catch (error) {
      logger.error('Failed to initialize Student Service', { 
        service: 'student-service',
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        success: false,
        message: 'Student Service initialization failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  next();
});

app.get('/', (_req, res) => {
  res.json({
    message: 'Student Service Running ✅',
    endpoints: {
      students: '/api/students',
      reschedules: '/api/reschedules',
      health: '/health',
    },
  });
});

app.use(globalErrorHandler);

void initializeServices().catch((error) => {
  logger.error('Student Service eager initialization failed', { 
    service: 'student-service',
    error: error instanceof Error ? error.message : String(error)
  });
});

export default app;
