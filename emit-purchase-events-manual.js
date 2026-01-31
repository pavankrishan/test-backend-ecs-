/**
 * Manual Event Emission Script
 * 
 * Emits PURCHASE_CREATED and COURSE_ACCESS_GRANTED events to Redis Pub/Sub
 * so the frontend receives them in real-time via WebSocket.
 * 
 * Usage:
 *   node emit-purchase-events-manual.js <purchaseId>
 * 
 * Example:
 *   node emit-purchase-events-manual.js bb5eafeb-e64a-494c-8fb2-c526983ab14b
 */

require('dotenv').config();
const { Pool } = require('pg');

const POSTGRES_URL = process.env.POSTGRES_URL || process.env.DATABASE_URL;
const purchaseId = process.argv[2];

if (!purchaseId) {
  console.error('❌ Purchase ID is required');
  console.log('Usage: node emit-purchase-events-manual.js <purchaseId>');
  process.exit(1);
}

const pool = new Pool({
  connectionString: POSTGRES_URL,
  ssl: POSTGRES_URL.includes('render.com') || POSTGRES_URL.includes('amazonaws.com') 
    ? { rejectUnauthorized: false } 
    : false,
});

async function emitEvents() {
  try {
    console.log(`\n🔍 Fetching purchase: ${purchaseId}...`);
    
    // Fetch purchase record
    const purchaseResult = await pool.query(
      `SELECT id, student_id, course_id, purchase_tier, metadata
       FROM student_course_purchases 
       WHERE id = $1 AND is_active = true`,
      [purchaseId]
    );

    if (purchaseResult.rows.length === 0) {
      throw new Error(`Purchase ${purchaseId} not found or not active`);
    }

    const purchase = purchaseResult.rows[0];
    console.log(`✅ Purchase found:`);
    console.log(`   Student ID: ${purchase.student_id}`);
    console.log(`   Course ID: ${purchase.course_id}`);
    console.log(`   Purchase Tier: ${purchase.purchase_tier}`);

    // Parse metadata
    let metadata = {};
    if (purchase.metadata) {
      metadata = typeof purchase.metadata === 'string' 
        ? JSON.parse(purchase.metadata) 
        : purchase.metadata;
    }

    // Connect to Redis and emit events
    console.log(`\n📡 Connecting to Redis...`);
    let redis;
    try {
      // Try multiple paths to find the Redis connection module
      let redisModule;
      try {
        // Try compiled JS path first
        redisModule = require('./shared/dist/databases/redis/connection.js');
      } catch (e1) {
        try {
          // Try TypeScript path (if running with ts-node)
          redisModule = require('./shared/databases/redis/connection');
        } catch (e2) {
          // Try from node_modules
          redisModule = require('@kodingcaravan/shared/databases/redis/connection');
        }
      }
      
      const getRedisClient = redisModule.getRedisClient || redisModule.default?.getRedisClient;
      if (!getRedisClient) {
        throw new Error('getRedisClient function not found in Redis module');
      }
      
      redis = getRedisClient();
      
      if (!redis) {
        throw new Error('Redis client is null');
      }
      
      // Connect if not ready
      if (redis.status !== 'ready') {
        console.log(`⚠️  Redis not ready (status: ${redis.status}), attempting to connect...`);
        if (typeof redis.connect === 'function') {
          await redis.connect();
        } else {
          // Wait a bit for connection
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      if (redis.status === 'ready') {
        console.log(`✅ Redis connected`);
      } else {
        console.warn(`⚠️  Redis status: ${redis.status} (will attempt to publish anyway)`);
      }
    } catch (redisError) {
      console.error(`❌ Failed to connect to Redis: ${redisError.message}`);
      throw redisError;
    }

    // Emit PURCHASE_CREATED event
    const purchaseCreatedEvent = {
      type: 'PURCHASE_CREATED',
      timestamp: Date.now(),
      userId: purchase.student_id,
      role: 'student',
      purchaseId: purchase.id,
      studentId: purchase.student_id,
      courseId: purchase.course_id,
      purchaseTier: purchase.purchase_tier,
      metadata: metadata,
    };

    console.log(`\n📤 Emitting PURCHASE_CREATED event to Redis Pub/Sub...`);
    await redis.publish('business-events', JSON.stringify(purchaseCreatedEvent));
    console.log(`✅ PURCHASE_CREATED event emitted`);

    // Emit COURSE_ACCESS_GRANTED event
    const courseAccessGrantedEvent = {
      type: 'COURSE_ACCESS_GRANTED',
      timestamp: Date.now(),
      userId: purchase.student_id,
      role: 'student',
      purchaseId: purchase.id,
      studentId: purchase.student_id,
      courseId: purchase.course_id,
      purchaseTier: purchase.purchase_tier,
      metadata: metadata,
    };

    console.log(`\n📤 Emitting COURSE_ACCESS_GRANTED event to Redis Pub/Sub...`);
    await redis.publish('business-events', JSON.stringify(courseAccessGrantedEvent));
    console.log(`✅ COURSE_ACCESS_GRANTED event emitted`);

    console.log(`\n✅ All events emitted successfully!`);
    console.log(`\n📝 Frontend should receive these events via WebSocket and update automatically`);

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    await pool.end();
    process.exit(1);
  }
}

emitEvents();

