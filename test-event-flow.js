/**
 * Test complete event flow: Emit -> Redis -> WebSocket -> Verify
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

async function testEventFlow() {
    console.log('🧪 Testing Complete Event Flow...\n');
    
    // Step 1: Clear caches and get fresh connections
    console.log('1️⃣  Setting up fresh connections...');
    delete require.cache[require.resolve('./shared/dist/databases/redis/connection.js')];
    delete require.cache[require.resolve('./shared/dist/events/eventBus.js')];
    
    // Step 2: Get event bus
    console.log('2️⃣  Getting event bus...');
    const { getEventBus } = require('./shared/dist/events/eventBus.js');
    const eventBus = getEventBus();
    
    // Step 3: Create test event
    const testEvent = {
        type: 'SESSION_COMPLETED',
        timestamp: Date.now(),
        userId: 'test-trainer-id',
        role: 'trainer',
        sessionId: 'test-session-' + Date.now(),
        trainerId: 'test-trainer-id',
        studentId: 'e41db030-2a5f-42b0-983b-32c131e547a9', // Real student ID from your session
        completedAt: new Date().toISOString(),
        duration: 60,
    };
    
    console.log('3️⃣  Emitting test event...');
    console.log(`   Event: ${testEvent.type}`);
    console.log(`   Student ID: ${testEvent.studentId}`);
    console.log(`   Trainer ID: ${testEvent.trainerId}\n`);
    
    try {
        await eventBus.emit(testEvent);
        console.log('   ✅ Event emitted successfully!\n');
    } catch (error) {
        console.error(`   ❌ Failed to emit: ${error.message}\n`);
        return;
    }
    
    // Step 4: Verify event was published to Redis
    console.log('4️⃣  Verifying event in Redis...');
    try {
        const { getRedisClient } = require('./shared/dist/databases/redis/connection.js');
        const redis = getRedisClient();
        
        // Subscribe to business-events channel to see if event arrives
        const subscriber = redis.duplicate();
        await subscriber.connect();
        await subscriber.subscribe('business-events');
        
        console.log('   ✅ Subscribed to business-events channel');
        console.log('   ⏳ Waiting 3 seconds for event...\n');
        
        const eventReceived = new Promise((resolve) => {
            const timeout = setTimeout(() => {
                subscriber.unsubscribe();
                subscriber.quit();
                resolve(false);
            }, 3000);
            
            subscriber.on('message', (channel, message) => {
                try {
                    const event = JSON.parse(message);
                    if (event.sessionId === testEvent.sessionId) {
                        clearTimeout(timeout);
                        subscriber.unsubscribe();
                        subscriber.quit();
                        resolve(true);
                    }
                } catch (e) {
                    // Ignore parse errors
                }
            });
        });
        
        const received = await eventReceived;
        if (received) {
            console.log('   ✅ Event received in Redis channel!\n');
        } else {
            console.log('   ⚠️  Event not received in Redis channel (may have been emitted before subscription)\n');
        }
    } catch (error) {
        console.error(`   ❌ Error verifying: ${error.message}\n`);
    }
    
    // Step 5: Check API Gateway
    console.log('5️⃣  Checking API Gateway WebSocket...');
    try {
        const http = require('http');
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
            console.log('      - [EventBus] Received event from Redis: SESSION_COMPLETED');
            console.log('      - [WebSocket] Emitting event to user\n');
        }
    } catch (error) {
        console.log(`   ⚠️  API Gateway check failed: ${error.message}\n`);
    }
    
    console.log('📋 Summary:');
    console.log('   - Event emitted: ✅');
    console.log('   - Redis channel: Check above');
    console.log('   - API Gateway: Check above');
    console.log('\n💡 Next Steps:');
    console.log('   1. Check API Gateway logs for event reception');
    console.log('   2. Check if frontend WebSocket is connected');
    console.log('   3. Verify user IDs match (studentId/trainerId in event vs logged-in users)');
    console.log('   4. Check frontend console for event logs');
}

testEventFlow().catch(console.error);


