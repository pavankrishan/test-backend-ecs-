/**
 * Test Event Reception
 * 
 * Subscribes to Redis business-events channel and listens for events
 * to verify they're being published correctly.
 */

require('dotenv').config();

async function testEventReception() {
  try {
    console.log('📡 Connecting to Redis...');
    
    // Try multiple paths to find the Redis connection module
    let redisModule;
    try {
      redisModule = require('./shared/dist/databases/redis/connection.js');
    } catch (e1) {
      try {
        redisModule = require('./shared/databases/redis/connection');
      } catch (e2) {
        console.error('❌ Could not find Redis connection module');
        process.exit(1);
      }
    }
    
    const getRedisClient = redisModule.getRedisClient || redisModule.default?.getRedisClient;
    if (!getRedisClient) {
      throw new Error('getRedisClient function not found');
    }
    
    const redis = getRedisClient();
    
    // Connect if needed
    if (redis.status !== 'ready') {
      console.log('⚠️  Connecting to Redis...');
      await redis.connect();
    }
    
    console.log('✅ Redis connected (status:', redis.status + ')');
    
    // Create subscriber
    const subscriber = redis.duplicate();
    await subscriber.connect();
    await subscriber.subscribe('business-events');
    
    console.log('✅ Subscribed to business-events channel');
    console.log('📡 Listening for events (will timeout in 10 seconds)...\n');
    
    subscriber.on('message', (channel, message) => {
      try {
        const event = JSON.parse(message);
        console.log('📨 Event received:', event.type);
        console.log('   Student ID:', event.studentId);
        console.log('   Course ID:', event.courseId);
        console.log('   Purchase ID:', event.purchaseId);
        console.log('   Timestamp:', new Date(event.timestamp).toISOString());
        console.log('');
      } catch (error) {
        console.error('❌ Failed to parse event:', error.message);
      }
    });
    
    // Listen for 10 seconds
    setTimeout(() => {
      console.log('\n⏱️  Test complete (10 seconds elapsed)');
      subscriber.quit();
      redis.quit();
      process.exit(0);
    }, 10000);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testEventReception();

