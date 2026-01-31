import express from 'express';
import timeout from 'connect-timeout';
import { globalErrorHandler, createHealthCheckEndpoints, getRedisClient } from '@kodingcaravan/shared';
import { requestLogger } from './middlewares/requestLogger';
import { getPool } from './config/database';
import authRoutes from './routes/auth.routes';
import safetyRoutes from './routes/safety.routes';
import sessionRoutes from './routes/session.routes';
import allocationRoutes from './routes/allocation.routes';
import rescheduleRoutes from './routes/reschedule.routes';
import locationTrackingRoutes from './routes/locationTracking.routes';
import trainerApprovalRoutes from './routes/trainerApproval.routes';
import pincodeRoutes from './routes/pincode.routes';
import { createSubstitutionRoutes } from './routes/substitution.routes';
import { createEventsRoutes } from './routes/events.routes';
import reviewRoutes from './routes/review.routes';
import callRoutes from './routes/call.routes';
import demandTrackingRoutes from './routes/demandTracking.routes';
import journeyRoutes from './routes/journey.routes';

const app: express.Application = express();

app.use(express.json({ limit: '10mb' })); // Increase limit for image uploads
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request timeout middleware (30 seconds)
app.use(timeout('30s'));

// Timeout handler - must be after timeout middleware
app.use((req, res, next) => {
  if (!req.timedout) next();
});

// Request logging middleware (production)
app.use(requestLogger);

// Health check endpoints with dependency checks
const { healthHandler, readyHandler } = createHealthCheckEndpoints({
	serviceName: 'admin-service',
	postgresPool: getPool(),
	redisClient: getRedisClient(),
});

app.get('/health', healthHandler);
app.get('/ready', readyHandler);

app.use('/api/v1/admin/auth', authRoutes);
app.use('/api/v1/admin/safety', safetyRoutes);
app.use('/api/v1/admin', sessionRoutes);
app.use('/api/v1/admin/allocations', allocationRoutes);
app.use('/api/v1/admin/reschedule', rescheduleRoutes);
app.use('/api/v1/admin/location-tracking', locationTrackingRoutes);
app.use('/api/v1/admin/trainers/approvals', trainerApprovalRoutes);
app.use('/api/v1/admin', pincodeRoutes);
app.use('/api/v1/admin/substitutions', createSubstitutionRoutes());
app.use('/api/v1/events', createEventsRoutes());
app.use('/api/v1', reviewRoutes);
app.use('/api/v1/admin/calls', callRoutes);
app.use('/api/v1/admin/demand', demandTrackingRoutes);
app.use('/api/v1/admin', journeyRoutes);

app.use(globalErrorHandler);

export default app;