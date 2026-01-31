import express from 'express';
import timeout from 'connect-timeout';
import { Pool } from 'pg';
import { globalErrorHandler, correlationIdMiddleware, createHealthCheckEndpoints } from '@kodingcaravan/shared';
import { getPool } from './config/database';
import { getRedisClient } from '@kodingcaravan/shared/databases/redis/connection';
import paymentRoutes from './routes/payment.routes';
import { PaymentController } from './controllers/payment.controller';

const app = express();

// Correlation ID middleware - must be early in the chain
app.use(correlationIdMiddleware);

// Request timeout middleware (30 seconds)
app.use(timeout('30s'));

// Timeout handler - must be after timeout middleware
app.use((req, res, next) => {
  if (!req.timedout) next();
});

// Webhook route needs raw body for signature verification
// Must be registered before JSON middleware
app.post(
	'/api/v1/payments/webhook/razorpay',
	express.raw({ type: 'application/json' }),
	(req: express.Request, res: express.Response, next: express.NextFunction) => {
		// Parse JSON from raw body
		try {
			(req as any).body = JSON.parse((req.body as Buffer).toString());
			next();
		} catch (error) {
			next(error);
		}
	},
	PaymentController.handleRazorpayWebhook
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoints with dependency checks
const { healthHandler, readyHandler } = createHealthCheckEndpoints({
	serviceName: 'payment-service',
	postgresPool: getPool() as unknown as Pool,
	redisClient: getRedisClient(),
});

app.get('/health', healthHandler);
app.get('/ready', readyHandler);

app.get('/', (req, res) => {
	res.json({ message: 'Payment Service Running ✅' });
});

app.use('/api/v1/payments', paymentRoutes);

app.use(globalErrorHandler);

export default app;

