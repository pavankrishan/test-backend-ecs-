import '@kodingcaravan/shared/config';
import { getServicePortSync } from '@kodingcaravan/shared';
import logger, { logServiceStart } from '@kodingcaravan/shared/config/logger';
import app from './app';
import { initializeTrainerAuthTables } from './config/database';
import { scheduleRefreshTokenCleanup } from './jobs/refreshTokenCleanup';

let server: ReturnType<typeof app.listen> | null = null;

async function start() {
	try {
		await initializeTrainerAuthTables();
		scheduleRefreshTokenCleanup();

		const PORT = getServicePortSync(
			'Trainer Auth Service',
			'TRAINER_AUTH_SERVICE_PORT',
			3002
		);

		server = app.listen(PORT, () => logServiceStart('Trainer Auth Service', PORT));

		server.on('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'EADDRINUSE') {
				logger.error(`Port ${PORT} is already in use`, { 
					service: 'trainer-auth-service',
					port: PORT,
					error: err.message,
					code: err.code
				});
				process.exit(1);
			} else {
				logger.error('Server error', { 
					service: 'trainer-auth-service',
					error: err.message,
					code: err.code
				});
				process.exit(1);
			}
		});

		// Graceful shutdown handler
		const gracefulShutdown = (signal: string) => {
			logger.info(`Received ${signal}, starting graceful shutdown`, { service: 'trainer-auth-service' });
			
			if (server) {
				server.close(() => {
					logger.info('HTTP server closed', { service: 'trainer-auth-service' });
					process.exit(0);
				});
			} else {
				process.exit(0);
			}
			
			// Force shutdown after 30 seconds
			setTimeout(() => {
				logger.error('Forced shutdown after timeout', { service: 'trainer-auth-service' });
				process.exit(1);
			}, 30000);
		};

		process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
		process.on('SIGINT', () => gracefulShutdown('SIGINT'));
	} catch (error) {
		logger.error('Failed to start Trainer Auth Service', { 
			service: 'trainer-auth-service',
			error: error instanceof Error ? error.message : String(error)
		});
		process.exit(1);
	}
}

start();