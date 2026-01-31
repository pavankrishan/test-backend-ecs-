/**
 * Booking Service Entry Point
 */

import "@kodingcaravan/shared/config";
import { getServicePortSync } from '@kodingcaravan/shared';
import logger, { logServiceStart } from '@kodingcaravan/shared/config/logger';
import app from './app';
import { initializeDatabase } from './config/database';

const PORT = getServicePortSync('Booking Service', 'BOOKING_SERVICE_PORT', 3011);

let server: ReturnType<typeof app.listen> | null = null;

async function start() {
	try {
		// Initialize database
		await initializeDatabase();

		// Start server
		server = app.listen(PORT, () => {
			logServiceStart('Booking Service', PORT);
		});

		server.on('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'EADDRINUSE') {
				logger.error(`Port ${PORT} is already in use`, { 
					service: 'booking-service',
					port: PORT,
					error: err.message,
					code: err.code
				});
				process.exit(1);
			} else {
				logger.error('Server error', { 
					service: 'booking-service',
					error: err.message,
					code: err.code
				});
				process.exit(1);
			}
		});

		// Graceful shutdown handler
		const gracefulShutdown = (signal: string) => {
			logger.info(`Received ${signal}, starting graceful shutdown`, { service: 'booking-service' });
			
			if (server) {
				server.close(() => {
					logger.info('HTTP server closed', { service: 'booking-service' });
					process.exit(0);
				});
			} else {
				process.exit(0);
			}
			
			// Force shutdown after 30 seconds
			setTimeout(() => {
				logger.error('Forced shutdown after timeout', { service: 'booking-service' });
				process.exit(1);
			}, 30000);
		};

		process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
		process.on('SIGINT', () => gracefulShutdown('SIGINT'));
	} catch (error) {
		logger.error('Failed to start booking service', { 
			service: 'booking-service',
			error: error instanceof Error ? error.message : String(error)
		});
		process.exit(1);
	}
}

// Handle uncaught exceptions gracefully (don't crash the service)
process.on('uncaughtException', (error: Error) => {
	logger.error('Uncaught exception', { 
		service: 'booking-service',
		error: error.message,
		stack: error.stack
	});
});

process.on('unhandledRejection', (reason: any) => {
	logger.warn('Unhandled rejection', { 
		service: 'booking-service',
		reason: reason instanceof Error ? reason.message : String(reason)
	});
});

start();

