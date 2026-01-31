import express from 'express';
import timeout from 'connect-timeout';
import cookieParser from 'cookie-parser';
import { globalErrorHandler, createHealthCheckEndpoints, getRedisClient } from '@kodingcaravan/shared';
import trainerAuthRoutes from './routes/trainerAuth.routes';
import otpRoutes from './routes/otp.routes';
import { getPool } from './config/database';

const app: express.Application = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Request timeout middleware (30 seconds)
app.use(timeout('30s'));

// Timeout handler - must be after timeout middleware
app.use((req, res, next) => {
  if (!req.timedout) next();
});

// Health check endpoints with dependency checks
const { healthHandler, readyHandler } = createHealthCheckEndpoints({
	serviceName: 'trainer-auth-service',
	postgresPool: getPool(),
	redisClient: getRedisClient(),
});

app.get('/health', healthHandler);
app.get('/ready', readyHandler);

app.use('/api/v1/otp', otpRoutes);
app.use('/api/v1/trainers/auth', trainerAuthRoutes);

app.use(globalErrorHandler);

export default app;
