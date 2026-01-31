/**
 * WebSocket Event Server
 * 
 * Handles real-time event delivery to frontend clients via WebSocket.
 */

import { Server as SocketIOServer } from 'socket.io';
import type { Socket } from 'socket.io';
import type { BusinessEvent } from '@kodingcaravan/shared/events/types';
import { getEventBus, getRedisClient } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';
import { redisSetexWithTimeout, redisDelWithTimeout } from '@kodingcaravan/shared/utils/redisWithTimeout';

// PHASE 4 FIX: Redis Pub/Sub subscriber for cross-instance message routing
let redisSubscriber: any = null;

// Import auth middleware
async function verifyToken(token: string): Promise<{ id: string; role: string } | null> {
  try {
    // Import JWT verification utility
    const { verifyAccessToken } = await import('@kodingcaravan/shared/utils/tokenManager');
    const decoded = verifyAccessToken<any>(token);
    
    // Log decoded token structure for debugging
    logger.debug('Decoded token fields', {
      fields: Object.keys(decoded),
      service: 'api-gateway',
    });
    
    // Try multiple possible field names for user ID
    const userId = decoded.userId || decoded.id || decoded.trainerId || decoded.studentId || decoded.sub;
    
    if (!userId) {
      logger.error('No user ID found in token', {
        availableFields: Object.keys(decoded),
        service: 'api-gateway',
      });
      return null;
    }
    
    // Determine role - try multiple sources
    const role = decoded.role || 
                 (decoded.trainerId ? 'trainer' : 
                  decoded.studentId ? 'student' : 
                  decoded.type === 'trainer' ? 'trainer' :
                  decoded.type === 'student' ? 'student' :
                  'student'); // Default to student if unclear
    
    return {
      id: userId,
      role: role,
    };
  } catch (error) {
    logger.error('Token verification failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      service: 'api-gateway',
    });
    return null;
  }
}

/**
 * Check if event should be sent to user
 */
function shouldReceiveEvent(
  event: BusinessEvent,
  userId: string,
  role: string
): boolean {
  // Trainer receives events about their allocations/sessions
  if (role === 'trainer') {
    return (
      (event.type === 'TRAINER_ALLOCATED' && 
       (event as any).trainerId === userId) ||
      (event.type === 'SESSION_SUBSTITUTED' && 
       ((event as any).originalTrainerId === userId ||
        (event as any).substituteTrainerId === userId)) ||
      (event.type === 'PAYROLL_RECALCULATED' && 
       (event as any).trainerId === userId) ||
      (event.type === 'SESSION_COMPLETED' && 
       (event as any).trainerId === userId)
    );
  }
  
  // Student receives events about their courses/sessions
  if (role === 'student') {
    return (
      (event.type === 'PURCHASE_CONFIRMED' && 
       (event as any).studentId === userId) ||
      (event.type === 'PURCHASE_CREATED' && 
       (event as any).studentId === userId) ||
      (event.type === 'COURSE_ACCESS_GRANTED' && 
       (event as any).studentId === userId) ||
      (event.type === 'COURSE_PURCHASED' && 
       (event as any).studentId === userId) ||
      (event.type === 'TRAINER_ALLOCATED' && 
       (event as any).studentId === userId) ||
      (event.type === 'SESSIONS_GENERATED' && 
       (event as any).studentId === userId) ||
      (event.type === 'SESSION_RESCHEDULED' && 
       (event as any).studentId === userId) ||
      (event.type === 'SESSION_COMPLETED' && 
       (event as any).studentId === userId) ||
      (event.type === 'COURSE_PROGRESS_UPDATED' && 
       (event as any).studentId === userId) ||
      (event.type === 'SESSION_SUBSTITUTED' && 
       (event as any).studentId === userId) ||
      (event.type === 'COURSE_COMPLETED' && 
       (event as any).studentId === userId)
    );
  }
  
  // Admin receives all events
  if (role === 'admin') {
    return true;
  }
  
  return false;
}

/**
 * Setup WebSocket event server
 */
export function setupEventWebSocket(io: SocketIOServer): void {
  // Get event bus early to ensure it's initialized
  const eventBus = getEventBus();
  logger.info('Event bus initialized', {
    eventBusType: eventBus.constructor.name,
    service: 'api-gateway',
  });
  
  // Connection limits (configurable via env)
  const MAX_CONNECTIONS_PER_INSTANCE = parseInt(
    process.env.WS_MAX_CONNECTIONS_PER_INSTANCE || '1000',
    10
  );
  const activeConnections = new Map<string, Socket>();
  const redis = getRedisClient();
  
  // PHASE 4 FIX: Instance ID for horizontal scaling
  const INSTANCE_ID = process.env.INSTANCE_ID || process.env.HOSTNAME || `gateway-${Date.now()}`;
  
  // Store connection count globally for health check
  (global as any).wsConnectionCount = 0;
  
  // If using Redis, ensure connection is established
  if (eventBus.constructor.name === 'RedisEventBus') {
    try {
      logger.debug('Redis status check', {
        status: redis.status,
        service: 'api-gateway',
      });
      
      // Try to connect if not ready
      if (redis.status !== 'ready' && redis.status !== 'connecting') {
        redis.connect().catch((err: Error) => {
          logger.error('Redis connection failed', {
            error: err.message,
            service: 'api-gateway',
          });
        });
      }
    } catch (error) {
      logger.error('Failed to check Redis connection', {
        error: error instanceof Error ? error.message : String(error),
        service: 'api-gateway',
      });
    }
  }
  
  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        logger.warn('Connection rejected: No token provided', {
          service: 'api-gateway',
        });
        return next(new Error('Authentication token required'));
      }
      
      logger.debug('Verifying token for connection', {
        service: 'api-gateway',
      });
      const user = await verifyToken(token);
      if (!user) {
        logger.warn('Connection rejected: Token verification failed', {
          service: 'api-gateway',
        });
        return next(new Error('Authentication failed'));
      }
      
      logger.info('Token verified for user', {
        userId: user.id,
        role: user.role,
        service: 'api-gateway',
      });
      socket.data.user = user;
      next();
    } catch (error: any) {
      logger.error('WebSocket authentication error', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        service: 'api-gateway',
      });
      next(new Error('Authentication failed'));
    }
  });
  
  io.on('connection', async (socket) => {
    // Enforce per-instance connection limit
    if (activeConnections.size >= MAX_CONNECTIONS_PER_INSTANCE) {
      logger.warn('WebSocket connection limit reached, rejecting new connection', {
        currentConnections: activeConnections.size,
        maxConnections: MAX_CONNECTIONS_PER_INSTANCE,
        service: 'api-gateway',
      });
      socket.disconnect(true);
      return;
    }

    const userId = socket.data.user?.id;
    const role = socket.data.user?.role;
    
    if (!userId || !role) {
      logger.error('WebSocket connection rejected: Invalid user data', {
        userData: socket.data.user,
        service: 'api-gateway',
      });
      socket.disconnect(true);
      return;
    }
    
    // Track connection
    activeConnections.set(socket.id, socket);
    (global as any).wsConnectionCount = activeConnections.size;
    
    logger.info('WebSocket user connected', {
      userId,
      role,
      socketId: socket.id,
      totalConnections: activeConnections.size,
      service: 'api-gateway',
    });
    
    // PHASE 4 FIX: Store in Redis with instance ID for horizontal scaling
    try {
      const connectionKey = `${INSTANCE_ID}:${socket.id}`;
      await redisSetexWithTimeout(`ws:connection:${socket.id}`, 3600, userId); // 1 hour TTL
      // Add socket to user's connection set with instance ID prefix
      await redis.sadd(`ws:user:${userId}`, connectionKey).catch(() => {
        // Fail silently - Redis operation is non-critical
      });
      // Set TTL on the set key (1 hour) - ensures sets don't accumulate
      await redis.expire(`ws:user:${userId}`, 3600).catch(() => {
        // Fail silently
      });
      
      logger.debug('WebSocket connection stored in Redis', {
        userId,
        socketId: socket.id,
        instanceId: INSTANCE_ID,
        connectionKey,
        service: 'api-gateway',
      });
    } catch (error) {
      logger.warn('Failed to store WebSocket connection in Redis (non-critical)', {
        userId,
        socketId: socket.id,
        error: error instanceof Error ? error.message : String(error),
        service: 'api-gateway',
      });
      // Continue - connection tracking in Redis is optional
    }
    
    // Journey live tracking: student subscribes by journeyId only (trainer never subscribes)
    if (role === 'student') {
      socket.on('subscribe:journey', async (payload: { journeyId?: string }) => {
        const journeyId = payload?.journeyId;
        if (!journeyId || typeof journeyId !== 'string') {
          socket.emit('subscribe:journey:error', { message: 'journeyId required' });
          return;
        }
        try {
          const raw = await redis.get(`live:journey:${journeyId}`);
          if (!raw) {
            socket.emit('subscribe:journey:error', { message: 'Journey not active or expired' });
            return;
          }
          const data = JSON.parse(raw) as { studentId: string };
          if (data.studentId !== userId) {
            socket.emit('subscribe:journey:error', { message: 'Access denied to this journey' });
            return;
          }
          socket.join(`journey:${journeyId}`);
          socket.emit('subscribe:journey:ok', { journeyId });
        } catch (err) {
          logger.warn('subscribe:journey failed', { userId, journeyId, error: (err as Error).message, service: 'api-gateway' });
          socket.emit('subscribe:journey:error', { message: 'Subscription failed' });
        }
      });
      socket.on('unsubscribe:journey', (payload: { journeyId?: string }) => {
        const journeyId = payload?.journeyId;
        if (journeyId) socket.leave(`journey:${journeyId}`);
      });
    }

    // PHASE 4 FIX: No longer subscribe via eventBus (in-memory only)
    // Events will be routed via Redis Pub/Sub subscriber (see below)
    
    socket.on('disconnect', async () => {
      activeConnections.delete(socket.id);
      (global as any).wsConnectionCount = activeConnections.size;
      
      // PHASE 4 FIX: Clean up Redis tracking with instance ID
      try {
        const connectionKey = `${INSTANCE_ID}:${socket.id}`;
        await redisDelWithTimeout(`ws:connection:${socket.id}`);
        await redis.srem(`ws:user:${userId}`, connectionKey).catch(() => {
          // Fail silently
        });
      } catch (error) {
        logger.warn('Failed to clean up WebSocket connection in Redis (non-critical)', {
          userId,
          socketId: socket.id,
          error: error instanceof Error ? error.message : String(error),
          service: 'api-gateway',
        });
      }
      
      logger.info('WebSocket user disconnected', {
        userId,
        role,
        socketId: socket.id,
        instanceId: INSTANCE_ID,
        totalConnections: activeConnections.size,
        service: 'api-gateway',
      });
    });
    
    socket.on('error', (error) => {
      logger.error('WebSocket error', {
        userId,
        role,
        socketId: socket.id,
        error: error instanceof Error ? error.message : String(error),
        service: 'api-gateway',
      });
    });
  });
  
  // PHASE 4 FIX: Setup Redis Pub/Sub subscriber for cross-instance message routing
  setupRedisPubSubSubscriber(io, activeConnections, INSTANCE_ID, redis);
  
  // Log connection limit on startup
  logger.info('WebSocket server configured', {
    maxConnectionsPerInstance: MAX_CONNECTIONS_PER_INSTANCE,
    instanceId: INSTANCE_ID,
    service: 'api-gateway',
  });
}

/**
 * PHASE 4 FIX: Get Redis Pub/Sub subscriber (for graceful shutdown)
 */
export function getRedisSubscriber(): any {
  return redisSubscriber;
}

/**
 * PHASE 4 FIX: Setup Redis Pub/Sub subscriber for horizontal scaling
 * 
 * This subscriber listens to 'business-events' channel and routes events
 * to WebSocket connections across all gateway instances.
 */
function setupRedisPubSubSubscriber(
  io: SocketIOServer,
  activeConnections: Map<string, Socket>,
  instanceId: string,
  redis: any
): void {
  try {
    // Create a dedicated Redis connection for Pub/Sub (required by Redis)
    redisSubscriber = redis.duplicate();
    
    // Subscribe to business-events and journey channels
    Promise.all([
      redisSubscriber.subscribe('business-events'),
      redisSubscriber.subscribe('journey:updates'),
      redisSubscriber.subscribe('journey:ended'),
    ]).then(() => {
      logger.info('Redis Pub/Sub subscriber connected for WebSocket routing', {
        instanceId,
        channels: ['business-events', 'journey:updates', 'journey:ended'],
        service: 'api-gateway',
      });
    }).catch((error: Error) => {
      logger.error('Failed to subscribe to Redis Pub/Sub channels', {
        error: error.message,
        instanceId,
        service: 'api-gateway',
      });
    });
    
    // Handle incoming events from Redis Pub/Sub
    redisSubscriber.on('message', async (channel: string, message: string) => {
      try {
        if (channel === 'journey:updates') {
          const payload = JSON.parse(message) as { journeyId: string; location: any; sequence: number; timestamp: string };
          io.to(`journey:${payload.journeyId}`).emit('journey:location', payload);
          return;
        }
        if (channel === 'journey:ended') {
          const payload = JSON.parse(message) as { journeyId: string; endedAt: string };
          io.to(`journey:${payload.journeyId}`).emit('journey:ended', payload);
          return;
        }
        const event = JSON.parse(message) as BusinessEvent;
        
        // Determine which users should receive this event
        const targetUserIds = getTargetUserIds(event);
        
        if (targetUserIds.length === 0) {
          return; // No users to notify
        }
        
        // Route event to all target users
        for (const userId of targetUserIds) {
          await routeEventToUser(event, userId, activeConnections, instanceId, redis);
        }
      } catch (error) {
        logger.error('Failed to process event from Redis Pub/Sub', {
          error: error instanceof Error ? error.message : String(error),
          channel,
          service: 'api-gateway',
        });
      }
    });
    
    // Handle connection errors
    redisSubscriber.on('error', (error: Error) => {
      logger.error('Redis Pub/Sub subscriber error', {
        error: error.message,
        instanceId,
        service: 'api-gateway',
      });
    });
    
  } catch (error) {
    logger.error('Failed to setup Redis Pub/Sub subscriber', {
      error: error instanceof Error ? error.message : String(error),
      instanceId,
      service: 'api-gateway',
    });
    // Continue without Pub/Sub - connections will still work locally
  }
}

/**
 * PHASE 4 FIX: Determine which users should receive an event
 * 
 * Extracts all user IDs from an event that should receive WebSocket notifications.
 * Uses the same logic as shouldReceiveEvent() to determine recipients.
 */
function getTargetUserIds(event: BusinessEvent): string[] {
  const userIds: string[] = [];
  
  // Extract user IDs from event based on event structure
  // Most events have userId, studentId, or trainerId fields
  const eventAny = event as any;
  
  // Primary user ID (present in all events)
  if (eventAny.userId) {
    userIds.push(eventAny.userId);
  }
  
  // Student-specific events
  if (eventAny.studentId && eventAny.studentId !== eventAny.userId) {
    userIds.push(eventAny.studentId);
  }
  
  // Trainer-specific events
  if (eventAny.trainerId && eventAny.trainerId !== eventAny.userId) {
    userIds.push(eventAny.trainerId);
  }
  
  // Special cases for events with multiple user IDs
  if (event.type === 'SESSION_SUBSTITUTED') {
    if (eventAny.originalTrainerId) userIds.push(eventAny.originalTrainerId);
    if (eventAny.substituteTrainerId) userIds.push(eventAny.substituteTrainerId);
  }
  
  // Remove duplicates and empty values
  return [...new Set(userIds.filter(id => id && typeof id === 'string'))];
}

/**
 * PHASE 4 FIX: Route event to a specific user's WebSocket connections
 * 
 * This function:
 * 1. Finds all connections for the user (across all instances) in Redis
 * 2. Filters to only connections on THIS instance
 * 3. Emits the event to those local connections
 */
async function routeEventToUser(
  event: BusinessEvent,
  userId: string,
  activeConnections: Map<string, Socket>,
  instanceId: string,
  redis: any
): Promise<void> {
  try {
    // Get all connection keys for this user from Redis
    const connectionKeys = await redis.smembers(`ws:user:${userId}`).catch(() => {
      return [];
    });
    
    if (connectionKeys.length === 0) {
      return; // No connections for this user
    }
    
    // Filter to only connections on THIS instance
    const localConnectionKeys = connectionKeys.filter((key: string) => 
      key.startsWith(`${instanceId}:`)
    );
    
    if (localConnectionKeys.length === 0) {
      return; // No connections on this instance
    }
    
    // Extract socket IDs from connection keys
    // Format: `${instanceId}:${socketId}`
    // Note: socket.id from Socket.IO is typically a simple string without colons
    const socketIds = localConnectionKeys.map((key: string) => {
      const firstColonIndex = key.indexOf(':');
      if (firstColonIndex === -1) {
        return null; // Invalid format
      }
      // Extract everything after the first colon (socket ID)
      return key.substring(firstColonIndex + 1);
    }).filter((id: string | null): id is string => id !== null && id.length > 0);
    
    // Get user role from first connection (all connections for same user have same role)
    let userRole: string | undefined;
    
    // Emit event to all local connections for this user
    let emittedCount = 0;
    for (const socketId of socketIds) {
      const socket = activeConnections.get(socketId);
      if (socket) {
        // Get role from socket data
        if (!userRole) {
          userRole = socket.data.user?.role;
        }
        
        // Check if this connection should receive this event
        const shouldReceive = shouldReceiveEvent(event, userId, userRole || 'student');
        if (shouldReceive) {
          socket.emit('business-event', event);
          emittedCount++;
        }
      }
    }
    
    if (emittedCount > 0) {
      logger.debug('Event routed to user connections', {
        userId,
        eventType: event.type,
        localConnections: emittedCount,
        totalConnections: connectionKeys.length,
        instanceId,
        service: 'api-gateway',
      });
    }
  } catch (error) {
    logger.error('Failed to route event to user', {
      error: error instanceof Error ? error.message : String(error),
      userId,
      eventType: event.type,
      instanceId,
      service: 'api-gateway',
    });
  }
}

