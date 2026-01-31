import '@kodingcaravan/shared/config';
import { getServicePortSync } from '@kodingcaravan/shared';
import { logServiceStart } from '@kodingcaravan/shared/config/logger';
import logger from '@kodingcaravan/shared/config/logger';
import app from './app';
import { initializePaymentTables } from './config/database';

let server: ReturnType<typeof app.listen> | null = null;

async function start() {
	try {
		await initializePaymentTables();

		const PORT = getServicePortSync('Payment Service', 'PAYMENT_SERVICE_PORT', 3007);

		server = app.listen(PORT, () => {
			logServiceStart('Payment Service', PORT);
		});

		server.on('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'EADDRINUSE') {
				logger.error(`Port ${PORT} is already in use`, { 
					service: 'payment-service',
					port: PORT,
					error: err.message,
					code: err.code
				});
				process.exit(1);
			} else {
				logger.error('Server error', { 
					service: 'payment-service',
					error: err.message,
					code: err.code
				});
				process.exit(1);
			}
		});

		// Graceful shutdown handler
		const gracefulShutdown = (signal: string) => {
			logger.info(`Received ${signal}, starting graceful shutdown`, { service: 'payment-service' });
			
			if (server) {
				server.close(() => {
					logger.info('HTTP server closed', { service: 'payment-service' });
					process.exit(0);
				});
			} else {
				process.exit(0);
			}
			
			// Force shutdown after 30 seconds
			setTimeout(() => {
				logger.error('Forced shutdown after timeout', { service: 'payment-service' });
				process.exit(1);
			}, 30000);
		};

		process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
		process.on('SIGINT', () => gracefulShutdown('SIGINT'));
	} catch (error) {
		logger.error('Failed to start Payment Service', { 
			service: 'payment-service',
			error: error instanceof Error ? error.message : String(error)
		});
		process.exit(1);
	}
}

start();
