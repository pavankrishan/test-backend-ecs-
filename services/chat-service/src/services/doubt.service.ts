import { Types } from 'mongoose';
import { Doubt, type DoubtDocument, type DoubtStatus } from '../models/doubt.model';
import { DoubtReply, type DoubtReplyDocument } from '../models/doubtReply.model';
import { filterPersonalInfo, validateNoPersonalInfo } from '../utils/contentFilter';
import { getMongo, initMongo, ensureMongoReady } from '../config/mongo';
import logger from '@kodingcaravan/shared/config/logger';
import {
  getCache,
  setCache,
  invalidateCache,
  buildListCacheKey,
  buildDoubtCacheKey,
  buildRepliesCacheKey,
  DEFAULT_LIST_TTL,
  DEFAULT_DOCUMENT_TTL,
} from '../utils/cache';

export type CreateDoubtInput = {
  studentId: string;
  trainerId?: string | null;
  subject: string;
  topic: string;
  question: string;
  type: 'text' | 'image' | 'voice';
  attachments?: Array<{
    url: string;
    type: 'image' | 'audio' | 'pdf';
    size?: number;
    mimeType?: string;
    metadata?: Record<string, unknown> | null;
  }>;
};

export type CreateDoubtReplyInput = {
  doubtId: string;
  trainerId: string;
  reply: string;
  attachments?: Array<{
    url: string;
    type: 'image' | 'audio' | 'pdf';
    size?: number;
    mimeType?: string;
    metadata?: Record<string, unknown> | null;
  }>;
};

export type DoubtListFilters = {
  studentId?: string;
  trainerId?: string;
  status?: DoubtStatus;
  subject?: string;
  limit?: number;
  page?: number;
};

export class DoubtService {
  /**
   * Create a new doubt ticket
   */
  async createDoubt(input: CreateDoubtInput): Promise<DoubtDocument> {
    // Filter personal contact info from question first (before DB operations)
    const filterResult = filterPersonalInfo(input.question);
    if (filterResult.violations.length > 0) {
      logger.warn('Content filter violations detected', {
        violations: filterResult.violations,
        studentId: input.studentId,
        service: 'chat-service',
      });
      throw new Error(
        `Your question contains personal contact information which is not allowed. Please remove: ${filterResult.violations.join(', ')}`,
      );
    }

    // studentId and trainerId are UUIDs (strings), not MongoDB ObjectIds
    logger.info('Creating doubt', {
      studentId: input.studentId,
      trainerId: input.trainerId,
      subject: input.subject,
      topic: input.topic,
      questionLength: input.question.length,
      service: 'chat-service',
    });

    // Simplified retry logic: Fail fast with minimal retries (2 attempts max)
    // Connection pool exhaustion is handled by waitQueueTimeoutMS (5s fail-fast)
    const maxRetries = 2; // Reduced from 3 - fail fast to prevent request buildup
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.debug('Starting createDoubt attempt', {
          attempt,
          maxRetries,
          service: 'chat-service',
        });
        const mongo = getMongo();
        const readyState = mongo.connection.readyState;
        
        logger.debug('MongoDB connection state', {
          readyState,
          service: 'chat-service',
		});
        
        // Fail fast if disconnected (don't wait for reconnection - waitQueueTimeoutMS handles this)
        if (readyState === 0 || readyState === 3) {
          logger.error('MongoDB connection unavailable, throwing error', {
            readyState,
            service: 'chat-service',
          });
          throw new Error('Database connection unavailable');
        }
        
        // If connecting, wait max 2s (waitQueueTimeoutMS will fail if pool exhausted)
        if (readyState === 2 && attempt === 1) {
          logger.warn('MongoDB connection is connecting, waiting 2s before retry', {
            service: 'chat-service',
          });
          await new Promise(resolve => setTimeout(resolve, 2000));
          // Check readyState again after wait
          const newReadyState = getMongo().connection.readyState;
          if (newReadyState === 1) {
            logger.info('MongoDB connection established after wait, proceeding', {
              service: 'chat-service',
            });
            // Continue to retry the operation
          } else {
            logger.warn('MongoDB still not ready after wait, will retry', {
              readyState: newReadyState,
              service: 'chat-service',
            });
          }
          continue; // Retry once after brief wait
        }
        
        logger.debug('MongoDB connection ready, proceeding with Doubt.create', {
          readyState,
          service: 'chat-service',
        });

        // CRITICAL: Verify connection is fully ready (not just readyState=1)
        // With bufferCommands=false, Mongoose requires connection to be fully initialized
        if (!mongo.connection.db) {
          logger.error('MongoDB connection.db not available, connection not fully initialized', {
            service: 'chat-service',
          });
          throw new Error('Database connection not fully initialized');
        }

        // CRITICAL: Actually verify connection is ready by performing a lightweight operation
        // Even with readyState=1, Mongoose with bufferCommands=false may not be ready
        // We need to actually test the connection to ensure it's ready for operations
        try {
          logger.debug('Verifying MongoDB connection is ready for operations', {
            service: 'chat-service',
          });
          await Promise.race([
            mongo.connection.db.admin().ping(),
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error('Connection readiness check timeout')), 2000);
            }),
          ]);
          logger.debug('MongoDB connection verified and ready for operations', {
            service: 'chat-service',
          });
        } catch (pingError: any) {
          logger.error('MongoDB connection readiness check failed', {
            error: pingError?.message || String(pingError),
            service: 'chat-service',
          });
          // If ping fails, connection is not ready - wait a bit and retry
          if (attempt < maxRetries) {
            logger.warn('Connection not ready, will retry after brief wait', {
              attempt,
              maxRetries,
              service: 'chat-service',
            });
            await new Promise(resolve => setTimeout(resolve, 500));
            continue; // Retry the attempt
          } else {
            throw new Error('Database connection not ready for operations');
          }
        }

        // Execute create operation with bounded timeout (fail fast)
        // Use Promise.race to enforce a hard timeout (15s) in addition to connection pool timeout
        const startTime = Date.now();
        logger.debug('Calling Doubt.create() with timeout wrapper (15s hard limit)', {
          service: 'chat-service',
        });
        
        // CRITICAL: Use native MongoDB driver directly to bypass Mongoose's "initial connection" check
        // This works around the issue where Mongoose doesn't recognize the connection as "initially connected"
        // even though readyState=1 and ping works
        const createPromise = (async () => {
          try {
            // First try using Mongoose model (preferred method)
            return await Doubt.create({
              studentId: input.studentId,
              trainerId: input.trainerId || null,
              subject: input.subject.trim(),
              topic: input.topic.trim(),
              question: filterResult.filtered,
              type: input.type,
              attachments: input.attachments || [],
              status: 'pending',
            });
          } catch (mongooseError: any) {
            // If we get the "initial connection is complete" error, use native driver
            if (mongooseError?.message?.includes('initial connection is complete') || 
                mongooseError?.message?.includes('bufferCommands = false')) {
              logger.warn('Mongoose model failed, using native MongoDB driver directly', {
                error: mongooseError?.message || String(mongooseError),
                service: 'chat-service',
              });
              
              if (!mongo.connection.db) {
                throw new Error('MongoDB connection.db not available');
              }
              
              // Use native driver to insert directly
              const doubtData = {
                studentId: input.studentId,
                trainerId: input.trainerId || null,
                subject: input.subject.trim(),
                topic: input.topic.trim(),
                question: filterResult.filtered,
                type: input.type,
                attachments: input.attachments || [],
                status: 'pending',
                createdAt: new Date(),
                updatedAt: new Date(),
              };
              
              const result = await mongo.connection.db.collection('doubts').insertOne(doubtData);
              
              // Retrieve the inserted document using native driver
              const insertedDoc = await mongo.connection.db.collection('doubts').findOne({ _id: result.insertedId });
              if (!insertedDoc) {
                throw new Error('Failed to retrieve created doubt');
              }
              
              // Convert to Mongoose document using hydrate (bypasses connection check)
              const doubt = Doubt.hydrate(insertedDoc);
              
              return doubt;
            }
            // Re-throw other errors
            throw mongooseError;
          }
        })();
        
        let timeoutId: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error('Database operation timeout after 15 seconds'));
          }, 15000); // 15s hard timeout
        });
        
        try {
          const doubt = await Promise.race([createPromise, timeoutPromise]);
          // Clear timeout if operation succeeded
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          
          // Performance logging: Log slow operations (>200ms)
          const duration = Date.now() - startTime;
          if (duration > 200) {
            logger.warn('Slow query detected: createDoubt', {
              duration,
              studentId: input.studentId,
              service: 'chat-service',
            });
          }

          // Invalidate relevant caches after write operation
          await invalidateCache('list'); // Invalidate all list queries
          await invalidateCache(`doubt:${doubt._id}`); // Invalidate this doubt's cache
          
          logger.info('Doubt created successfully', {
            doubtId: doubt._id,
            studentId: input.studentId,
            service: 'chat-service',
          });
          return doubt;
        } catch (error) {
          // Clear timeout on error
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          throw error;
        }
        
      } catch (error: any) {
        lastError = error;
        
        // Log error details for debugging
        logger.error('createDoubt attempt failed', {
          attempt,
          maxRetries,
          errorName: error?.name,
          errorMessage: error?.message,
          readyState: getMongo().connection.readyState,
          isMongoError: error?.name?.includes('Mongo') || error?.message?.includes('buffering') || error?.message?.includes('timeout'),
          stack: error?.stack?.substring(0, 300),
          studentId: input.studentId,
          service: 'chat-service',
        });
        
        // Check if it's the specific "initial connection is complete" error
        const isInitialConnectionError = 
          error?.message?.includes('initial connection is complete') ||
          error?.message?.includes('bufferCommands = false');
        
        // Check if it's a MongoDB connection/timeout/pool exhaustion error
        const isMongoError = 
          error?.message?.includes('buffering timed out') ||
          error?.message?.includes('wait queue timeout') ||
          error?.message?.includes('pool') ||
          error?.message?.includes('connection') ||
          isInitialConnectionError ||
          error?.name === 'MongoServerSelectionError' ||
          error?.name === 'MongoNetworkTimeoutError' ||
          error?.name === 'MongooseError' ||
          error?.name === 'MongoTimeoutError';
        
        // Non-retryable errors (validation, content filter, etc.)
        const isNonRetryable = 
          error?.message?.includes('personal contact information') ||
          error?.message?.includes('validation failed') ||
          !isMongoError;
        
        // Fail fast: Don't retry non-retryable errors or after max retries
        if (isNonRetryable || attempt >= maxRetries) {
          if (isMongoError && attempt >= maxRetries) {
            // Log pool exhaustion specifically for monitoring
            logger.error('Database connection timeout after max attempts', {
              maxRetries,
              errorName: error?.name,
              errorMessage: error?.message,
              readyState: getMongo().connection.readyState,
              studentId: input.studentId,
              service: 'chat-service',
            });
            throw new Error('Database connection timeout. Please try again.');
          }
          throw error;
        }
        
        // For "initial connection is complete" errors, wait longer and potentially re-initialize
        if (isInitialConnectionError && attempt < maxRetries) {
          logger.warn('Connection not fully initialized, waiting longer before retry', {
            attempt,
            maxRetries,
            service: 'chat-service',
          });
          // Wait longer for connection to fully initialize
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // 1s, 2s
          
          // Try to re-initialize the connection to ensure it's ready
          try {
            await initMongo();
            logger.info('Connection re-initialized, retrying', {
              service: 'chat-service',
            });
          } catch (reinitError: any) {
            logger.warn('Failed to re-initialize connection', {
              error: reinitError?.message || String(reinitError),
              service: 'chat-service',
            });
            // Continue with retry anyway
          }
        } else {
          // Brief exponential backoff before retry (only for retryable MongoDB errors)
          logger.warn('Retrying createDoubt', {
            delayMs: attempt * 500,
            attempt,
            maxRetries,
            service: 'chat-service',
          });
          await new Promise(resolve => setTimeout(resolve, attempt * 500));
        }
      }
    }
    
    throw lastError || new Error('Failed to create doubt after multiple attempts');
  }

  /**
   * Get doubt by ID - Optimized with caching and native MongoDB driver
   * Uses Redis cache (60s TTL) to reduce MongoDB load for read-heavy endpoints
   * Uses native MongoDB driver to avoid Mongoose buffering issues
   */
  async getDoubtById(doubtId: string): Promise<DoubtDocument | null> {
    if (!Types.ObjectId.isValid(doubtId)) {
      return null;
    }
    
    // Check cache first (graceful degradation if Redis unavailable)
    const cacheKey = buildDoubtCacheKey(doubtId);
    const cached = await getCache<DoubtDocument | null>(cacheKey);
    if (cached !== null) {
      return cached;
    }
    
    // Cache miss - query MongoDB with native driver (same approach as listDoubts)
    try {
      const mongo = getMongo();
      if (mongo.connection.readyState !== 1) {
        // Connection not ready - return null (fail fast, don't wait)
        return null;
      }
      
      // Health check similar to listDoubts
      if (!mongo.connection.db) {
        logger.warn('MongoDB database object not available for getDoubtById', {
          doubtId,
          service: 'chat-service',
        });
        return null;
      }
      
      const startTime = Date.now();
      
      logger.debug('getDoubtById: Querying MongoDB for doubt', {
        doubtId,
        objectIdValid: Types.ObjectId.isValid(doubtId),
        service: 'chat-service',
      });
      
      // CRITICAL FIX: Use native MongoDB driver directly (same as listDoubts)
      // This bypasses Mongoose buffering issues that cause "Doubt not found" errors
      const db = mongo.connection.db;
      const collection = db.collection('doubts');
      
      // Convert string ID to ObjectId for query (using Mongoose Types.ObjectId which is compatible)
      const objectId = new Types.ObjectId(doubtId);
      
      const doubt = await collection.findOne(
        { _id: objectId },
        { maxTimeMS: 10000 }
      );
      
      logger.debug('getDoubtById: MongoDB query result', {
        doubtId,
        found: !!doubt,
        has_id: !!doubt?._id,
        _idType: doubt?._id ? typeof doubt._id : 'none',
        service: 'chat-service',
      });
      
      // Convert result to plain object and ensure _id is a string
      let result: DoubtDocument | null = null;
      if (doubt) {
        // Convert _id to string (handle both ObjectId and string)
        const idString = doubt._id 
          ? (typeof doubt._id === 'object' && doubt._id !== null && 'toString' in doubt._id 
              ? (doubt._id as { toString(): string }).toString() 
              : String(doubt._id))
          : null;
        
        if (!idString) {
          logger.warn('getDoubtById: Doubt found but _id is missing or invalid', {
            doubtId,
            has_id: !!doubt._id,
            _idValue: doubt._id,
          });
        }
        
        result = {
          ...doubt,
          _id: idString || doubtId, // Fallback to original doubtId if conversion fails
        } as unknown as DoubtDocument;
        
        logger.debug('getDoubtById: Converted result', {
          doubtId,
          result_id: result._id,
          resultKeys: Object.keys(result).slice(0, 10),
        });
      } else {
        logger.debug('getDoubtById: Doubt not found in MongoDB', {
          doubtId,
          searchedWithObjectId: objectId.toString(),
        });
      }
      
      // Performance logging: Log slow queries (>200ms)
      const duration = Date.now() - startTime;
      if (duration > 200) {
        logger.warn('Slow query: getDoubtById', {
			doubtId,
			duration,
			service: 'chat-service',
		});
      } else {
        logger.debug('getDoubtById completed', {
			doubtId,
			duration,
			service: 'chat-service',
		});
      }
      
      // Cache result (60s TTL for single documents)
      await setCache(cacheKey, result, DEFAULT_DOCUMENT_TTL);
      
      return result;
    } catch (error: any) {
      // Fail fast: Log pool exhaustion or timeout, return null (empty result as per constraints)
      const isPoolExhausted = error?.message?.includes('wait queue timeout') || error?.message?.includes('pool');
      if (isPoolExhausted) {
        logger.error('Connection pool exhausted: getDoubtById', {
			error: error.message,
			doubtId,
			service: 'chat-service',
		});
      } else if (error?.message?.includes('buffering timed out') || error?.message?.includes('Operation timeout')) {
        logger.warn('Query timeout: getDoubtById', {
			error: error.message,
			doubtId,
			service: 'chat-service',
		});
      } else {
        logger.error('Error in getDoubtById', {
			error: error.message,
			stack: error.stack,
			doubtId,
			service: 'chat-service',
		});
      }
      
      // Return null on error (empty result - API contract preserved)
      return null;
    }
  }

  /**
   * Get doubts with filters and pagination - Optimized with caching and lean queries
   * Uses Redis cache (30s TTL) to reduce MongoDB load for read-heavy list endpoints
   */
  async listDoubts(filters: DoubtListFilters): Promise<{
    items: DoubtDocument[];
    page: number;
    limit: number;
    total: number;
  }> {
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100); // Bounded: max 100 items
    const page = Math.max(filters.page ?? 1, 1);
    const skip = (page - 1) * limit;

    // Check cache first (graceful degradation if Redis unavailable)
    const cacheKey = buildListCacheKey(filters);
    const cached = await getCache<{ items: DoubtDocument[]; page: number; limit: number; total: number }>(cacheKey);
    if (cached !== null) {
      logger.debug('Cache hit for listDoubts', {
        cacheKey,
        itemsCount: cached.items.length,
        total: cached.total,
      });
      return cached;
    }
    logger.debug('Cache miss for listDoubts, querying MongoDB', {
		cacheKey,
		service: 'chat-service',
	});

    // Build query with proper indexes (studentId, trainerId, status are indexed)
    const query: Record<string, unknown> = {};
    if (filters.studentId && filters.studentId.trim() !== '') {
      // Only add studentId filter if it's not empty
      query.studentId = filters.studentId.trim(); // UUID string - uses index: { studentId: 1, createdAt: -1 }
    }
    if (filters.trainerId && filters.trainerId.trim() !== '') {
      // Only add trainerId filter if it's not empty
      query.trainerId = filters.trainerId.trim(); // UUID string - uses index: { trainerId: 1, status: 1, createdAt: -1 }
    }
    if (filters.status) {
      query.status = filters.status; // Uses index: { status: 1, createdAt: -1 }
    }
    if (filters.subject && filters.subject.trim() !== '') {
      // Regex search on subject (less efficient, but acceptable for filtered queries)
      query.subject = { $regex: filters.subject.trim(), $options: 'i' };
    }

    // Debug logging for query
    logger.debug('listDoubts query', {
      filters,
      query,
      limit,
      page,
      skip,
      hasStudentIdFilter: !!query.studentId,
      hasTrainerIdFilter: !!query.trainerId,
      hasStatusFilter: !!query.status,
      studentIdValue: query.studentId,
      studentIdType: typeof query.studentId,
      studentIdLength: query.studentId ? String(query.studentId).length : 0,
    });

    // Cache miss - query MongoDB with proper connection handling
    try {
      const mongo = getMongo();
      const readyState = mongo.connection.readyState;
      
      // FAIL FAST: Return empty results immediately if MongoDB is not ready
      // This prevents the app from hanging indefinitely
      if (readyState !== 1) {
        // Connection not ready - return empty results immediately (don't wait, don't throw)
        logger.warn('MongoDB not ready, returning empty results', {
			readyState,
			service: 'chat-service',
		});
        return {
          items: [],
          page,
          limit,
          total: 0,
        };
      }
      
      // Connection is ready (state: 1) - proceed with query
      // CRITICAL FIX: Buffering timeout happens BEFORE Promise chain starts
      // Wrap the ENTIRE query execution in a try-catch with immediate return on ANY error
      const startTime = Date.now();
      
      // CRITICAL: Check if MongoDB connection is actually working before querying
      // readyState 1 doesn't guarantee queries will work - test with a simple operation first
      try {
        // Quick health check - if this fails, MongoDB isn't really ready
        if (!mongo.connection.db) {
          logger.warn('MongoDB database object not available', {
			readyState: mongo.connection.readyState,
			service: 'chat-service',
		});
          throw new Error('MongoDB database connection not available');
        }
        
        // CRITICAL: Perform actual ping with longer timeout (5s) to ensure MongoDB is responding
        // This catches cases where readyState=1 but MongoDB isn't actually accessible
        const pingStart = Date.now();
        logger.debug('Performing MongoDB health check before query', {
			service: 'chat-service',
		});
        await Promise.race([
          mongo.connection.db.admin().ping(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('MongoDB ping timeout after 5s')), 5000);
          }),
        ]);
        const pingDuration = Date.now() - pingStart;
        if (pingDuration > 1000) {
          logger.warn('Slow MongoDB ping detected', {
			pingDuration,
			service: 'chat-service',
		});
        } else {
          logger.debug('MongoDB health check passed', {
			pingDuration,
			service: 'chat-service',
		});
        }
        
        // CRITICAL: Wait a tiny bit to ensure connection is fully ready after ping
        // This prevents race conditions where ping passes but queries still buffer
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (pingError: any) {
        const errorMessage = pingError instanceof Error ? pingError.message : String(pingError);
        logger.error('MongoDB health check failed, returning empty results', {
          error: errorMessage,
          readyState: mongo.connection.readyState,
          hasDb: !!mongo.connection.db,
          host: mongo.connection.host,
          name: mongo.connection.name,
        });
        return {
          items: [],
          page,
          limit,
          total: 0,
        };
      }
      
      // MongoDB health check passed - proceed with queries
      // CRITICAL: Double-check connection is still ready after ping and delay
      if (mongo.connection.readyState !== 1) {
        logger.warn('Connection state changed after health check', {
			readyState: mongo.connection.readyState,
			service: 'chat-service',
		});
        return {
          items: [],
          page,
          limit,
          total: 0,
        };
      }
      
      // CRITICAL: Ensure no pending operations are buffered
      // Wait a bit more if connection was just established
      if (!mongo.connection.db) {
        logger.warn('Database object not available after health check', {
			service: 'chat-service',
		});
        return {
          items: [],
          page,
          limit,
          total: 0,
        };
      }
      
      // CRITICAL: Declare variables outside try block so they're accessible after
      let items: any[] = [];
      let total: number = 0;
      
      // CRITICAL: Wrap EVERYTHING in try-catch to catch buffering timeouts that happen synchronously
      try {
        logger.debug('Executing queries (connection ready, health check passed)', {
			service: 'chat-service',
		});
        
        // CRITICAL FIX: Use native MongoDB driver directly to bypass Mongoose buffering issues
        // Mongoose models might still buffer even with bufferCommands: false, so use native driver
        const db = mongo.connection.db;
        if (!db) {
          throw new Error('MongoDB database object not available');
        }
        
        const collection = db.collection('doubts');
        
        // Execute queries using native MongoDB driver (bypasses Mongoose buffering)
        const findPromise = collection
          .find(query)
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(skip)
          .maxTimeMS(5000)
          .toArray()
          .catch((err: any) => {
            logger.warn('Native find query error (caught by .catch)', {
              error: err?.message?.substring(0, 100),
              name: err?.name,
              code: err?.code,
              service: 'chat-service',
            });
            return [];
          });
        
        const countPromise = collection
          .countDocuments(query, { maxTimeMS: 5000 })
          .catch((err: any) => {
            logger.warn('Native count query error (caught by .catch)', {
              error: err?.message?.substring(0, 100),
              name: err?.name,
              code: err?.code,
            });
            return 0;
          });
        
        // Wrap in Promise.race with absolute timeout (increased to 8s to allow queries to complete)
        const queriesPromise = Promise.all([findPromise, countPromise]);
        const timeoutPromise = new Promise<[any[], number]>((_, reject) => {
          setTimeout(() => reject(new Error('Absolute timeout after 8s')), 8000);
        });
        
        const result = await Promise.race([queriesPromise, timeoutPromise]);
        [items, total] = result;
        
        // Convert native MongoDB results to plain objects (already plain, but ensure format)
        items = items.map((item: any) => {
          // Convert _id to string if it's an ObjectId
          if (item._id && typeof item._id === 'object' && item._id.toString) {
            item._id = item._id.toString();
          }
          return item;
        });
        
        logger.debug('Queries completed successfully (using native MongoDB driver)', {
          itemsCount: items.length,
          total,
          queryDuration: `${Date.now() - startTime}ms`,
          firstItemId: items[0]?._id,
        });
        
        // CRITICAL DEBUG: Log actual query execution details with full item details
        logger.debug('Query executed successfully', {
          queryUsed: JSON.stringify(query),
          itemsReturned: items.length,
          totalReturned: total,
          queryDuration: `${Date.now() - startTime}ms`,
          sampleItem: items[0] ? {
            _id: items[0]._id?.toString(),
            studentId: items[0].studentId,
            status: items[0].status,
            subject: items[0].subject,
            topic: items[0].topic,
            question: items[0].question?.substring(0, 50),
            createdAt: items[0].createdAt,
          } : null,
          allItems: items.map((item: any) => ({
            _id: item._id?.toString(),
            studentId: item.studentId,
            status: item.status,
            subject: item.subject,
            createdAt: item.createdAt,
          })),
          allStudentIds: [...new Set(items.map((item: any) => item.studentId))],
        });
        
        // TEST: Try a direct query to verify MongoDB connection
        if (query.studentId === 'e723e949-436e-459c-8962-833a7e3ed509') {
          logger.debug('TESTING: Direct MongoDB query for specific user', {
			service: 'chat-service',
		});
          try {
            const testQuery = await Doubt.find({ studentId: query.studentId }).limit(5).lean().exec();
            logger.debug('TEST RESULT: Found doubts via direct query', {
              count: testQuery.length,
              doubts: testQuery.map((d: any) => ({
                _id: d._id?.toString(),
                studentId: d.studentId,
                status: d.status,
                subject: d.subject,
                createdAt: d.createdAt,
              })),
            });
          } catch (testErr: any) {
            logger.error('TEST ERROR: Direct MongoDB query failed', {
              error: testErr?.message,
              name: testErr?.name,
              code: testErr?.code,
            });
          }
        }
        
      } catch (queryError: any) {
        // CRITICAL: Catch ANY error (buffering timeout, synchronous errors, etc.)
        // Return empty results immediately - NEVER throw
        logger.warn('Query execution failed (outer catch), returning empty results', {
          error: queryError?.message?.substring(0, 100),
          name: queryError?.name,
          stack: queryError?.stack?.substring(0, 200),
          queryUsed: JSON.stringify(query),
        });
        
        // TEST: Even on error, try a simple direct query to verify MongoDB connection for specific user
        if (query.studentId === 'e723e949-436e-459c-8962-833a7e3ed509') {
          logger.debug('TESTING: Attempting direct MongoDB query despite error', {
			service: 'chat-service',
		});
          try {
            const testQuery = await Promise.race([
              Doubt.find({ studentId: query.studentId }).limit(5).lean().exec(),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Test query timeout')), 3000)),
            ]);
            logger.debug('TEST SUCCESS: Found doubts via direct query', {
              count: testQuery.length,
              doubts: testQuery.map((d: any) => ({
                _id: d._id?.toString(),
                studentId: d.studentId,
                status: d.status,
                subject: d.subject,
                topic: d.topic,
                createdAt: d.createdAt,
              })),
              readyState: mongo.connection.readyState,
            });
          } catch (testErr: any) {
            logger.error('TEST FAILED: Direct query also failed', {
              error: testErr?.message,
              name: testErr?.name,
              code: testErr?.code,
              readyState: mongo.connection.readyState,
              hasDb: !!mongo.connection.db,
            });
          }
        }
        
        return {
          items: [],
          page,
          limit,
          total: 0,
        };
      }
      
      // Type assertion for lean results (they're plain objects, not DoubtDocument)
      const typedItems = items as unknown as DoubtDocument[];

      // Performance logging: Log slow queries (>200ms)
      const duration = Date.now() - startTime;
      if (duration > 200) {
        logger.warn('Slow query: listDoubts', {
			duration,
			filters: Object.keys(query),
			itemsCount: typedItems.length,
			service: 'chat-service',
		});
      }

      // Debug logging for results
      logger.debug('listDoubts results', {
        itemsCount: typedItems.length,
        total,
        page,
        limit,
        queryKeys: Object.keys(query),
        firstItemId: typedItems[0]?._id,
        service: 'chat-service',
      });

      const result = {
        items: typedItems,
        page,
        limit,
        total: total || 0,
      };
      
      // Cache result (30s TTL for list queries - shorter for freshness)
      await setCache(cacheKey, result, DEFAULT_LIST_TTL);
      
      return result;
    } catch (error: any) {
      // Log detailed error information for debugging
      const errorMessage = error?.message || String(error);
      const errorName = error?.name || 'UnknownError';
      
      // Check error types
      const isPoolExhausted = errorMessage.includes('wait queue timeout') || errorMessage.includes('pool');
      const isConnectionTimeout = errorMessage.includes('buffering timed out') || 
                                  errorMessage.includes('Operation timeout') ||
                                  errorMessage.includes('connection timeout') ||
                                  errorMessage.includes('server selection') ||
                                  errorName === 'MongoServerSelectionError' ||
                                  errorName === 'MongoNetworkTimeoutError';
      const isConnectionError = errorMessage.includes('Database connection') ||
                                errorMessage.includes('connection not available') ||
                                errorName === 'MongoNetworkError';
      
      if (isPoolExhausted) {
        logger.error('Connection pool exhausted: listDoubts', {
          error: errorMessage,
          name: errorName,
          stack: error?.stack,
          service: 'chat-service',
        });
      } else if (isConnectionTimeout) {
        logger.error('MongoDB connection timeout: listDoubts', {
          error: errorMessage,
          name: errorName,
          readyState: getMongo().connection.readyState,
          stack: error?.stack,
          service: 'chat-service',
        });
      } else if (isConnectionError) {
        logger.error('MongoDB connection error: listDoubts', {
          error: errorMessage,
          name: errorName,
          readyState: getMongo().connection.readyState,
          stack: error?.stack,
          service: 'chat-service',
        });
      } else {
        logger.error('Unexpected error in listDoubts', {
          error: errorMessage,
          name: errorName,
          readyState: getMongo().connection.readyState,
          stack: error?.stack,
          service: 'chat-service',
        });
      }
      
      // FAIL FAST: Return empty results instead of throwing to prevent app from hanging
      // This ensures the frontend gets a response (even if empty) instead of infinite loading
      logger.warn('Returning empty results due to error to prevent hanging', {
		service: 'chat-service',
	});
      return {
        items: [],
        page,
        limit,
        total: 0,
      };
    }
  }

  /**
   * Create a reply to a doubt - Write operation with cache invalidation
   * Uses native MongoDB driver to avoid Mongoose "initial connection" errors (bufferCommands = false).
   */
  async createDoubtReply(input: CreateDoubtReplyInput): Promise<{
    reply: DoubtReplyDocument;
    doubt: DoubtDocument;
  }> {
    const filterResult = filterPersonalInfo(input.reply);
    if (filterResult.violations.length > 0) {
      throw new Error(
        `Your reply contains personal contact information which is not allowed. Please remove: ${filterResult.violations.join(', ')}`,
      );
    }

    if (!Types.ObjectId.isValid(input.doubtId)) {
      throw new Error('Invalid doubt ID');
    }
    const doubtId = new Types.ObjectId(input.doubtId);
    const trainerId = input.trainerId;

    await ensureMongoReady(10000);
    const mongo = getMongo();
    const db = mongo.connection.db;
    if (!db) throw new Error('MongoDB database not available');
    const doubtsCol = db.collection('doubts');
    const repliesCol = db.collection('doubt_replies');

    const doubt = await doubtsCol.findOne({ _id: doubtId }, { maxTimeMS: 5000 }) as Record<string, unknown> | null;
    if (!doubt) {
      throw new Error('Doubt not found');
    }
    if (!doubt.trainerId || (doubt.trainerId as string) !== trainerId) {
      throw new Error('You are not assigned to this doubt');
    }

    const startTime = Date.now();
    const now = new Date();
    const replyDoc = {
      doubtId,
      trainerId,
      reply: filterResult.filtered,
      attachments: input.attachments ?? [],
      createdAt: now,
      updatedAt: now,
    };
    const insertResult = await repliesCol.insertOne(replyDoc as Record<string, unknown>);
    const insertedReply = await repliesCol.findOne(
      { _id: insertResult.insertedId },
      { maxTimeMS: 5000 },
    ) as Record<string, unknown> | null;
    if (!insertedReply) {
      throw new Error('Failed to retrieve created reply');
    }

    const updatedDoubt = await doubtsCol.findOneAndUpdate(
      { _id: doubtId },
      { $set: { status: 'answered' as DoubtStatus, answeredAt: now, updatedAt: now } },
      { returnDocument: 'after', maxTimeMS: 8000 },
    ) as Record<string, unknown> | null;

    const duration = Date.now() - startTime;
    if (duration > 200) {
      logger.warn('Slow operation: createDoubtReply', {
        duration,
        doubtId: input.doubtId,
        service: 'chat-service',
      });
    }

    await invalidateCache(`replies:${input.doubtId}`);
    await invalidateCache(`doubt:${input.doubtId}`);
    await invalidateCache('list');

    return {
      reply: this.rawToDoubtReplyDocument(
        insertedReply,
        (insertResult.insertedId as { toString(): string }).toString(),
      ),
      doubt: updatedDoubt
        ? this.rawToDoubtDocument(updatedDoubt, input.doubtId)
        : this.rawToDoubtDocument(doubt, input.doubtId),
    };
  }

  /**
   * Get replies for a doubt - Optimized with caching and lean queries
   * Uses Redis cache (60s TTL) to reduce MongoDB load for read-heavy endpoint
   * Returns empty array on failure (replies are non-critical)
   */
  async getDoubtReplies(doubtId: string): Promise<DoubtReplyDocument[]> {
    if (!Types.ObjectId.isValid(doubtId)) {
      return [];
    }
    
    // Check cache first (graceful degradation if Redis unavailable)
    const cacheKey = buildRepliesCacheKey(doubtId);
    const cached = await getCache<DoubtReplyDocument[]>(cacheKey);
    if (cached !== null) {
      return cached;
    }
    
    // Cache miss - query MongoDB with fail-fast approach
    try {
      const mongo = getMongo();
      if (mongo.connection.readyState !== 1) {
        // Connection not ready - return empty array (fail fast, replies are non-critical)
        return [];
      }
      
      const doubtObjectId = new Types.ObjectId(doubtId);
      const startTime = Date.now();
      
      // Use lean() for read operations - returns plain JS objects (faster)
      // Uses index: { doubtId: 1, createdAt: -1 } for efficient query
      const replies = await DoubtReply.find({
        doubtId: doubtObjectId,
      })
        .sort({ createdAt: 1 }) // Uses index for sorting
        .maxTimeMS(10000) // 10s timeout - fail fast (must be before lean())
        .lean() // Critical: Returns plain objects, no Mongoose overhead
        .exec();
      
      // Type assertion for lean results (they're plain objects, not DoubtReplyDocument)
      const typedReplies = replies as unknown as DoubtReplyDocument[];
      
      // Performance logging: Log slow queries (>200ms)
      const duration = Date.now() - startTime;
      if (duration > 200) {
        logger.warn('Slow query: getDoubtReplies', {
			doubtId,
			duration,
			service: 'chat-service',
		});
      }
      
      // Cache result (60s TTL for replies)
      await setCache(cacheKey, typedReplies, DEFAULT_DOCUMENT_TTL);
      
      return typedReplies;
    } catch (error: any) {
      // Fail fast: Log pool exhaustion or timeout, return empty array (replies are non-critical)
      const isPoolExhausted = error?.message?.includes('wait queue timeout') || error?.message?.includes('pool');
      if (isPoolExhausted) {
        logger.error('Connection pool exhausted: getDoubtReplies', {
			error: error.message,
			doubtId,
			service: 'chat-service',
		});
      } else if (error?.message?.includes('buffering timed out') || error?.message?.includes('Operation timeout')) {
        logger.warn('Query timeout: getDoubtReplies', {
			error: error.message,
			doubtId,
			service: 'chat-service',
		});
      }
      
      // Return empty array on error (replies are non-critical, API contract preserved)
      return [];
    }
  }

  /**
   * Update doubt status - Write operation with cache invalidation
   * Uses native MongoDB driver to avoid Mongoose "initial connection" errors (bufferCommands = false).
   */
  async updateDoubtStatus(
    doubtId: string,
    status: DoubtStatus,
    updatedBy: string,
  ): Promise<DoubtDocument> {
    if (!Types.ObjectId.isValid(doubtId)) {
      throw new Error('Invalid doubt ID');
    }

    await ensureMongoReady(10000);
    const mongo = getMongo();
    const db = mongo.connection.db;
    if (!db) throw new Error('MongoDB database not available');
    const col = db.collection('doubts');
    const objectId = new Types.ObjectId(doubtId);

    const doubt = await col.findOne({ _id: objectId }, { maxTimeMS: 5000 }) as Record<string, unknown> | null;
    if (!doubt) {
      throw new Error('Doubt not found');
    }

    const isStudent = (doubt.studentId as string) === updatedBy;
    const isTrainer = doubt.trainerId && (doubt.trainerId as string) === updatedBy;
    if (!isStudent && !isTrainer) {
      throw new Error('You do not have permission to update this doubt');
    }

    const updateFields: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === 'closed') {
      updateFields.closedAt = new Date();
    } else if (status === 'in_progress' && (doubt.status as string) === 'pending') {
      if (!doubt.trainerId && isTrainer) {
        updateFields.trainerId = updatedBy;
      }
    }

    const startTime = Date.now();
    const updated = await col.findOneAndUpdate(
      { _id: objectId },
      { $set: updateFields },
      { returnDocument: 'after', maxTimeMS: 8000 },
    ) as Record<string, unknown> | null;
    const duration = Date.now() - startTime;
    if (duration > 200) {
      logger.warn('Slow operation: updateDoubtStatus', { duration, doubtId, service: 'chat-service' });
    }

    if (!updated) {
      throw new Error('Doubt not found');
    }

    await invalidateCache(`doubt:${doubtId}`);
    await invalidateCache('list');

    return this.rawToDoubtDocument(updated, doubtId);
  }

  /**
   * Reassign doubt to another trainer (Admin only)
   * Uses native MongoDB driver to avoid Mongoose "initial connection" errors (bufferCommands = false).
   */
  async reassignDoubt(doubtId: string, newTrainerId: string): Promise<DoubtDocument> {
    if (!Types.ObjectId.isValid(doubtId)) {
      throw new Error('Invalid doubt ID');
    }

    await ensureMongoReady(10000);
    const mongo = getMongo();
    const db = mongo.connection.db;
    if (!db) throw new Error('MongoDB database not available');
    const col = db.collection('doubts');
    const objectId = new Types.ObjectId(doubtId);

    const doubt = await col.findOne({ _id: objectId }, { maxTimeMS: 5000 }) as Record<string, unknown> | null;
    if (!doubt) {
      throw new Error('Doubt not found');
    }

    const updateFields: Record<string, unknown> = {
      trainerId: newTrainerId,
      updatedAt: new Date(),
    };
    if ((doubt.status as string) === 'pending') {
      updateFields.status = 'in_progress';
    }

    const updated = await col.findOneAndUpdate(
      { _id: objectId },
      { $set: updateFields },
      { returnDocument: 'after', maxTimeMS: 8000 },
    ) as Record<string, unknown> | null;
    if (!updated) {
      throw new Error('Doubt not found');
    }

    return this.rawToDoubtDocument(updated, doubtId);
  }

  /**
   * Get doubt with replies - Production-grade with proper error handling
   */
  async getDoubtWithReplies(doubtId: string): Promise<{
    doubt: DoubtDocument | null;
    replies: DoubtReplyDocument[];
  }> {
    if (!Types.ObjectId.isValid(doubtId)) {
      return { doubt: null, replies: [] };
    }
    
    // Fetch doubt and replies with proper error handling
    // If replies fail, we still return the doubt (replies are non-critical)
    let doubt: DoubtDocument | null = null;
    let replies: DoubtReplyDocument[] = [];
    
    try {
      doubt = await this.getDoubtById(doubtId);
    } catch (error: any) {
      // If getting doubt fails, check if it's a timeout
      const isMongoTimeout = 
        error?.message?.includes('buffering timed out') ||
        error?.message?.includes('Operation timeout') ||
        error?.name === 'MongoServerSelectionError' ||
        error?.name === 'MongoNetworkTimeoutError';
      
      if (isMongoTimeout) {
        logger.error('getDoubtWithReplies: MongoDB timeout fetching doubt', {
			error: error.message,
			doubtId,
			service: 'chat-service',
		});
        throw new Error(`Database connection timeout. Please try again in a moment.`);
      }
      // Re-throw other errors
      throw error;
    }
    
    // Try to get replies, but don't fail if it times out (replies are non-critical)
    try {
      replies = await this.getDoubtReplies(doubtId);
    } catch (error: any) {
      // Log but don't throw - replies are non-critical, return empty array
      logger.warn('Failed to fetch replies, continuing without them', {
		error: error.message,
		doubtId,
		service: 'chat-service',
	});
      replies = [];
    }
    
    return {
      doubt,
      replies,
    };
  }

  /**
   * Format doubt for API response
   * Handles both Mongoose documents and plain objects (from native MongoDB driver queries)
   */
  formatDoubt(doubt: DoubtDocument | Record<string, unknown>) {
    // Check if it's a Mongoose document or plain object
    let formatted: Record<string, unknown>;
    if (doubt && typeof doubt === 'object' && 'toObject' in doubt && typeof (doubt as any).toObject === 'function') {
      // It's a Mongoose document - convert to plain object
      formatted = (doubt as DoubtDocument).toObject({ virtuals: true });
    } else {
      // It's already a plain object (from native driver query) - create a copy
      // Use spread operator to ensure all properties are copied, including _id
      formatted = { ...doubt } as Record<string, unknown>;
    }
    
    // CRITICAL FIX: Ensure _id is always a string and exists
    // Handle MongoDB ObjectId or string - check multiple possible locations
    let idValue: string | undefined;
    
    // First, try to get _id from formatted object
    if (formatted._id !== undefined && formatted._id !== null) {
      if (typeof formatted._id === 'object' && formatted._id !== null && 'toString' in formatted._id) {
        // It's an ObjectId object
        idValue = (formatted._id as { toString(): string }).toString();
      } else {
        // It's already a string or other type - convert to string
        idValue = String(formatted._id);
      }
    } else if ((doubt as any)?._id !== undefined && (doubt as any)?._id !== null) {
      // Fallback: check original object if formatted doesn't have it
      const originalId = (doubt as any)._id;
      if (typeof originalId === 'object' && originalId !== null && 'toString' in originalId) {
        idValue = originalId.toString();
      } else {
        idValue = String(originalId);
      }
    }
    
    // CRITICAL FIX: Always set both _id and id for API consistency (frontend uses both)
    // Set id from _id if we have a valid ID value
    if (idValue && idValue.trim() !== '') {
      formatted._id = idValue;
      formatted.id = idValue;
    } else {
      // If no _id found, log warning for debugging
      logger.warn('formatDoubt: No _id found in doubt object', {
        hasDoubt: !!doubt,
        doubtKeys: doubt ? Object.keys(doubt) : [],
        formattedKeys: Object.keys(formatted),
        formatted_id: formatted._id,
        original_id: (doubt as any)?._id,
        service: 'chat-service',
      });
    }
    
    // Convert Date objects to ISO strings for API response (frontend expects strings)
    const dateFields: Array<keyof typeof formatted> = ['createdAt', 'updatedAt', 'answeredAt', 'closedAt'];
    for (const field of dateFields) {
      const value = formatted[field];
      if (value instanceof Date) {
        formatted[field] = value.toISOString() as typeof formatted[typeof field];
      } else if (value && typeof value === 'object' && 'toISOString' in value) {
        // Handle Date-like objects
        formatted[field] = (value as Date).toISOString() as typeof formatted[typeof field];
      }
    }
    
    return formatted;
  }

  /**
   * Format reply for API response
   * Handles both Mongoose documents and plain objects (from native MongoDB driver).
   */
  formatReply(reply: DoubtReplyDocument | Record<string, unknown>) {
    let formatted: Record<string, unknown>;
    if (reply && typeof reply === 'object' && 'toObject' in reply && typeof (reply as DoubtReplyDocument).toObject === 'function') {
      formatted = (reply as DoubtReplyDocument).toObject({ virtuals: true }) as Record<string, unknown>;
    } else {
      formatted = { ...(reply as Record<string, unknown>) };
    }
    if (formatted._id != null) {
      const v = formatted._id;
      formatted._id = typeof v === 'object' && v !== null && 'toString' in (v as object)
        ? (v as { toString(): string }).toString()
        : String(v);
    }
    return formatted;
  }

  private toObjectId(value: string | Types.ObjectId): Types.ObjectId {
    if (value instanceof Types.ObjectId) {
      return value;
    }
    if (!Types.ObjectId.isValid(value)) {
      throw new Error(`Invalid ObjectId: ${value}`);
    }
    return new Types.ObjectId(value);
  }

  /**
   * Convert raw MongoDB document to DoubtDocument (plain object with _id as string).
   * Used when using native driver to avoid Mongoose "initial connection" errors.
   */
  private rawToDoubtDocument(raw: Record<string, unknown>, fallbackId?: string): DoubtDocument {
    const idVal = raw._id;
    const idString =
      idVal == null
        ? fallbackId ?? ''
        : typeof idVal === 'object' && idVal !== null && 'toString' in (idVal as object)
          ? (idVal as { toString(): string }).toString()
          : String(idVal);
    return { ...raw, _id: idString } as unknown as DoubtDocument;
  }

  /**
   * Convert raw MongoDB reply document to DoubtReplyDocument-like plain object.
   * Used when using native driver for createDoubtReply.
   */
  private rawToDoubtReplyDocument(raw: Record<string, unknown>, fallbackId?: string): DoubtReplyDocument {
    const idVal = raw._id;
    const idString =
      idVal == null
        ? fallbackId ?? ''
        : typeof idVal === 'object' && idVal !== null && 'toString' in (idVal as object)
          ? (idVal as { toString(): string }).toString()
          : String(idVal);
    return { ...raw, _id: idString } as unknown as DoubtReplyDocument;
  }
}

