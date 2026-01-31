/**
 * Manual Script: Emit TRAINER_ALLOCATED Event
 * 
 * Emits TRAINER_ALLOCATED event to Redis Pub/Sub for a given allocation ID.
 * This is useful for testing or recovering from missed events.
 * 
 * Usage: node emit-trainer-allocated-event-manual.js <allocationId>
 */

require('dotenv').config();
const { Pool } = require('pg');
const redis = require('redis');

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL?.includes('render.com') ? { rejectUnauthorized: false } : false,
});

// Initialize Redis client
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

async function emitTrainerAllocatedEvent(allocationId) {
  try {
    console.log(`🔍 Fetching allocation: ${allocationId}...`);
    
    // Fetch allocation details
    const result = await pool.query(
      `SELECT 
        id,
        student_id,
        course_id,
        trainer_id,
        status,
        metadata
      FROM trainer_allocations
      WHERE id = $1`,
      [allocationId]
    );
    
    if (result.rows.length === 0) {
      console.error('❌ Allocation not found:', allocationId);
      process.exit(1);
    }
    
    const allocation = result.rows[0];
    console.log('✅ Allocation found:');
    console.log('   Student ID:', allocation.student_id);
    console.log('   Course ID:', allocation.course_id);
    console.log('   Trainer ID:', allocation.trainer_id);
    console.log('   Status:', allocation.status);
    
    // Connect to Redis
    console.log('\n📡 Connecting to Redis...');
    if (redisClient.status !== 'ready') {
      console.warn(`⚠️  Redis not ready (status: ${redisClient.status}), attempting to connect...`);
      await redisClient.connect();
      console.log('✅ Redis connected');
    } else {
      console.log('✅ Redis already connected');
    }
    
    // Extract metadata
    const metadata = allocation.metadata || {};
    const sessionCount = metadata.sessionCount || 0;
    const schedule = metadata.schedule || {};
    const startDate = schedule.startDate || schedule.date || new Date().toISOString().split('T')[0];
    const endDate = metadata.endDate || null;
    
    // Create TRAINER_ALLOCATED event
    const trainerAllocatedEvent = {
      type: 'TRAINER_ALLOCATED',
      timestamp: Date.now(),
      userId: allocation.student_id,
      role: 'student',
      allocationId: allocation.id,
      trainerId: allocation.trainer_id,
      studentId: allocation.student_id,
      courseId: allocation.course_id,
      sessionCount: sessionCount,
      startDate: typeof startDate === 'string' ? startDate.split('T')[0] : new Date().toISOString().split('T')[0],
      endDate: endDate ? (typeof endDate === 'string' ? endDate : new Date(endDate).toISOString()) : null,
      metadata: metadata,
    };
    
    console.log('\n📤 Emitting TRAINER_ALLOCATED event to Redis Pub/Sub...');
    console.log('   Event data:', JSON.stringify(trainerAllocatedEvent, null, 2));
    
    await redisClient.publish('business-events', JSON.stringify(trainerAllocatedEvent));
    
    console.log('✅ TRAINER_ALLOCATED event emitted');
    console.log('\n📝 Frontend should receive this event via WebSocket and update automatically');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    await pool.end();
    await redisClient.quit();
  }
}

// Get allocation ID from command line
const allocationId = process.argv[2];

if (!allocationId) {
  console.error('❌ Usage: node emit-trainer-allocated-event-manual.js <allocationId>');
  process.exit(1);
}

emitTrainerAllocatedEvent(allocationId);

