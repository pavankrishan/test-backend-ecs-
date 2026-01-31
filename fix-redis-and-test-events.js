/**
 * Fix Redis connection and test event emission
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');

// Load .env
const envPaths = [
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', '.env'),
    path.join(process.cwd(), '.env'),
];

for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath });
        break;
    }
}

async function fixAndTest() {
    console.log('🔧 Fixing Redis Connection and Testing Events...\n');
    
    // Step 1: Clear Redis singleton
    console.log('1️⃣  Clearing Redis singleton...');
    try {
        const { disconnectRedis } = require('./shared/dist/databases/redis/connection.js');
        await disconnectRedis();
        console.log('   ✅ Redis singleton cleared\n');
    } catch (error) {
        console.log(`   ⚠️  Could not clear: ${error.message}\n`);
    }
    
    // Step 2: Clear event bus singleton
    console.log('2️⃣  Clearing event bus singleton...');
    // The event bus singleton is internal, so we'll create a fresh connection
    delete require.cache[require.resolve('./shared/dist/events/eventBus.js')];
    console.log('   ✅ Event bus cache cleared\n');
    
    // Step 3: Create fresh Redis connection
    console.log('3️⃣  Creating fresh Redis connection...');
    try {
        const { createRedisClient } = require('./shared/dist/databases/redis/connection.js');
        const redis = createRedisClient();
        
        await redis.connect();
        const pong = await redis.ping();
        console.log(`   ✅ Redis connected: ${pong}\n`);
        
        // Test publish
        await redis.publish('business-events', JSON.stringify({
            type: 'TEST',
            timestamp: Date.now(),
            message: 'Test event from fix script'
        }));
        console.log('   ✅ Test event published to Redis\n');
        
        await redis.quit();
    } catch (error) {
        console.log(`   ❌ Redis error: ${error.message}\n`);
        console.log('   💡 The DNS fix may need services to be restarted\n');
    }
    
    // Step 4: Test event bus with fresh connection
    console.log('4️⃣  Testing event bus with fresh connection...');
    try {
        // Clear cache again
        delete require.cache[require.resolve('./shared/dist/databases/redis/connection.js')];
        delete require.cache[require.resolve('./shared/dist/events/eventBus.js')];
        
        const { getEventBus } = require('./shared/dist/events/eventBus.js');
        const eventBus = getEventBus();
        
        const testEvent = {
            type: 'SESSION_COMPLETED',
            timestamp: Date.now(),
            userId: 'test-user',
            role: 'trainer',
            sessionId: 'test-session-' + Date.now(),
            trainerId: 'test-trainer',
            studentId: 'test-student',
            completedAt: new Date().toISOString(),
            duration: 60,
        };
        
        await eventBus.emit(testEvent);
        console.log('   ✅ Event emitted via event bus\n');
    } catch (error) {
        console.log(`   ❌ Event bus error: ${error.message}\n`);
    }
    
    console.log('📋 Summary:');
    console.log('   - Redis singleton cleared');
    console.log('   - Event bus cache cleared');
    console.log('   - Fresh connections tested');
    console.log('\n💡 Important:');
    console.log('   - Restart API Gateway to get fresh Redis connection');
    console.log('   - Restart any other services using Redis');
    console.log('   - The DNS fix is in place, but services need restart');
}

fixAndTest().catch(console.error);

