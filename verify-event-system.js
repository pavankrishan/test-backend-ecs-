/**
 * Verify Event System is Working
 * 
 * This script checks:
 * 1. Redis connection
 * 2. Event Bus type (Redis vs InMemory)
 * 3. Event emission capability
 * 4. API Gateway WebSocket status
 */

require('dotenv').config();
const http = require('http');

async function verifyEventSystem() {
    console.log('🔍 Verifying Event System...\n');
    
    // Step 1: Check Redis connection
    console.log('1️⃣  Checking Redis connection...');
    try {
        delete require.cache[require.resolve('./shared/dist/databases/redis/connection.js')];
        const { getRedisClient } = require('./shared/dist/databases/redis/connection.js');
        const redis = getRedisClient();
        
        console.log(`   Redis status: ${redis.status}`);
        
        if (redis.status === 'ready') {
            console.log('   ✅ Redis is connected\n');
        } else if (redis.status === 'connecting' || redis.status === 'wait') {
            console.log('   ⏳ Redis is connecting...\n');
            // Wait a bit
            await new Promise(resolve => setTimeout(resolve, 2000));
            console.log(`   Redis status after wait: ${redis.status}\n`);
        } else {
            console.log('   ❌ Redis is not connected\n');
        }
    } catch (error) {
        console.error(`   ❌ Redis error: ${error.message}\n`);
    }
    
    // Step 2: Check Event Bus
    console.log('2️⃣  Checking Event Bus...');
    try {
        delete require.cache[require.resolve('./shared/dist/events/eventBus.js')];
        const { getEventBus } = require('./shared/dist/events/eventBus.js');
        const eventBus = getEventBus();
        
        console.log(`   Event Bus type: ${eventBus.constructor.name}`);
        
        if (eventBus.constructor.name === 'RedisEventBus') {
            console.log('   ✅ Using Redis Pub/Sub\n');
        } else {
            console.log('   ⚠️  Using InMemoryEventBus (events won\'t reach API Gateway)\n');
        }
    } catch (error) {
        console.error(`   ❌ Event Bus error: ${error.message}\n`);
    }
    
    // Step 3: Test event emission
    console.log('3️⃣  Testing event emission...');
    try {
        const { getEventBus } = require('./shared/dist/events/eventBus.js');
        const eventBus = getEventBus();
        
        const testEvent = {
            type: 'SESSION_COMPLETED',
            timestamp: Date.now(),
            sessionId: 'test-' + Date.now(),
            studentId: 'test-student',
            trainerId: 'test-trainer',
        };
        
        await eventBus.emit(testEvent);
        console.log('   ✅ Event emitted successfully\n');
    } catch (error) {
        console.error(`   ❌ Event emission failed: ${error.message}\n`);
    }
    
    // Step 4: Check API Gateway
    console.log('4️⃣  Checking API Gateway...');
    try {
        const response = await new Promise((resolve, reject) => {
            const req = http.get('http://localhost:3000', (res) => {
                resolve({ status: res.statusCode, running: true });
            });
            req.on('error', reject);
            req.setTimeout(2000, () => {
                req.destroy();
                reject(new Error('Timeout'));
            });
        });
        
        if (response.running) {
            console.log('   ✅ API Gateway is running');
            console.log('   💡 Check API Gateway logs for:');
            console.log('      - [EventBus] Using Redis Pub/Sub event bus');
            console.log('      - [WebSocket] Event bus initialized\n');
        }
    } catch (error) {
        console.log(`   ⚠️  API Gateway check failed: ${error.message}`);
        console.log('   💡 Make sure API Gateway is running (pnpm dev)\n');
    }
    
    console.log('📋 Summary:');
    console.log('   - Check the logs above for any issues');
    console.log('   - If Event Bus is InMemoryEventBus, Redis connection failed');
    console.log('   - If API Gateway is not running, start it with: pnpm dev');
    console.log('   - After fixing issues, restart all services\n');
}

verifyEventSystem().catch(console.error);

