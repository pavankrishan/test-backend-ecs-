/**
 * Course Service Application
 * Main Express app setup
 */

import express from 'express';
import timeout from 'connect-timeout';
// CORS is handled by API Gateway, but we can add it here if needed
// import cors from 'cors';
import { globalErrorHandler, createHealthCheckEndpoints, getRedisClient } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';
import { initDatabases, getMongoState, getPostgresPool, getMongoConnection } from './config/database';
import mongoose from './config/mongoose';
import { createCoursesTable } from './models/course.model';
import { createAssignmentsTables } from './models/assignment.model';
import { CourseRepository } from './models/course.model';
import { AssignmentRepository } from './models/assignment.model';
import { CourseContentRepository, createCourseContentTables } from './models/courseContent.model';
import { createCourseStructureTables, CourseStructureRepository } from './models/courseStructure.model';
import { CourseStructureService } from './services/courseStructure.service';
import { CourseStructureController } from './controllers/courseStructure.controller';
import { createCourseStructureRoutes } from './routes/courseStructure.routes';
import { UploadController } from './controllers/upload.controller';
import { createUploadRoutes } from './routes/upload.routes';
import { CourseService } from './services/course.service';
import { AssignmentService } from './services/assignment.service';
import { VideoService } from './services/video.service';
import { CourseController } from './controllers/course.controller';
import { VideoController } from './controllers/video.controller';
import { AssignmentController } from './controllers/assignment.controller';
import { createCourseRoutes } from './routes/course.routes';
import { createCourseContentRoutes } from './routes/courseContent.routes';
import { createVideoRoutes } from './routes/video.routes';
import { createAssignmentRoutes } from './routes/assignment.routes';
import { CourseContentService } from './services/courseContent.service';
import { CourseContentController } from './controllers/courseContent.controller';
import type { Express } from 'express';
import { attachUserContext } from './middleware/authContext';
import helmet from 'helmet';
import compression from 'compression';
import { loadServiceConfig } from '@kodingcaravan/shared';
// import { rateLimiter } from '@kodingcaravan/shared';

const app: Express = express();

// Middleware
// CORS is typically handled by API Gateway

// Security & performance middlewares
app.use(helmet());
app.use(compression());
// Rate limiting (disabled for now - rateLimiter not implemented in shared package)
// app.use(rateLimiter);

app.use(attachUserContext);

// Request timeout middleware (30 seconds)
app.use(timeout('30s'));

// Timeout handler - must be after timeout middleware
app.use((req, res, next) => {
  if (!req.timedout) next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoints (will be initialized after databases are ready)
let healthCheckHandlers: { healthHandler: any; readyHandler: any } | null = null;

async function setupHealthChecks() {
  if (!healthCheckHandlers) {
    await initDatabases();
    const pool = getPostgresPool();
    // Ensure MongoDB is connected, then use mongoose singleton for health check
    await getMongoConnection();
    
    healthCheckHandlers = createHealthCheckEndpoints({
      serviceName: 'course-service',
      postgresPool: pool,
      redisClient: getRedisClient(),
      mongoConnection: mongoose.connection, // Pass mongoose connection object
    });
  }
  return healthCheckHandlers;
}

// Health check (liveness probe)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'course-service',
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
      service: 'course-service',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
  }
});

// Readiness probe
let servicesInitialized = false;

// Initialize services (lazy initialization)

async function initializeServices() {
  if (servicesInitialized) return;

  try {
    // Load and validate configuration for this service
    loadServiceConfig('course-service', {
      requirePostgres: true,
      requireS3: true,
      requireRateLimit: false, // Disabled until rateLimiter is implemented
    });

    // Initialize databases
    await initDatabases();

    // Create tables
    const pool = getPostgresPool();
    await createCoursesTable(pool);
    await createAssignmentsTables(pool);
    await createCourseContentTables(pool);
    await createCourseStructureTables(pool);

    // Initialize repositories
    const courseRepo = new CourseRepository(pool);
    const assignmentRepo = new AssignmentRepository(pool);
    const courseContentRepo = new CourseContentRepository(pool);
    const courseStructureRepo = new CourseStructureRepository(pool);

    // Initialize services
    const courseService = new CourseService(courseRepo, assignmentRepo);
    const assignmentService = new AssignmentService(assignmentRepo);
    const videoService = new VideoService();
    const courseContentService = new CourseContentService(courseContentRepo, pool);
    const courseStructureService = new CourseStructureService(courseStructureRepo);

    // Initialize controllers
    const courseController = new CourseController(courseService);
    const videoController = new VideoController(videoService);
    const assignmentController = new AssignmentController(assignmentService);
    const courseContentController = new CourseContentController(courseContentService);
    const courseStructureController = new CourseStructureController(courseStructureService);
    const uploadController = new UploadController();

    // Setup routes
    app.use('/api/courses', createCourseContentRoutes(courseContentController));
    app.use('/api/courses', createCourseRoutes(courseController));
    app.use('/api/videos', createVideoRoutes(videoController));
    app.use('/api/assignments', createAssignmentRoutes(assignmentController));
    app.use('/api/v1', createCourseStructureRoutes(courseStructureController));
    app.use('/api/v1', createUploadRoutes(uploadController));

    servicesInitialized = true;
  } catch (error) {
    logger.error('Failed to initialize Course Service', { 
      service: 'course-service',
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

// Initialize on first request with retry logic
let initializationAttempts = 0;
let isInitializing = false; // Prevent concurrent initialization attempts
const MAX_INIT_ATTEMPTS = 3;
const INIT_RETRY_DELAY = 2000; // 2 seconds

app.use(async (req, res, next) => {
  if (!servicesInitialized && req.path !== '/health' && req.path !== '/') {
    // If already initializing, wait for it to complete
    if (isInitializing) {
      // Wait up to 30 seconds for initialization to complete
      let waitCount = 0;
      while (isInitializing && waitCount < 30) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        waitCount++;
        if (servicesInitialized) {
          return next(); // Initialization completed
        }
      }
      if (!servicesInitialized) {
        return res.status(503).json({
          success: false,
          message: 'Service initialization in progress',
          error: 'Please try again in a few moments',
        });
      }
      return next();
    }
    
    // Prevent multiple simultaneous initialization attempts
    if (initializationAttempts > 0 && initializationAttempts < MAX_INIT_ATTEMPTS) {
      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, INIT_RETRY_DELAY));
    }
    
    if (initializationAttempts < MAX_INIT_ATTEMPTS) {
      initializationAttempts++;
      isInitializing = true;
      try {
        await initializeServices();
        initializationAttempts = 0; // Reset on success
        isInitializing = false;
      } catch (error: any) {
        isInitializing = false; // Reset flag on error
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorCode = error?.code;
        
        // Handle PostgreSQL concurrency errors specifically
        // XX000 = internal_error (includes "tuple concurrently updated")
        const isConcurrencyError = errorCode === 'XX000' || 
                                   errorMessage.includes('tuple concurrently updated') ||
                                   errorMessage.includes('concurrent update');
        
        if (isConcurrencyError) {
          // For concurrency errors, wait longer before retry
          const concurrencyDelay = INIT_RETRY_DELAY * (initializationAttempts + 1);
          logger.warn(`Course Service initialization attempt ${initializationAttempts}/${MAX_INIT_ATTEMPTS} failed due to concurrency, waiting ${concurrencyDelay}ms before retry`, { 
            service: 'course-service',
            attempt: initializationAttempts,
            maxAttempts: MAX_INIT_ATTEMPTS,
            delay: concurrencyDelay
          });
          await new Promise(resolve => setTimeout(resolve, concurrencyDelay));
        }
        
        // If this was the last attempt, return error
        if (initializationAttempts >= MAX_INIT_ATTEMPTS) {
          logger.error(`Course Service initialization failed after ${MAX_INIT_ATTEMPTS} attempts`, { 
            service: 'course-service',
            attempts: MAX_INIT_ATTEMPTS,
            error: errorMessage
          });
          return res.status(503).json({
            success: false,
            message: 'Service initialization failed',
            error: errorMessage,
            retryAfter: INIT_RETRY_DELAY / 1000, // seconds
          });
        }
        
        // Otherwise, log and continue (will retry on next request)
        if (!isConcurrencyError) {
          logger.warn(`Course Service initialization attempt ${initializationAttempts}/${MAX_INIT_ATTEMPTS} failed, will retry`, { 
            service: 'course-service',
            attempt: initializationAttempts,
            maxAttempts: MAX_INIT_ATTEMPTS,
            error: errorMessage
          });
        }
        // Don't return error yet - allow retry on next request
      }
    } else {
      // Max attempts reached, return service unavailable
      isInitializing = false; // Reset flag
      return res.status(503).json({
        success: false,
        message: 'Service initialization failed',
        error: 'Database connection timeout. Please try again in a few moments.',
        retryAfter: INIT_RETRY_DELAY / 1000,
      });
    }
  }
  next();
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Course Service Running ✅',
    endpoints: {
      courses: '/api/courses',
      videos: '/api/videos',
      assignments: '/api/assignments',
      courseStructure: '/api/v1',
      health: '/health',
    },
  });
});

// Error handling
app.use(globalErrorHandler);

export default app;
