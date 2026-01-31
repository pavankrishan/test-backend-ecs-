// Load environment variables first
import "@kodingcaravan/shared/config";
import app from './app';
import logger, { logServiceStart } from '@kodingcaravan/shared/config/logger';
import { getServicePortSync } from '@kodingcaravan/shared';
import { setupEventWebSocket, getRedisSubscriber } from './websocket/eventServer';
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

const port = getServicePortSync('API Gateway', 'API_GATEWAY_PORT', 3000);

app.get("/", (req, res) => {
	res.send("🚀 API Gateway is running successfully! This is the root endpoint set by pavankrishna.");
});

const server = app.listen(port, '0.0.0.0', () => {
	logServiceStart('API Gateway', port);
});

// Setup WebSocket server for real-time events
try {
	const httpServer = server as unknown as HttpServer;
	const io = new SocketIOServer(httpServer, {
		cors: {
			origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173', 'http://localhost:3000'],
			credentials: true,
			methods: ['GET', 'POST'],
		},
		path: '/socket.io',
	});
	
	setupEventWebSocket(io);
	logger.info('WebSocket server initialized', { service: 'api-gateway' });
} catch (error) {
	logger.error('Failed to initialize WebSocket server', { 
		service: 'api-gateway',
		error: error instanceof Error ? error.message : String(error)
	});
	// Don't exit - WebSocket is optional, polling fallback will be used
}

// Increase max listeners to accommodate multiple proxy middleware instances
// Each proxy middleware adds a 'close' listener to the server
// With multiple services and routes, we can easily exceed the default limit of 10
server.setMaxListeners(20);

server.on('error', (err: NodeJS.ErrnoException) => {
	if (err.code === 'EADDRINUSE') {
		logger.error(`Port ${port} is already in use`, { 
			service: 'api-gateway',
			port,
			error: err.message,
			code: err.code
		});
		process.exit(1);
	} else {
		logger.error('Server error', { 
			service: 'api-gateway',
			error: err.message,
			code: err.code
		});
		process.exit(1);
	}
});

// Graceful shutdown handler
const gracefulShutdown = async (signal: string) => {
	logger.info(`Received ${signal}, starting graceful shutdown`, { service: 'api-gateway' });
	
	// PHASE 4 FIX: Close Redis Pub/Sub subscriber
	try {
		const subscriber = getRedisSubscriber();
		if (subscriber) {
			await subscriber.quit();
			logger.info('Redis Pub/Sub subscriber closed', { service: 'api-gateway' });
		}
	} catch (error) {
		logger.warn('Failed to close Redis Pub/Sub subscriber', {
			error: error instanceof Error ? error.message : String(error),
			service: 'api-gateway',
		});
	}
	
	// Stop accepting new connections
	server.close(() => {
		logger.info('HTTP server closed', { service: 'api-gateway' });
		process.exit(0);
	});
	
	// Force shutdown after 30 seconds
	setTimeout(() => {
		logger.error('Forced shutdown after timeout', { service: 'api-gateway' });
		process.exit(1);
	}, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

