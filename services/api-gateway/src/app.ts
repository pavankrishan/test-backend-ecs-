/**
 * API Gateway Application
 * Central entry point for all API requests
 */

import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import timeout from 'connect-timeout';
import logger from '@kodingcaravan/shared/config/logger';
import { correlationIdMiddleware } from '@kodingcaravan/shared';
import { registerServiceProxies } from './proxy';
import { optionalAuthMiddleware, validateAuthMiddleware } from './middlewares/authMiddleware';
// import { errorHandler } from '@kodingcaravan/shared';
import { roleBasedRateLimiter, authRateLimiter } from '@kodingcaravan/shared/middlewares/rateLimiter';
// import { createOpenApiValidator, openApiErrorHandler } from '@kodingcaravan/shared/middlewares/openApiValidator';
// import path from 'path';

const app: Express = express();

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS configuration
const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    // Allow requests with no origin (like mobile apps, Postman, curl)
    if (!origin) {
      return callback(null, true);
    }
    
    const allowedOrigins = process.env.CORS_ORIGIN 
      ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
      : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'];
    
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS: Blocked origin`, { 
        service: 'api-gateway',
        origin,
        allowedOrigins
      });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'ngrok-skip-browser-warning', 'User-Agent'],
  exposedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));

// Explicitly handle OPTIONS requests for CORS preflight
app.options('*', cors(corsOptions));

// Correlation ID middleware - must be early in the middleware chain
app.use(correlationIdMiddleware);

// PHASE 5: Request timeout middleware (30 seconds for API Gateway)
app.use(timeout('30s'));

// PHASE 5: Timeout handler - must be after timeout middleware
app.use((req, res, next) => {
  if (req.timedout) {
    logger.warn('Request timeout', {
      url: req.url,
      method: req.method,
      service: 'api-gateway',
    });
    if (!res.headersSent) {
      res.status(504).json({
        success: false,
        message: 'Request timeout',
        code: 'REQUEST_TIMEOUT',
      });
    }
    return;
  }
  next();
});

// Body parsing
// NOTE: We intentionally do not attach body parsers here because this gateway only proxies requests.
// Parsing the body would consume the request stream and prevent http-proxy-middleware from forwarding it.

// PHASE 5: Rate limiting (enabled for production)
// Uses Redis backend for distributed rate limiting across multiple instances

// Auth endpoints (stricter limits)
app.use('/api/v1/students/auth', authRateLimiter);
app.use('/api/v1/trainers/auth', authRateLimiter);
app.use('/api/v1/admin/auth', authRateLimiter);

// Role-based rate limiting (applied after auth middleware extracts user role)
app.use(roleBasedRateLimiter);

// OpenAPI validation (disabled temporarily to avoid middleware issues during dev)
// try {
//   const openApiSpecPath = path.join(__dirname, '../openapi.yaml');
//   app.use(createOpenApiValidator({
//     apiSpec: openApiSpecPath,
//     validateRequests: true,
//     validateResponses: false,
//     validateSecurity: true,
//   }));
// } catch (error) {
//   logger.warn('OpenAPI spec not found, skipping validation');
// }

// Health check (liveness)
app.get('/health', (req, res) => {
  // Get WebSocket connection count if available
  const wsConnectionCount = (global as any).wsConnectionCount || 0;
  
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'api-gateway',
    wsConnections: wsConnectionCount,
  });
});

// Readiness probe (api-gateway is always ready once started)
app.get('/ready', (_req, res) => {
  res.status(200).json({
    status: 'ready',
    service: 'api-gateway',
    timestamp: new Date().toISOString(),
  });
});

// Handle preflight OPTIONS requests explicitly
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  const allowedOrigins = process.env.CORS_ORIGIN 
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
    : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'];
  
  if (origin && (allowedOrigins.includes('*') || allowedOrigins.includes(origin))) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.header('Access-Control-Max-Age', '86400'); // 24 hours
  }
  res.sendStatus(204);
});

// CRITICAL FIX: Validate auth tokens BEFORE proxying to downstream services
// This prevents invalid/expired tokens from causing retry storms on downstream services
// The middleware blocks invalid tokens with a clean 401 response
app.use(validateAuthMiddleware);

// Optional authentication middleware - extracts user info for logging/analytics
// This runs after validateAuthMiddleware, so only valid tokens reach here
app.use(optionalAuthMiddleware);

registerServiceProxies(app);

// Error handling (disabled for now)
// app.use(openApiErrorHandler);
// app.use(errorHandler);

export default app;

