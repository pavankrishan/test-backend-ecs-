import express from 'express';
import timeout from 'connect-timeout';
import cookieParser from 'cookie-parser';
import { globalErrorHandler, correlationIdMiddleware, createHealthCheckEndpoints, getRedisClient } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';
import { getPool } from './config/database';
import otpRoutes from './routes/otp.routes';
import studentAuthRoutes from './routes/studentAuth.routes';

const app: express.Application = express();

// Correlation ID middleware - must be early in the chain
app.use(correlationIdMiddleware);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Request timeout middleware (30 seconds)
app.use(timeout('30s'));

// Timeout handler - must be after timeout middleware
app.use((req, res, next) => {
  if (!req.timedout) next();
});

// Request logging middleware
app.use((req, res, next) => {
	logger.http(`${req.method} ${req.path}`, {
		service: 'student-auth-service',
		method: req.method,
		path: req.path,
		body: req.body,
		query: req.query,
		headers: {
			'content-type': req.headers['content-type'],
			'user-agent': req.headers['user-agent'],
		},
	});
	next();
});

// Health check endpoints with dependency checks
const { healthHandler, readyHandler } = createHealthCheckEndpoints({
	serviceName: 'student-auth-service',
	postgresPool: getPool(),
	redisClient: getRedisClient(),
});

app.get('/health', healthHandler);
app.get('/ready', readyHandler);

app.use('/api/v1/otp', otpRoutes);
app.use('/api/v1/students/auth', studentAuthRoutes);

// attach global error handler (from shared)
app.use(globalErrorHandler);

export default app;