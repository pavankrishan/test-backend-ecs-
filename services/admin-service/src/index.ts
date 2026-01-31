import '@kodingcaravan/shared/config';
import { getServicePortSync } from '@kodingcaravan/shared';
import logger, { logServiceStart } from '@kodingcaravan/shared/config/logger';
import { createServer } from 'http';
import app from './app';
import { initializeAdminAuth } from './config/database';
import { initializeSocketServer } from './socket/socketServer';

async function start(): Promise<void> {
	try {
		const PORT = getServicePortSync('Admin Service', 'ADMIN_SERVICE_PORT', 3010);
		const httpServer = createServer(app);
		
		// Initialize Socket.io server with error handling
		try {
			initializeSocketServer(httpServer);
		} catch (socketError: any) {
			logger.warn('Socket.io initialization failed (service will continue)', { 
				service: 'admin-service',
				error: socketError?.message || String(socketError)
			});
		}

		// Start server first - this is critical
		httpServer.listen(PORT, '0.0.0.0', () => {
			logServiceStart('Admin Service', PORT);
			
			// Initialize database in background (non-blocking)
			// This allows the service to start even if DB init is slow or fails
			setImmediate(() => {
				initializeAdminAuth()
					.catch((error: any) => {
						logger.warn('Database initialization failed (service will continue)', { 
							service: 'admin-service',
							error: error?.message || String(error)
						});
						// Don't throw - service should continue running
					});
			});
		});

		httpServer.on('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'EADDRINUSE') {
				logger.error(`Port ${PORT} is already in use`, { 
					service: 'admin-service',
					port: PORT,
					error: err.message,
					code: err.code
				});
				process.exit(1);
			} else {
				logger.error('Server error', { 
					service: 'admin-service',
					error: err.message,
					code: err.code
				});
				process.exit(1);
			}
		});

		// Handle uncaught errors gracefully
		process.on('uncaughtException', (error: Error) => {
			logger.error('Uncaught exception', { 
				service: 'admin-service',
				error: error.message,
				stack: error.stack
			});
		});

		process.on('unhandledRejection', (reason: any) => {
			logger.warn('Unhandled rejection', { 
				service: 'admin-service',
				reason: reason instanceof Error ? reason.message : String(reason)
			});
		});

		// Graceful shutdown handler
		const gracefulShutdown = (signal: string) => {
			logger.info(`Received ${signal}, starting graceful shutdown`, { service: 'admin-service' });
			
			// Stop accepting new connections
			httpServer.close(() => {
				logger.info('HTTP server closed', { service: 'admin-service' });
				process.exit(0);
			});
			
			// Force shutdown after 30 seconds
			setTimeout(() => {
				logger.error('Forced shutdown after timeout', { service: 'admin-service' });
				process.exit(1);
			}, 30000);
		};

		process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
		process.on('SIGINT', () => gracefulShutdown('SIGINT'));

	} catch (error: any) {
		logger.error('Failed to start Admin Service', { 
			service: 'admin-service',
			error: error instanceof Error ? error.message : String(error),
			stack: error?.stack
		});
		process.exit(1);
	}
}

start();
