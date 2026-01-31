import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';

interface AuthenticatedSocket extends Socket {
	userId?: string;
	userRole?: 'student' | 'trainer' | 'admin';
	trainerId?: string;
	studentId?: string;
}

/**
 * Socket Server for Chat Only
 * 
 * NOTE: Location tracking has been removed and moved to HTTP + Redis.
 * This server is now only used for chat functionality (if needed).
 * All location tracking is handled via HTTP endpoints with Redis storage.
 */
class SocketServer {
	private io: SocketIOServer;

	constructor(httpServer: HTTPServer) {
		this.io = new SocketIOServer(httpServer, {
			cors: {
				origin: '*',
				methods: ['GET', 'POST'],
				credentials: true,
			},
			transports: ['websocket', 'polling'],
		});

		this.setupMiddleware();
		this.setupEventHandlers();
	}

	private setupMiddleware() {
		// Authentication middleware
		this.io.use(async (socket: AuthenticatedSocket, next) => {
			try {
				const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
				const userId = socket.handshake.auth.userId;
				const userRole = socket.handshake.auth.userRole;

				if (!token || !userId || !userRole) {
					return next(new Error('Authentication required'));
				}

				// TODO: Verify JWT token here
				// For now, we'll trust the auth data from handshake
				socket.userId = userId;
				socket.userRole = userRole as 'student' | 'trainer' | 'admin';

				if (userRole === 'trainer') {
					socket.trainerId = userId;
				} else if (userRole === 'student') {
					socket.studentId = userId;
				}

				next();
			} catch (error) {
				next(new Error('Authentication failed'));
			}
		});
	}

	private setupEventHandlers() {
		this.io.on('connection', (socket: AuthenticatedSocket) => {
			// NOTE: Location tracking has been removed - use HTTP endpoints instead
			// This socket server is kept for potential future chat functionality
			// All location tracking is now handled via:
			// - POST /api/v1/admin/sessions/{sessionId}/start-journey
			// - POST /api/v1/admin/location-tracking/journey/updates
			// - GET /api/v1/admin/location-tracking/journey/live

			socket.on('disconnect', () => {
				// Cleanup if needed (no location tracking state to clean)
			});
		});
	}

	public getIO(): SocketIOServer {
		return this.io;
	}
}

let socketServerInstance: SocketServer | null = null;

export function initializeSocketServer(httpServer: HTTPServer): SocketServer {
	if (!socketServerInstance) {
		socketServerInstance = new SocketServer(httpServer);
	}
	return socketServerInstance;
}

export function getSocketServer(): SocketServer | null {
	return socketServerInstance;
}

