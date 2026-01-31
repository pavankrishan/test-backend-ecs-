/**
 * Quick diagnostic script to check event system
 * 
 * Usage: node check-event-system.js
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

async function checkEventSystem() {
    console.log('🔍 Checking Event System...\n');
    
    // Check 1: Redis Connection
    console.log('1️⃣  Checking Redis Connection...');
    try {
        const { getRedisClient } = require('./shared/dist/databases/redis/connection.js');
        const redis = getRedisClient();
        
        if (redis.status === 'ready') {
            console.log('   ✅ Redis connected');
        } else {
            await redis.connect();
            console.log('   ✅ Redis connected (just connected)');
        }
        
        const pong = await redis.ping();
        console.log(`   ✅ Redis PING: ${pong}\n`);
    } catch (error) {
        console.log(`   ❌ Redis error: ${error.message}\n`);
    }
    
    // Check 2: Event Bus
    console.log('2️⃣  Checking Event Bus...');
    try {
        const { getEventBus } = require('./shared/dist/events/eventBus.js');
        const eventBus = getEventBus();
        console.log('   ✅ Event bus initialized\n');
    } catch (error) {
        console.log(`   ❌ Event bus error: ${error.message}\n`);
    }
    
    // Check 3: Test Event Emission
    console.log('3️⃣  Testing Event Emission...');
    try {
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
        console.log('   ✅ Test event emitted successfully\n');
    } catch (error) {
        console.log(`   ❌ Event emission error: ${error.message}\n`);
    }
    
    // Check 4: API Gateway (if running)
    console.log('4️⃣  Checking API Gateway...');
    try {
        const http = require('http');
        const apiUrl = process.env.API_GATEWAY_URL || 'http://localhost:3000';
        
        const response = await new Promise((resolve, reject) => {
            const req = http.get(apiUrl, (res) => {
                resolve({ status: res.statusCode, running: true });
            });
            req.on('error', (err) => {
                reject(err);
            });
            req.setTimeout(2000, () => {
                req.destroy();
                reject(new Error('Timeout'));
            });
        });
        
        if (response.running) {
            console.log(`   ✅ API Gateway is running (${response.status})\n`);
        }
    } catch (error) {
        console.log(`   ⚠️  API Gateway not reachable: ${error.message}`);
        console.log('   💡 Make sure API Gateway is running: cd services/api-gateway && npm run dev\n');
    }
    
    // Summary
    console.log('📋 Summary:');
    console.log('   - Redis: Check above');
    console.log('   - Event Bus: Check above');
    console.log('   - API Gateway: Check above');
    console.log('\n💡 Next Steps:');
    console.log('   1. If API Gateway is not running, start it:');
    console.log('      cd services/api-gateway && npm run dev');
    console.log('   2. Ensure frontend is connected to WebSocket');
    console.log('   3. Check frontend console for event logs');
    console.log('   4. If WebSocket fails, frontend should fall back to polling');
}

checkEventSystem().catch(console.error);

