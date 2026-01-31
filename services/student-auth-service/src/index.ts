import '@kodingcaravan/shared/config';
import { getServicePortSync } from '@kodingcaravan/shared';
import { logServiceStart } from '@kodingcaravan/shared/config/logger';
import logger from '@kodingcaravan/shared/config/logger';
import app from './app';
import { initializeStudentAuthTables } from './config/database';
import { scheduleUnverifiedStudentCleanup } from './jobs/unverifiedCleanup';
import { scheduleRefreshTokenCleanup } from './jobs/refreshTokenCleanup';

let server: ReturnType<typeof app.listen> | null = null;

async function start() {
	try {
		const PORT = getServicePortSync(
			'Student Auth Service',
			'STUDENT_AUTH_SERVICE_PORT',
			3001
		);

		// Start server first - don't block on database initialization
		server = app.listen(PORT, () => {
			logServiceStart('Student Auth Service', PORT);
			
			// Initialize database in background (non-blocking)
			// This allows the service to start even if DB init is slow or fails
			setImmediate(async () => {
				try {
					await initializeStudentAuthTables();
					scheduleUnverifiedStudentCleanup();
					scheduleRefreshTokenCleanup();
				} catch (error: any) {
					logger.warn('Database initialization failed (service will continue)', { 
						service: 'student-auth-service',
						error: error?.message || String(error)
					});
					// Don't throw - service should continue running
				}
			});
		});

		server.on('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'EADDRINUSE') {
				logger.error(`Port ${PORT} is already in use`, { 
					service: 'student-auth-service',
					port: PORT,
					error: err.message,
					code: err.code
				});
				process.exit(1);
			} else {
				logger.error('Server error', { 
					service: 'student-auth-service',
					error: err.message,
					code: err.code
				});
				process.exit(1);
			}
		});

		// Graceful shutdown handler
		const gracefulShutdown = (signal: string) => {
			logger.info(`Received ${signal}, starting graceful shutdown`, { service: 'student-auth-service' });
			
			if (server) {
				server.close(() => {
					logger.info('HTTP server closed', { service: 'student-auth-service' });
					process.exit(0);
				});
			} else {
				process.exit(0);
			}
			
			// Force shutdown after 30 seconds
			setTimeout(() => {
				logger.error('Forced shutdown after timeout', { service: 'student-auth-service' });
				process.exit(1);
			}, 30000);
		};

		process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
		process.on('SIGINT', () => gracefulShutdown('SIGINT'));
	} catch (error) {
		logger.error('Failed to start Student Auth Service', { 
			service: 'student-auth-service',
			error: error instanceof Error ? error.message : String(error)
		});
		process.exit(1);
	}
}

// Handle uncaught exceptions gracefully (don't crash the service)
process.on('uncaughtException', (error: Error) => {
	logger.error('Uncaught exception', { 
		service: 'student-auth-service',
		error: error.message,
		stack: error.stack
	});
});

process.on('unhandledRejection', (reason: any) => {
	logger.warn('Unhandled rejection', { 
		service: 'student-auth-service',
		reason: reason instanceof Error ? reason.message : String(reason)
	});
});

start();
