import "@kodingcaravan/shared/config";
import express from 'express';
import { globalErrorHandler, getServicePortSync } from "@kodingcaravan/shared";
import logger, { logServiceStart } from "@kodingcaravan/shared/config/logger";
import app from './app';

const PORT = getServicePortSync('Chat Service', 'CHAT_SERVICE_PORT', 3008);

const server = app.listen(PORT, () => {
    logServiceStart('Chat Service', PORT);
});

server.on('error', (err: NodeJS.ErrnoException) => {
	if (err.code === 'EADDRINUSE') {
		logger.error(`Port ${PORT} is already in use`, { 
			service: 'chat-service',
			port: PORT,
			error: err.message,
			code: err.code
		});
		process.exit(1);
	} else {
		logger.error('Server error', { 
			service: 'chat-service',
			error: err.message,
			code: err.code
		});
		process.exit(1);
	}
});

// Graceful shutdown handler
const gracefulShutdown = (signal: string) => {
	logger.info(`Received ${signal}, starting graceful shutdown`, { service: 'chat-service' });
	
	// Stop accepting new connections
	server.close(() => {
		logger.info('HTTP server closed', { service: 'chat-service' });
		process.exit(0);
	});
	
	// Force shutdown after 30 seconds
	setTimeout(() => {
		logger.error('Forced shutdown after timeout', { service: 'chat-service' });
		process.exit(1);
	}, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
