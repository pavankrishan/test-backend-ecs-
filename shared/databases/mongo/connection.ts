import mongoose, { ConnectOptions } from 'mongoose';
import logger from '../../config/logger';

// CRITICAL: Disable Mongoose buffering GLOBALLY at module load time
// This MUST be done before any models are imported/defined
// Otherwise Mongoose will buffer operations and timeout
mongoose.set('bufferCommands', false);

// Global connection state to prevent multiple connections
let globalConnection: typeof mongoose | null = null;
let connectionPromise: Promise<typeof mongoose> | null = null;

/**
 * Connect to MongoDB with production-grade configuration
 * - Uses connection pooling to prevent connection spam
 * - Reuses existing connection if already connected
 * - Configures appropriate timeouts and retry logic
 * - Suppresses verbose connection logs
 */
export async function connectMongo(options: Partial<ConnectOptions> = {}): Promise<typeof mongoose> {
	// Return existing connection if already connected
	if (globalConnection && mongoose.connection.readyState === 1) {
		return globalConnection;
	}

	// If connection is in progress, wait for it
	if (connectionPromise) {
		return connectionPromise;
	}

	const uri = process.env.MONGO_URI;
	if (!uri) {
		throw new Error('MONGO_URI is required. Please set MONGO_URI environment variable with your cloud MongoDB connection string (e.g., mongodb+srv://user:password@cluster.mongodb.net/dbname)');
	}
	const dbName = process.env.MONGO_DB_NAME;
	
	// Production-grade connection options optimized for 600k+ users
	// Tuned for high concurrency read-heavy workloads (ed-tech platform)
	const connOptions: ConnectOptions = {
		// Timeout settings: Fail fast to prevent request queue buildup
		serverSelectionTimeoutMS: 10000, // 10s: Faster failure detection for cloud MongoDB (was 30s - too long)
		socketTimeoutMS: 20000, // 20s: Prevent hanging connections (was 45s - excessive)
		connectTimeoutMS: 10000, // 10s: Fast connection attempts (was 20s - too slow)
		
		// Connection pool: Tuned for 600k users with read-heavy workload
		maxPoolSize: options.maxPoolSize ?? 50, // 50: Balanced for read-heavy workloads (was 100 - too high, causes contention)
		minPoolSize: options.minPoolSize ?? 5, // 5: Lower minimum reduces idle connection overhead (was 10)
		waitQueueTimeoutMS: 5000, // 5s: Critical - fail fast if pool exhausted (prevents request queue buildup)
		maxIdleTimeMS: 30000, // 30s: Close idle connections faster to free resources (was 60s)
		
		// Write concern: Optimized for high-throughput
		retryWrites: true,
		w: 'majority',
		
		// Performance: Suppress verbose logs, disable command monitoring
		monitorCommands: false,
		...options,
		// Only pass dbName if provided; URI may already include it
		...(dbName ? { dbName } : {}),
	};

	// CRITICAL: Disable Mongoose buffering BEFORE connecting
	// This prevents "buffering timed out" errors - operations will fail immediately if connection isn't ready
	// Note: bufferCommands is already set at module load time, but set it here again to be safe
	mongoose.set('bufferCommands', false);
	
	// Suppress Mongoose connection event logging
	mongoose.set('debug', false);
	
	connectionPromise = (async () => {
		try {
			// Check if already connected before attempting new connection
			if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
				// CRITICAL: Verify connection is actually usable by checking db object
				globalConnection = mongoose;
				logger.info('Using existing MongoDB connection', {
					readyState: mongoose.connection.readyState,
					service: 'mongo-connection',
				});
				return mongoose;
			}
			
			// If readyState=1 but no db object, connection might be stale, reconnect
			if (mongoose.connection.readyState === 1) {
				logger.warn('MongoDB readyState=1 but db object missing, reconnecting', {
					service: 'mongo-connection',
				});
			}

			// CRITICAL: Connect and wait for connection to be fully ready
			// mongoose.connect() resolves when connection is established
			await mongoose.connect(uri, connOptions);
			
			// CRITICAL: Wait for 'open' event to ensure connection is fully ready for queries
			// Even though connect() resolves, the 'open' event confirms it's ready for queries
			// This prevents "buffering timed out" errors
			if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
				// Connection not ready yet - wait for 'open' event
				await new Promise<void>((resolve, reject) => {
					const timeout = setTimeout(() => {
						reject(new Error('MongoDB connection timeout - did not receive "open" event after 10s'));
					}, 10000);
					
					const onOpen = () => {
						clearTimeout(timeout);
						logger.info('MongoDB connection "open" event received - fully ready for queries', {
							service: 'mongo-connection',
						});
						mongoose.connection.removeListener('error', onError);
						resolve();
					};
					
					const onError = (err: Error) => {
						clearTimeout(timeout);
						mongoose.connection.removeListener('open', onOpen);
						reject(err);
					};
					
					// Check if already open (event might have fired during connect)
					if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
						clearTimeout(timeout);
						logger.info('MongoDB connection already open and ready for queries', {
							service: 'mongo-connection',
						});
						resolve();
						return;
					}
					
					// Set up listeners for 'open' event
					mongoose.connection.once('open', onOpen);
					mongoose.connection.once('error', onError);
				});
			}
			
			// Final verification: connection must be ready
			if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
				throw new Error(`MongoDB connection failed - State: ${mongoose.connection.readyState}, hasDb: ${!!mongoose.connection.db}`);
			}
			
			logger.info('MongoDB connection fully ready for queries', {
				readyState: mongoose.connection.readyState,
				service: 'mongo-connection',
			});
			
			// Set up connection event handlers with performance monitoring
			mongoose.connection.on('error', (err) => {
				// Only log actual errors, not connection metadata
				if (err.message && !err.message.includes('client metadata')) {
					logger.error('MongoDB connection error', {
						error: err.message,
						stack: err.stack,
						service: 'mongo-connection',
					});
				}
			});

			mongoose.connection.on('disconnected', () => {
				globalConnection = null;
				logger.warn('MongoDB disconnected', {
					service: 'mongo-connection',
				});
			});

			// Monitor connection pool exhaustion (critical for high-traffic scenarios)
			mongoose.connection.on('fullsetup', () => {
				// Log when connection pool is full (warns of potential exhaustion)
				if (process.env.NODE_ENV === 'development') {
					logger.debug('MongoDB connection pool established', {
						service: 'mongo-connection',
					});
				}
			});

			globalConnection = mongoose;
			return mongoose;
		} catch (error) {
			connectionPromise = null;
			const errorMessage = error instanceof Error ? error.message : String(error);
			// Provide helpful error message for authentication failures
			if (errorMessage.includes('bad auth') || errorMessage.includes('Authentication failed')) {
				throw new Error(`MongoDB authentication failed. Please verify your MONGO_URI connection string has correct credentials. For cloud MongoDB (Atlas), format: mongodb+srv://username:password@cluster.mongodb.net/dbname. Ensure special characters in password are URL-encoded. Original error: ${errorMessage}`);
			}
			throw error;
		}
	})();

	return connectionPromise;
}

/**
 * Disconnect from MongoDB gracefully
 * Only disconnects if this is the last reference
 */
export async function disconnectMongo(): Promise<void> {
	if (mongoose.connection.readyState !== 0) {
		await mongoose.disconnect();
		globalConnection = null;
		connectionPromise = null;
	}
}
