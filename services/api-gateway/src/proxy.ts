import type { Express, Request } from 'express';
import { createProxyMiddleware, Options as ProxyOptions } from 'http-proxy-middleware';
import logger from '@kodingcaravan/shared/config/logger';

type ServiceProxyDefinition = {
  name: string;
  routes: string[];
  portEnv: string;
  defaultPort: number;
  urlEnv?: string;
  proxyOptions?: ProxyOptions & {
    pathFilter?: (pathname: string) => boolean;
  };
};

const serviceProxyDefinitions: ServiceProxyDefinition[] = [
  {
    name: 'api-gateway',
    routes: [],
    portEnv: 'API_GATEWAY_PORT',
    defaultPort: 3000,
  },
  {
    name: 'student-auth-service',
    routes: ['/api/v1/students/auth'],
    portEnv: 'STUDENT_AUTH_SERVICE_PORT',
    defaultPort: 3001,
  },
  {
    name: 'trainer-auth-service',
    routes: ['/api/v1/trainers/auth'],
    portEnv: 'TRAINER_AUTH_SERVICE_PORT',
    defaultPort: 3002,
  },
  {
    name: 'course-service-structure',
    routes: [
      '/api/v1/courses',
      '/api/v1/phases',
      '/api/v1/levels',
      '/api/v1/sessions',
      '/api/v1/progress',
      '/api/v1/projects',
      '/api/v1/purchases',
    ],
    portEnv: 'COURSE_SERVICE_PORT',
    defaultPort: 3005,
  },
  {
    name: 'student-service',
    routes: ['/api/v1/students'],
    portEnv: 'STUDENT_SERVICE_PORT',
    defaultPort: 3003,
    proxyOptions: {
      pathFilter: (pathname: string) => {
        // Exclude course-structure endpoints - they go to course-service
        // Also exclude auth endpoints - they go to student-auth-service
        const courseStructurePattern = /^\/api\/v1\/students\/[^/]+\/courses\/[^/]+\/(purchase|progress|access)/;
        const authPattern = /^\/api\/v1\/students\/auth/;
        return !courseStructurePattern.test(pathname) && !authPattern.test(pathname);
      },
      pathRewrite: {
        '^/api/v1/students': '/api/students',
      },
    },
  },
  {
    name: 'trainer-service',
    routes: ['/api/v1/trainers'],
    portEnv: 'TRAINER_SERVICE_PORT',
    defaultPort: 3004,
    proxyOptions: {
      pathFilter: (pathname: string) => {
        // Exclude auth endpoints - they go to trainer-auth-service
        const authPattern = /^\/api\/v1\/trainers\/auth/;
        return !authPattern.test(pathname);
      },
      pathRewrite: {
        '^/api/v1/trainers': '/api/trainers',
      },
    },
  },
  {
    name: 'course-service',
    routes: ['/api/courses', '/api/videos', '/api/assignments'],
    portEnv: 'COURSE_SERVICE_PORT',
    defaultPort: 3005,
  },
  {
    name: 'notification-service',
    routes: ['/api/notifications', '/api/v1/notifications', '/api/device-tokens', '/api/v1/device-tokens'],
    portEnv: 'NOTIFICATION_SERVICE_PORT',
    defaultPort: 3006,
    proxyOptions: {
      pathRewrite: {
        '^/api/v1/notifications': '/api/notifications',
        '^/api/v1/device-tokens': '/api/device-tokens',
      },
    },
  },
  {
    name: 'payment-service',
    routes: ['/api/v1/payments'],
    portEnv: 'PAYMENT_SERVICE_PORT',
    defaultPort: 3007,
  },
  {
    name: 'chat-service',
    routes: ['/api/v1/chat', '/api/v1/doubts', '/api/v1/trainer/doubts', '/api/v1/admin/doubts'],
    portEnv: 'CHAT_SERVICE_PORT',
    defaultPort: 3008,
    proxyOptions: {
      pathRewrite: {
        '^/api/v1/chat': '/api/chat',
        '^/api/v1/doubts': '/api/doubts',
        '^/api/v1/trainer/doubts': '/api/trainer/doubts',
        '^/api/v1/admin/doubts': '/api/admin/doubts',
      },
    },
  },
  {
    name: 'analytics-service',
    routes: ['/api/v1/analytics'],
    portEnv: 'ANALYTICS_SERVICE_PORT',
    defaultPort: 3009,
    proxyOptions: {
      pathRewrite: {
        '^/api/v1/analytics': '/api/analytics',
      },
    },
  },
  {
    name: 'admin-service',
    routes: ['/api/v1/admin'],
    portEnv: 'ADMIN_SERVICE_PORT',
    defaultPort: 3010,
  },
  {
    name: 'booking-service',
    routes: ['/api/v1/booking'],
    portEnv: 'BOOKING_SERVICE_PORT',
    defaultPort: 3011,
  },
];

/**
 * Forward correlation ID from request to proxied request
 */
function forwardCorrelationId(proxyReq: any, req: Request): void {
	const correlationId = (req as any).correlationId;
	if (correlationId) {
		proxyReq.setHeader('X-Correlation-ID', correlationId);
		proxyReq.setHeader('Correlation-Id', correlationId);
	}
}

const defaultProxyOptions: Pick<ProxyOptions, 'changeOrigin' | 'logLevel' | 'onError' | 'proxyTimeout'> = {
  changeOrigin: true,
  logLevel: process.env.NODE_ENV === 'development' ? 'debug' : 'warn',
  proxyTimeout: 55000, // 55 seconds - below ALB 60s default, with buffer for slow aggregation queries
  onError(err, req, res) {
    const errorMessage = err.message || 'Unknown error';
    const isDnsError = errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo');
    const isConnectionRefused = errorMessage.includes('ECONNREFUSED') || errorMessage.includes('connect ECONNREFUSED');
    
    // Check if we're in Docker but trying to connect to localhost (common misconfiguration)
    let isDocker = 
      process.env.DOCKER === 'true' || 
      process.env.IN_DOCKER === 'true' ||
      process.env.DOCKER_CONTAINER === 'true';
    
    // Check for /.dockerenv file (Docker indicator) - only on Linux
    if (!isDocker && process.platform === 'linux') {
      try {
        const fs = require('fs');
        isDocker = fs.existsSync('/.dockerenv');
      } catch {
        // Ignore errors - not critical
      }
    }
    
    const target = (req as any).proxyTarget || 'unknown';
    const isLocalhostTarget = target.includes('localhost') || target.includes('127.0.0.1') || target.includes('::1');
    
    // Log detailed error in development
    if (process.env.NODE_ENV === 'development') {
      let hint: string | undefined;
      if (isDnsError) {
        hint = 'Service hostname not resolved. Check if service is running and SERVICES_HOST/DOCKER env vars are set correctly.';
      } else if (isConnectionRefused && isDocker && isLocalhostTarget) {
        hint = 'Connection refused to localhost from Docker container. In Docker, use service names (e.g., student-auth-service:3001) or set SERVICES_HOST.';
      } else if (isConnectionRefused) {
        hint = 'Connection refused. Check if the service is running and accessible.';
      }
      
      logger.error('Proxy error', {
        url: req.url,
        error: errorMessage,
        isDnsError,
        isConnectionRefused,
        target,
        isDocker,
        hint,
        correlationId: (req as any).correlationId,
        service: 'api-gateway',
      });
    }
    
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    res.end(
      JSON.stringify({
        success: false,
        message: 'Upstream service unavailable',
        code: 'SERVICE_UNAVAILABLE',
        error: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      }),
    );
  },
};

function toEnvKey(def: ServiceProxyDefinition): string | undefined {
  if (def.urlEnv) {
    return def.urlEnv;
  }

  const candidate = def.name.replace(/-/g, '_').toUpperCase();
  const envKey = `${candidate}_URL`;
  return envKey;
}

function resolveTarget(def: ServiceProxyDefinition): string {
  const explicitUrlEnv = toEnvKey(def);
  if (explicitUrlEnv && process.env[explicitUrlEnv]) {
    return process.env[explicitUrlEnv] as string;
  }

  const portValue = process.env[def.portEnv];
  const port = Number(portValue) || def.defaultPort;
  
  // Check if we're in Docker by looking for multiple indicators
  const servicesHost = process.env.SERVICES_HOST;
  let isDocker = 
    process.env.DOCKER === 'true' || 
    process.env.IN_DOCKER === 'true' ||
    process.env.DOCKER_CONTAINER === 'true';
  
  // Check for /.dockerenv file (Docker indicator) - only on Linux
  if (!isDocker && process.platform === 'linux') {
    try {
      const fs = require('fs');
      isDocker = fs.existsSync('/.dockerenv');
      if (isDocker && process.env.NODE_ENV === 'development') {
        logger.debug('Docker detected via /.dockerenv file', {
          service: 'api-gateway',
        });
      }
    } catch {
      // Ignore errors - not critical
    }
  }
  
  // Log Docker detection status for debugging (only once per service, at startup)
  if (process.env.NODE_ENV === 'development' && def.name === 'student-auth-service') {
    logger.debug('Docker detection', {
      serviceName: def.name,
      isDocker,
      DOCKER: process.env.DOCKER,
      IN_DOCKER: process.env.IN_DOCKER,
      DOCKER_CONTAINER: process.env.DOCKER_CONTAINER,
      platform: process.platform,
      servicesHost,
      service: 'api-gateway',
    });
  }
  
  // Priority 1: Explicit URL from environment variable
  // (already handled above)
  
  // Priority 2: Custom SERVICES_HOST provided
  if (servicesHost && servicesHost !== 'http://localhost' && servicesHost !== 'localhost') {
    const trimmedHost = servicesHost.endsWith('/') ? servicesHost.slice(0, -1) : servicesHost;
    return `${trimmedHost}:${port}`;
  }
  
  // Priority 3: Docker environment - use service names for inter-container communication
  if (isDocker) {
    // Map service definition names to Docker service names
    const dockerServiceName = def.name === 'course-service-structure' ? 'course-service' : def.name;
    const target = `http://${dockerServiceName}:${port}`;
    // Always log for debugging (startup info, not runtime spam)
    logger.info('Resolved service target (Docker mode)', {
      serviceName: def.name,
      target,
      isDocker,
      service: 'api-gateway',
    });
    return target;
  }
  
  // Priority 4: Local development (not Docker) - use localhost
  const target = `http://localhost:${port}`;
  // Log for debugging
  if (process.env.NODE_ENV === 'development') {
    logger.debug('Resolved service target (Local mode)', {
      serviceName: def.name,
      target,
      isDocker,
      service: 'api-gateway',
    });
  }
  return target;
}

export function registerServiceProxies(app: Express): void {
  // Register routes in order of specificity (most specific first)
  
  // 1. Auth Services - Most specific routes first (must be before general routes)
  const studentAuthDef = serviceProxyDefinitions.find(def => def.name === 'student-auth-service');
  if (studentAuthDef) {
    const target = resolveTarget(studentAuthDef);
    // Log target resolution for debugging (startup info only)
    if (process.env.NODE_ENV === 'development') {
      logger.info('Registering service proxy', {
        serviceName: studentAuthDef.name,
        target,
        routes: studentAuthDef.routes.join(', '),
        service: 'api-gateway',
      });
    }
    for (const route of studentAuthDef.routes) {
      app.use(route, createProxyMiddleware({
        ...defaultProxyOptions,
        target,
        onProxyReq(proxyReq, req) {
          // Store target in request for error handler
          (req as any).proxyTarget = target;
          // Forward correlation ID
          forwardCorrelationId(proxyReq, req);
        },
      }));
    }
  }

  // 2. Trainer Auth Service - Must be registered before trainer-service
  const trainerAuthDef = serviceProxyDefinitions.find(def => def.name === 'trainer-auth-service');
  if (trainerAuthDef) {
    const target = resolveTarget(trainerAuthDef);
    if (process.env.NODE_ENV === 'development') {
      logger.info('Registering service proxy', {
        serviceName: trainerAuthDef.name,
        target,
        routes: trainerAuthDef.routes.join(', '),
        service: 'api-gateway',
      });
    }
    for (const route of trainerAuthDef.routes) {
      app.use(route, createProxyMiddleware({
        ...defaultProxyOptions,
        target,
        onProxyReq(proxyReq, req) {
          // Store target in request for error handler
          (req as any).proxyTarget = target;
          // Forward correlation ID
          forwardCorrelationId(proxyReq, req);
        },
      }));
    }
  }

  // 3. Course Service - Student course-structure endpoints (specific pattern)
  // Use a custom middleware wrapper to ensure proper routing
  const servicesHost = process.env.SERVICES_HOST;
  const isDocker = process.env.DOCKER === 'true' || process.env.IN_DOCKER === 'true';
  const courseServicePort = process.env.COURSE_SERVICE_PORT || 3005;
  
  // For local development (not Docker), use localhost
  // For Docker, use service names
  let courseServiceTarget: string;
  if (!isDocker && (!servicesHost || servicesHost === 'http://localhost' || servicesHost === 'localhost')) {
    courseServiceTarget = `http://localhost:${courseServicePort}`;
  } else if (isDocker || (!servicesHost || servicesHost === 'http://localhost' || servicesHost === 'localhost')) {
    courseServiceTarget = `http://course-service:${courseServicePort}`;
  } else {
    const trimmedHost = servicesHost.endsWith('/') ? servicesHost.slice(0, -1) : servicesHost;
    courseServiceTarget = `${trimmedHost}:${courseServicePort}`;
  }
  
  if (process.env.NODE_ENV === 'development') {
    logger.info('Registering course-service-structure proxy', {
      target: courseServiceTarget,
      service: 'api-gateway',
    });
  }
  const courseStructureProxy = createProxyMiddleware({
    ...defaultProxyOptions,
    target: courseServiceTarget,
    onProxyReq(proxyReq, req) {
      // Store target in request for error handler
      (req as any).proxyTarget = courseServiceTarget;
      // Forward correlation ID
      forwardCorrelationId(proxyReq, req);
    },
    // No path rewrite needed – course-service exposes the same /api/v1/students/... path
  });

  app.use('/api/v1/students', (req, res, next) => {
    // Express strips the mount path from req.path, so use originalUrl to test
    const fullPath = req.originalUrl || req.baseUrl + req.path;
    const isCourseStructurePath = /^\/api\/v1\/students\/[^/]+\/courses\/[^/]+\/(purchase|progress|access)/.test(
      fullPath,
    );

    if (isCourseStructurePath) {
      return courseStructureProxy(req, res, next);
    }

    // Otherwise, continue to next middleware (student-service)
    next();
  });

  // 4. Register all other service proxies (including student-service and trainer-service with filters)
  for (const def of serviceProxyDefinitions) {
    // Skip auth services as we already registered them above
    if (def.name === 'student-auth-service' || def.name === 'trainer-auth-service' || !def.routes.length) {
      continue;
    }
    
    const target = resolveTarget(def);
    if (process.env.NODE_ENV === 'development') {
      logger.info('Registering service proxy', {
        serviceName: def.name,
        target,
        routes: def.routes.join(', '),
        service: 'api-gateway',
      });
    }
    
    for (const route of def.routes) {
      const { pathFilter, ...restProxyOptions } = def.proxyOptions || {};
      
      // Store original onProxyReq if it exists (before it gets overridden)
      const originalOnProxyReq = restProxyOptions.onProxyReq;
      
      const proxyOptions: ProxyOptions = {
        ...defaultProxyOptions,
        ...restProxyOptions,
        target,
        onProxyReq(proxyReq: any, req: any, res: any, options: any) {
          // Store target in request for error handler
          (req as any).proxyTarget = target;
          // Forward correlation ID
          forwardCorrelationId(proxyReq, req);
          // Call original onProxyReq if provided
          if (originalOnProxyReq) {
            if (originalOnProxyReq.length === 4) {
              originalOnProxyReq(proxyReq, req, res, options);
            } else {
              (originalOnProxyReq as any)(proxyReq, req);
            }
          }
        },
        // Add filter function if pathFilter is specified
        ...(pathFilter && {
          filter: (pathname: string) => pathFilter(pathname),
        }),
      };
      
      app.use(route, createProxyMiddleware(proxyOptions));
    }
  }
}


