/**
 * Script to complete one session
 * 
 * Usage:
 *   node complete-session.js [sessionId]
 * 
 * If sessionId is not provided, it will find the first available session
 * that can be completed (scheduled, in_progress, or pending_confirmation).
 * 
 * Note: For real-time frontend updates, ensure:
 *   1. Redis is running and configured (REDIS_URL in .env)
 *   2. Backend services (api-gateway) are running (they handle WebSocket events)
 *   3. If event emission fails, frontend will update via polling (5-30 seconds)
 */

const { Client } = require('pg');
const path = require('path');
const fs = require('fs');
const dns = require('dns');
const { promisify } = require('util');

const resolve4 = promisify(dns.resolve4);

// Try to load .env from multiple locations
const envPaths = [
    path.join(__dirname, '.env'),           // Same directory as script
    path.join(__dirname, '..', '.env'),     // Parent directory (root)
    path.join(process.cwd(), '.env'),       // Current working directory
];

for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath });
        break;
    }
}

// Fallback to default dotenv behavior
if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL && !process.env.DB_PASSWORD) {
    require('dotenv').config();
}

/**
 * Resolve hostname to IP address to fix DNS issues on Windows
 */
async function resolveHostname(hostname) {
    try {
        const addresses = await resolve4(hostname);
        return addresses[0]; // Return first IPv4 address
    } catch (error) {
        // If resolve4 fails, return original hostname (fallback to default DNS)
        return hostname;
    }
}

/**
 * Parse connection string and resolve hostname to IP
 */
async function parseAndResolveConnectionString(connectionString) {
    try {
        const url = new URL(connectionString);
        const originalHostname = url.hostname;
        
        // Resolve hostname to IP
        const ipAddress = await resolveHostname(originalHostname);
        
        // Replace hostname with IP in connection string
        const resolvedUrl = connectionString.replace(originalHostname, ipAddress);
        
        return {
            connectionString: resolvedUrl,
            hostname: originalHostname, // Keep original for SNI if needed
            ipAddress: ipAddress
        };
    } catch (error) {
        // If parsing fails, return original
        return {
            connectionString: connectionString,
            hostname: null,
            ipAddress: null
        };
    }
}

async function completeSession(sessionId = null) {
    console.log('🔍 Completing session...\n');

    // Support connection string (DATABASE_URL, POSTGRES_URL, POSTGRES_URI)
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URI;
    const useSSL = process.env.POSTGRES_SSL === 'true' || process.env.CLOUD_DATABASE === 'true';
    
    let client;
    if (connectionString) {
        // Parse connection string and resolve hostname to IP (fixes DNS issues on Windows)
        const resolved = await parseAndResolveConnectionString(connectionString);
        let finalConnectionString = resolved.connectionString;
        
        // If SSL is required but not in connection string, add it
        if (useSSL && !/sslmode=/.test(finalConnectionString)) {
            const separator = finalConnectionString.includes('?') ? '&' : '?';
            finalConnectionString = `${finalConnectionString}${separator}sslmode=require`;
        }
        
        // Parse URL to get connection config
        const url = new URL(finalConnectionString);
        const config = {
            host: url.hostname, // This will be the IP address now
            port: parseInt(url.port || '5432', 10),
            database: url.pathname.slice(1), // Remove leading /
            user: url.username,
            password: url.password,
            ssl: useSSL ? { 
                rejectUnauthorized: false,
                // Use original hostname for SNI (Server Name Indication)
                ...(resolved.hostname && { servername: resolved.hostname })
            } : undefined,
        };
        
        client = new Client(config);
    } else {
        // For individual config, resolve hostname if provided
        const host = process.env.DB_HOST || process.env.POSTGRES_HOST || 'localhost';
        const resolvedHost = host !== 'localhost' ? await resolveHostname(host) : host;
        
        client = new Client({
            host: resolvedHost,
            port: process.env.DB_PORT || process.env.POSTGRES_PORT || 5432,
            database: process.env.DB_NAME || process.env.POSTGRES_DB || 'koding_caravan',
            user: process.env.DB_USER || process.env.POSTGRES_USER || 'postgres',
            password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || 'postgres',
            ssl: useSSL ? { 
                rejectUnauthorized: false,
                // Use original hostname for SNI if we resolved it
                ...(host !== 'localhost' && host !== resolvedHost && { servername: host })
            } : undefined,
        });
    }

    try {
        await client.connect();
        console.log('✅ Connected to database\n');

        let session;

        // If sessionId provided, get that session
        if (sessionId) {
            const result = await client.query(
                'SELECT * FROM tutoring_sessions WHERE id = $1',
                [sessionId]
            );

            if (result.rows.length === 0) {
                console.log(`❌ Session not found: ${sessionId}`);
                return;
            }

            session = result.rows[0];
            console.log(`📋 Found session: ${session.id}`);
            console.log(`   Status: ${session.status}`);
            console.log(`   Student: ${session.student_id}`);
            console.log(`   Trainer: ${session.trainer_id}`);
            console.log(`   Scheduled: ${session.scheduled_date} ${session.scheduled_time}\n`);
        } else {
            // Find first available session that can be completed
            const result = await client.query(
                `SELECT * FROM tutoring_sessions 
                 WHERE status IN ('scheduled', 'in_progress', 'pending_confirmation')
                 ORDER BY scheduled_date, scheduled_time
                 LIMIT 1`
            );

            if (result.rows.length === 0) {
                console.log('❌ No sessions found that can be completed');
                console.log('   Looking for sessions with status: scheduled, in_progress, or pending_confirmation');
                return;
            }

            session = result.rows[0];
            console.log(`📋 Found session: ${session.id}`);
            console.log(`   Status: ${session.status}`);
            console.log(`   Student: ${session.student_id}`);
            console.log(`   Trainer: ${session.trainer_id}`);
            console.log(`   Scheduled: ${session.scheduled_date} ${session.scheduled_time}\n`);
        }

        const now = new Date();
        const updates = [];

        // Step 1: If scheduled, start it (set to in_progress)
        if (session.status === 'scheduled') {
            console.log('⏩ Step 1: Starting session...');
            
            // Get student home location for GPS verification
            let studentHomeLocation = null;
            if (session.student_home_location) {
                studentHomeLocation = typeof session.student_home_location === 'string' 
                    ? JSON.parse(session.student_home_location)
                    : session.student_home_location;
            }

            // Set trainer start location (use student home location if available, or default)
            const trainerStartLocation = studentHomeLocation 
                ? {
                    latitude: studentHomeLocation.latitude || 12.9716,
                    longitude: studentHomeLocation.longitude || 77.5946,
                    timestamp: now
                }
                : {
                    latitude: 12.9716,
                    longitude: 77.5946,
                    timestamp: now
                };

            await client.query(
                `UPDATE tutoring_sessions
                 SET 
                    status = 'in_progress',
                    started_at = $1,
                    trainer_start_location = $2,
                    gps_verification_passed = true,
                    verification_passed = true,
                    updated_at = NOW()
                 WHERE id = $3`,
                [now, JSON.stringify(trainerStartLocation), session.id]
            );

            console.log('   ✅ Session started (status: in_progress)');
            updates.push('started');
        }

        // Step 2: If in_progress, end it (set to pending_confirmation)
        if (session.status === 'in_progress' || updates.includes('started')) {
            if (!updates.includes('started')) {
                console.log('⏩ Step 2: Ending session...');
            } else {
                console.log('⏩ Step 2: Ending session...');
            }

            // Get started_at or use current time
            const startedAt = session.started_at ? new Date(session.started_at) : now;
            const endedAt = new Date();
            
            // Calculate duration (minimum 30 minutes, maximum 120 minutes)
            const durationMs = endedAt.getTime() - startedAt.getTime();
            const actualDuration = Math.max(40, Math.min(120, Math.round(durationMs / (1000 * 60))));

            // Get trainer end location (use start location or student home location)
            let trainerEndLocation = null;
            if (session.trainer_start_location) {
                const startLoc = typeof session.trainer_start_location === 'string'
                    ? JSON.parse(session.trainer_start_location)
                    : session.trainer_start_location;
                trainerEndLocation = {
                    latitude: startLoc.latitude || 12.9716,
                    longitude: startLoc.longitude || 77.5946,
                    timestamp: endedAt
                };
            } else if (session.student_home_location) {
                const homeLoc = typeof session.student_home_location === 'string'
                    ? JSON.parse(session.student_home_location)
                    : session.student_home_location;
                trainerEndLocation = {
                    latitude: homeLoc.latitude || 12.9716,
                    longitude: homeLoc.longitude || 77.5946,
                    timestamp: endedAt
                };
            } else {
                trainerEndLocation = {
                    latitude: 12.9716,
                    longitude: 77.5946,
                    timestamp: endedAt
                };
            }

            await client.query(
                `UPDATE tutoring_sessions
                 SET 
                    status = 'pending_confirmation',
                    ended_at = $1,
                    actual_duration = $2,
                    trainer_end_location = $3,
                    updated_at = NOW()
                 WHERE id = $4`,
                [endedAt, actualDuration, JSON.stringify(trainerEndLocation), session.id]
            );

            console.log(`   ✅ Session ended (status: pending_confirmation, duration: ${actualDuration} min)`);
            updates.push('ended');
        }

        // Step 3: Confirm it (set to completed)
        if (session.status === 'pending_confirmation' || updates.includes('ended')) {
            if (!updates.includes('ended')) {
                console.log('⏩ Step 3: Confirming session...');
            } else {
                console.log('⏩ Step 3: Confirming session...');
            }

            await client.query(
                `UPDATE tutoring_sessions
                 SET 
                    status = 'completed',
                    student_confirmed = true,
                    student_confirmed_at = $1,
                    student_confirmation_notes = 'Session completed via script',
                    updated_at = NOW()
                 WHERE id = $2`,
                [now, session.id]
            );

            console.log('   ✅ Session confirmed (status: completed)');
            updates.push('confirmed');
        }

        // Step 4: Add review and rating
        if (session.status === 'completed' || updates.includes('confirmed')) {
            console.log('⏩ Step 4: Adding review and rating...');
            
            // Get current metadata or create new
            let currentMetadata = {};
            if (session.metadata) {
                currentMetadata = typeof session.metadata === 'string' 
                    ? JSON.parse(session.metadata)
                    : session.metadata;
            }
            
            // Add review and rating to metadata
            const reviewData = {
                rating: 4,
                review: 'Great session! The trainer was very helpful and explained concepts clearly.',
                reviewedAt: now.toISOString(),
                reviewedBy: 'script'
            };
            
            const updatedMetadata = {
                ...currentMetadata,
                review: reviewData
            };
            
            await client.query(
                `UPDATE tutoring_sessions
                 SET 
                    metadata = $1,
                    updated_at = NOW()
                 WHERE id = $2`,
                [JSON.stringify(updatedMetadata), session.id]
            );
            
            console.log('   ✅ Review and rating added (rating: 4)');
            updates.push('reviewed');
            
            // Step 4a: Update trainer rating average
            if (session.trainer_id) {
                console.log('⏩ Step 4a: Updating trainer rating average...');
                console.log(`   Trainer ID: ${session.trainer_id}`);
                
                // Get all completed sessions with ratings for this trainer
                // Query after metadata update to ensure we get the latest data
                const ratingsResult = await client.query(
                    `SELECT 
                        id,
                        metadata
                     FROM tutoring_sessions
                     WHERE trainer_id = $1
                       AND status = 'completed'
                       AND metadata IS NOT NULL
                       AND metadata::text != 'null'
                       AND metadata::text != '{}'`,
                    [session.trainer_id]
                );
                
                console.log(`   Found ${ratingsResult.rows.length} completed sessions with metadata`);
                
                // Extract ratings from metadata
                const ratings = [];
                for (const row of ratingsResult.rows) {
                    try {
                        const metadata = typeof row.metadata === 'string' 
                            ? JSON.parse(row.metadata)
                            : row.metadata;
                        if (metadata && metadata.review && metadata.review.rating !== undefined) {
                            const rating = parseFloat(metadata.review.rating);
                            if (!isNaN(rating) && rating > 0 && rating <= 5) {
                                ratings.push(rating);
                                console.log(`   Found rating ${rating} in session ${row.id}`);
                            } else {
                                console.log(`   Invalid rating value: ${metadata.review.rating} in session ${row.id}`);
                            }
                        } else {
                            console.log(`   No review.rating found in session ${row.id} metadata`);
                        }
                    } catch (e) {
                        console.log(`   Error parsing metadata for session ${row.id}: ${e.message}`);
                    }
                }
                
                // Also add the current session's rating explicitly (in case query didn't catch it)
                if (reviewData.rating) {
                    const currentRating = parseFloat(reviewData.rating);
                    if (!isNaN(currentRating) && currentRating > 0 && currentRating <= 5) {
                        // Check if we already have this rating (avoid duplicates)
                        const sessionAlreadyIncluded = ratingsResult.rows.some(row => row.id === session.id);
                        if (!sessionAlreadyIncluded) {
                            ratings.push(currentRating);
                            console.log(`   Added current session rating: ${currentRating}`);
                        }
                    }
                }
                
                console.log(`   Total ratings collected: ${ratings.length}`);
                
                if (ratings.length > 0) {
                    // Calculate average rating
                    const totalRating = ratings.reduce((sum, r) => sum + r, 0);
                    const averageRating = totalRating / ratings.length;
                    const totalReviews = ratings.length;
                    
                    console.log(`   Calculating average: ${totalRating} / ${ratings.length} = ${averageRating.toFixed(2)}`);
                    
                    // Update or insert trainer profile rating
                    // Use INSERT ... ON CONFLICT to handle case where profile doesn't exist
                    const updateResult = await client.query(
                        `INSERT INTO trainer_profiles (trainer_id, rating_average, total_reviews, updated_at)
                         VALUES ($1, $2, $3, NOW())
                         ON CONFLICT (trainer_id) DO UPDATE SET
                            rating_average = $2,
                            total_reviews = $3,
                            updated_at = NOW()
                         RETURNING rating_average, total_reviews`,
                        [session.trainer_id, parseFloat(averageRating.toFixed(2)), totalReviews]
                    );
                    
                    if (updateResult.rows.length > 0) {
                        const updated = updateResult.rows[0];
                        console.log(`   ✅ Trainer rating updated successfully`);
                        console.log(`      Average: ${updated.rating_average}`);
                        console.log(`      Total Reviews: ${updated.total_reviews}`);
                        
                        // Immediately invalidate trainer cache after rating update
                        try {
                            const redisConnectionPath = path.join(__dirname, 'shared', 'databases', 'redis', 'connection.ts');
                            const redisConnectionJsPath = path.join(__dirname, 'shared', 'dist', 'databases', 'redis', 'connection.js');
                            
                            let getRedisClient = null;
                            
                            // Try compiled version first
                            if (fs.existsSync(redisConnectionJsPath)) {
                                const redisModule = require(redisConnectionJsPath);
                                getRedisClient = redisModule.getRedisClient || redisModule.default?.getRedisClient;
                            }
                            
                            // Try TypeScript version with ts-node
                            if (!getRedisClient) {
                                try {
                                    require('ts-node/register');
                                    const redisModule = require(redisConnectionPath);
                                    getRedisClient = redisModule.getRedisClient || redisModule.default?.getRedisClient;
                                } catch (e) {
                                    // Continue
                                }
                            }
                            
                            if (getRedisClient) {
                                const redisClient = getRedisClient();
                                const trainerCacheKeys = [
                                    `trainer:bootstrap:${session.trainer_id}`,
                                    `trainer:overview:${session.trainer_id}`,
                                    `trainer:sessions:${session.trainer_id}`,
                                    `trainer:allocations:${session.trainer_id}`
                                ];
                                
                                await Promise.all(
                                    trainerCacheKeys.map(key => redisClient.del(key))
                                );
                                
                                console.log(`   ✅ Invalidated trainer cache after rating update`);
                            }
                        } catch (cacheError) {
                            console.warn('   ⚠️  Failed to invalidate trainer cache (non-critical):', cacheError.message);
                        }
                    } else {
                        console.log('   ⚠️  Update query returned no rows');
                    }
                } else {
                    console.log('   ⚠️  No valid ratings found to calculate average');
                    console.log('   Debug: reviewData =', JSON.stringify(reviewData, null, 2));
                }
            } else {
                console.log('   ⚠️  No trainer_id found in session, skipping rating update');
            }
        }

        // Step 5: Update course progress (if courseId exists)
        const finalResult = await client.query(
            'SELECT id, status, started_at, ended_at, actual_duration, student_confirmed, student_confirmed_at, course_id, student_id, metadata FROM tutoring_sessions WHERE id = $1',
            [session.id]
        );

        const finalSession = finalResult.rows[0];

        // Note: Course progress is now automatically updated via database triggers
        // when tutoring_sessions status changes to 'completed'
        if (finalSession.course_id && finalSession.student_id && finalSession.status === 'completed') {
            console.log('⏩ Step 5: Course progress will be updated automatically via database triggers');
            console.log(`   Student ID: ${finalSession.student_id}`);
            console.log(`   Course ID: ${finalSession.course_id}`);
            console.log('   ✅ Progress update handled by database triggers');
        } else {
            if (!finalSession.course_id) {
                console.log('   ℹ️  No course_id associated with session, skipping progress update');
            }
            if (finalSession.status !== 'completed') {
                console.log(`   ⚠️  Skipping progress update: Session status is '${finalSession.status}' (expected 'completed')`);
            }
        }

        // Step 6: Emit SESSION_COMPLETED event to notify frontend
        if (finalSession.status === 'completed') {
            console.log('⏩ Step 5: Emitting SESSION_COMPLETED event and invalidating cache...');
            
            // Step 6a: Invalidate backend cache for student home and learning data
            // This ensures the next API call returns fresh progress data
            try {
                const redisConnectionPath = path.join(__dirname, 'shared', 'databases', 'redis', 'connection.ts');
                const redisConnectionJsPath = path.join(__dirname, 'shared', 'dist', 'databases', 'redis', 'connection.js');
                
                let getRedisClient = null;
                
                // Try compiled version first
                if (fs.existsSync(redisConnectionJsPath)) {
                    const redisModule = require(redisConnectionJsPath);
                    getRedisClient = redisModule.getRedisClient || redisModule.default?.getRedisClient;
                }
                
                // Try TypeScript version with ts-node
                if (!getRedisClient) {
                    try {
                        require('ts-node/register');
                        const redisModule = require(redisConnectionPath);
                        getRedisClient = redisModule.getRedisClient || redisModule.default?.getRedisClient;
                    } catch (e) {
                        // Continue
                    }
                }
                
                if (getRedisClient) {
                    const redisClient = getRedisClient();
                    const cacheKeysToInvalidate = [];
                    
                    // Invalidate student cache
                    if (finalSession.student_id) {
                        const homeCacheKey = `student:home:${finalSession.student_id}`;
                        const learningCacheKey = `student:learning:${finalSession.student_id}`;
                        cacheKeysToInvalidate.push(homeCacheKey, learningCacheKey);
                    }
                    
                    // Invalidate trainer cache
                    if (finalSession.trainer_id) {
                        const trainerBootstrapKey = `trainer:bootstrap:${finalSession.trainer_id}`;
                        const trainerOverviewKey = `trainer:overview:${finalSession.trainer_id}`;
                        const trainerSessionsKey = `trainer:sessions:${finalSession.trainer_id}`;
                        const trainerAllocationsKey = `trainer:allocations:${finalSession.trainer_id}`;
                        cacheKeysToInvalidate.push(
                            trainerBootstrapKey,
                            trainerOverviewKey,
                            trainerSessionsKey,
                            trainerAllocationsKey
                        );
                    }
                    
                    if (cacheKeysToInvalidate.length > 0) {
                        await Promise.all(
                            cacheKeysToInvalidate.map(key => redisClient.del(key))
                        );
                        
                        console.log(`   ✅ Invalidated cache for session completion`);
                        if (finalSession.student_id) {
                            console.log(`      - Student cache: student:home:${finalSession.student_id}, student:learning:${finalSession.student_id}`);
                        }
                        if (finalSession.trainer_id) {
                            console.log(`      - Trainer cache: trainer:bootstrap:${finalSession.trainer_id}, trainer:sessions:${finalSession.trainer_id}, etc.`);
                        }
                    }
                }
            } catch (cacheError) {
                console.warn('   ⚠️  Failed to invalidate cache (non-critical):', cacheError.message);
                console.log('   💡 Cache will expire naturally in 5 minutes, or can be invalidated manually');
            }
            
            // Emit event - it will be delivered to both student and trainer via WebSocket filtering
            // The role field is informational, actual filtering is done by studentId/trainerId
            const event = {
                type: 'SESSION_COMPLETED',
                timestamp: Date.now(),
                sessionId: finalSession.id,
                trainerId: finalSession.trainer_id,
                studentId: finalSession.student_id,
                courseId: finalSession.course_id || null, // Include courseId for progress updates
                completedAt: finalSession.ended_at ? new Date(finalSession.ended_at).toISOString() : new Date().toISOString(),
                duration: finalSession.actual_duration || 60,
                metadata: {
                    completedBy: 'script',
                },
            };
            
            let eventEmitted = false;
            
            // Try method 1: Use event bus from shared module (compiled)
            try {
                const eventBusPath = path.join(__dirname, 'shared', 'dist', 'events', 'eventBus.js');
                if (fs.existsSync(eventBusPath)) {
                    const eventBusModule = require(eventBusPath);
                    if (eventBusModule.getEventBus) {
                        const eventBus = eventBusModule.getEventBus();
                        await eventBus.emit(event);
                        eventEmitted = true;
                        console.log('   ✅ Event emitted via event bus');
                    }
                }
            } catch (e) {
                // Continue to next method
            }
            
            // Try method 2: Use event bus with ts-node (if available)
            if (!eventEmitted) {
                try {
                    require('ts-node/register');
                    const eventBusModule = require(path.join(__dirname, 'shared', 'events', 'eventBus.ts'));
                    if (eventBusModule.getEventBus) {
                        const eventBus = eventBusModule.getEventBus();
                        await eventBus.emit(event);
                        eventEmitted = true;
                        console.log('   ✅ Event emitted via event bus (ts-node)');
                    }
                } catch (e) {
                    // Continue to next method
                }
            }
            
            // Try method 3: Use shared Redis connection utility (ioredis)
            if (!eventEmitted) {
                try {
                    const redisConnectionPath = path.join(__dirname, 'shared', 'databases', 'redis', 'connection.ts');
                    const redisConnectionJsPath = path.join(__dirname, 'shared', 'dist', 'databases', 'redis', 'connection.js');
                    
                    let getRedisClient = null;
                    
                    // Try compiled version first
                    if (fs.existsSync(redisConnectionJsPath)) {
                        const redisModule = require(redisConnectionJsPath);
                        getRedisClient = redisModule.getRedisClient || redisModule.default?.getRedisClient;
                    }
                    
                    // Try TypeScript version with ts-node
                    if (!getRedisClient) {
                        try {
                            require('ts-node/register');
                            const redisModule = require(redisConnectionPath);
                            getRedisClient = redisModule.getRedisClient || redisModule.default?.getRedisClient;
                        } catch (e) {
                            // Continue
                        }
                    }
                    
                    if (getRedisClient) {
                        const redisClient = getRedisClient();
                        await redisClient.publish('business-events', JSON.stringify(event));
                        eventEmitted = true;
                        console.log('   ✅ Event emitted via Redis (ioredis)');
                    }
                } catch (redisError) {
                    // Try direct ioredis connection as fallback
                    try {
                        const Redis = require('ioredis');
                        const redisUrl = process.env.REDIS_URL || process.env.REDIS_URI;
                        const redisHost = process.env.REDIS_HOST || 'localhost';
                        const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
                        const redisPassword = process.env.REDIS_PASSWORD;
                        
                        let redisClient;
                        if (redisUrl) {
                            redisClient = new Redis(redisUrl);
                        } else {
                            redisClient = new Redis({
                                host: redisHost,
                                port: redisPort,
                                password: redisPassword,
                                lazyConnect: true,
                            });
                        }
                        
                        await redisClient.connect();
                        await redisClient.publish('business-events', JSON.stringify(event));
                        await redisClient.quit();
                        eventEmitted = true;
                        console.log('   ✅ Event emitted via Redis (direct ioredis)');
                    } catch (directRedisError) {
                        // Continue to next method
                    }
                }
            }
            
            if (!eventEmitted) {
                console.log('   ⚠️  Could not emit event (event bus/Redis not available)');
                console.log('   💡 Troubleshooting:');
                console.log('      1. Check if Redis is running: redis-cli ping');
                console.log('      2. Verify REDIS_URL in .env file');
                console.log('      3. Ensure backend services are running (they handle event bus)');
                console.log('      4. Frontend will update on next refresh or polling cycle (5-30 seconds)');
                console.log('   📝 Note: Event emission is optional - session is already completed in database');
            }
        }

        console.log('\n🎉 Session completed successfully!');
        console.log('\n📊 Final Session State:');
        console.log(`   ID: ${finalSession.id}`);
        console.log(`   Status: ${finalSession.status}`);
        console.log(`   Started At: ${finalSession.started_at || 'N/A'}`);
        console.log(`   Ended At: ${finalSession.ended_at || 'N/A'}`);
        console.log(`   Duration: ${finalSession.actual_duration || 'N/A'} minutes`);
        console.log(`   Student Confirmed: ${finalSession.student_confirmed}`);
        console.log(`   Confirmed At: ${finalSession.student_confirmed_at || 'N/A'}`);
        
        // Display review information if available
        if (finalSession.metadata) {
            const metadata = typeof finalSession.metadata === 'string' 
                ? JSON.parse(finalSession.metadata)
                : finalSession.metadata;
            if (metadata.review) {
                console.log(`   Review Rating: ${metadata.review.rating}/5`);
                console.log(`   Review: ${metadata.review.review || 'N/A'}`);
            }
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        
        if (error.message.includes('password authentication failed')) {
            console.error('\n💡 Database authentication failed. Please check your .env file:');
            console.error('   - POSTGRES_PASSWORD or DB_PASSWORD');
            console.error('   - POSTGRES_USER or DB_USER');
            console.error('   - Or use DATABASE_URL/POSTGRES_URL connection string');
        } else if (error.message.includes('ECONNREFUSED')) {
            console.error('\n💡 Cannot connect to database. Please check:');
            console.error('   - POSTGRES_HOST or DB_HOST');
            console.error('   - POSTGRES_PORT or DB_PORT');
            console.error('   - Database server is running');
        } else if (error.message.includes('ECONNRESET') || error.message.includes('read ECONNRESET')) {
            console.error('\n💡 Connection was reset. This might be an SSL/TLS issue.');
            console.error('   Try setting POSTGRES_SSL=true in your .env file');
            console.error('   Or ensure your connection string includes sslmode=require');
        }
        
        console.error('\n📋 Current connection config:');
        if (connectionString) {
            console.error('   Using connection string (DATABASE_URL/POSTGRES_URL)');
            console.error(`   SSL: ${useSSL ? 'enabled' : 'disabled'}`);
        } else {
            console.error(`   Host: ${process.env.DB_HOST || process.env.POSTGRES_HOST || 'localhost'}`);
            console.error(`   Port: ${process.env.DB_PORT || process.env.POSTGRES_PORT || 5432}`);
            console.error(`   Database: ${process.env.DB_NAME || process.env.POSTGRES_DB || 'koding_caravan'}`);
            console.error(`   User: ${process.env.DB_USER || process.env.POSTGRES_USER || 'postgres'}`);
            console.error(`   SSL: ${useSSL ? 'enabled' : 'disabled'}`);
        }
    } finally {
        if (client) {
            await client.end().catch(() => {}); // Ignore errors on close
        }
    }
}

/**
 * Update course progress after session completion
 * This updates the student_progress table directly in the database
 */
/**
 * @deprecated This function is deprecated. Progress is now automatically updated via database triggers
 * when tutoring_sessions status changes to 'completed'. No manual progress updates are needed.
 */
async function updateCourseProgress(client, studentId, courseId) {
    console.log('[DEPRECATED] updateCourseProgress is deprecated. Progress is now handled automatically by database triggers.');
    // Progress is now handled automatically by database triggers
    // No action needed - triggers update student_course_progress when session is completed
}

// Get session ID from command line arguments
const sessionId = process.argv[2] || null;

if (sessionId) {
    console.log(`🎯 Target session: ${sessionId}\n`);
}

completeSession(sessionId).catch(console.error);

