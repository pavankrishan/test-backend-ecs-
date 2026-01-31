import "@kodingcaravan/shared/config";
import express from 'express';
import { globalErrorHandler, getServicePortSync } from "@kodingcaravan/shared";
import logger, { logServiceStart } from "@kodingcaravan/shared/config/logger";
import app from './app';
import { closeDatabases } from './config/database';

const PORT = getServicePortSync('Student Service', 'STUDENT_SERVICE_PORT', 3003);

const server = app.listen(PORT, () => {
    logServiceStart('Student Service', PORT);
});

server.on('error', (err: NodeJS.ErrnoException) => {
	if (err.code === 'EADDRINUSE') {
		logger.error(`Port ${PORT} is already in use`, { 
			service: 'student-service',
			port: PORT,
			error: err.message,
			code: err.code
		});
		process.exit(1);
	} else {
		logger.error('Server error', { 
			service: 'student-service',
			error: err.message,
			code: err.code
		});
		process.exit(1);
	}
});

// Graceful shutdown handler
const gracefulShutdown = async (signal: string) => {
	logger.info(`Received ${signal}, starting graceful shutdown`, { service: 'student-service' });
	
	// Stop accepting new connections
	server.close(async () => {
		logger.info('HTTP server closed', { service: 'student-service' });
		// Close database connections
		try {
			await closeDatabases();
			logger.info('Database connections closed', { service: 'student-service' });
		} catch (error) {
			logger.error('Error closing databases', { 
				service: 'student-service',
				error: error instanceof Error ? error.message : String(error)
			});
		}
		process.exit(0);
	});
	
	// Force shutdown after 30 seconds
	setTimeout(() => {
		logger.error('Forced shutdown after timeout', { service: 'student-service' });
		process.exit(1);
	}, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions gracefully (don't crash the service)
process.on('uncaughtException', (error: Error) => {
	logger.error('Uncaught exception', { 
		service: 'student-service',
		error: error.message,
		stack: error.stack
	});
});

process.on('unhandledRejection', (reason: any) => {
	logger.warn('Unhandled rejection', { 
		service: 'student-service',
		reason: reason instanceof Error ? reason.message : String(reason)
	});
});

