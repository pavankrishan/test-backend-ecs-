/**
 * Simple Redis Connection Test Script
 * Tests Redis connection using the existing connection utilities
 * 
 * Usage: node test-redis-connection.js
 */

const path = require('path');
const fs = require('fs');

// Load .env from multiple locations
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

// Fallback to default dotenv
if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
    require('dotenv').config();
}

async function testRedisConnection() {
    console.log('🔍 Testing Redis connection...\n');

    // Show configuration
    if (process.env.REDIS_URL) {
        try {
            const url = new URL(process.env.REDIS_URL);
            console.log(`📡 Connecting to: ${url.protocol}//${url.hostname}:${url.port}`);
            console.log(`🔒 TLS: ${url.protocol === 'rediss:' ? 'Enabled' : 'Disabled'}\n`);
        } catch (e) {
            console.log(`📡 Using REDIS_URL (format check failed)\n`);
        }
    } else {
        console.log(`📡 Connecting to: ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`);
        console.log(`⚠️  REDIS_URL not set, using individual config\n`);
    }

    try {
        // Try to use the shared Redis connection
        let redisClient = null;
        let getRedisClient = null;

        // Method 1: Try compiled version
        const redisConnectionJsPath = path.join(__dirname, 'shared', 'dist', 'databases', 'redis', 'connection.js');
        if (fs.existsSync(redisConnectionJsPath)) {
            try {
                const redisModule = require(redisConnectionJsPath);
                getRedisClient = redisModule.getRedisClient || redisModule.default?.getRedisClient;
                if (getRedisClient) {
                    redisClient = getRedisClient();
                    console.log('✅ Loaded Redis client from compiled module');
                }
            } catch (e) {
                console.log('⚠️  Could not load compiled module:', e.message);
            }
        }

        // Method 2: Try TypeScript version with ts-node
        if (!getRedisClient) {
            try {
                require('ts-node/register');
                const redisConnectionPath = path.join(__dirname, 'shared', 'databases', 'redis', 'connection.ts');
                const redisModule = require(redisConnectionPath);
                getRedisClient = redisModule.getRedisClient || redisModule.default?.getRedisClient;
                if (getRedisClient) {
                    redisClient = getRedisClient();
                    console.log('✅ Loaded Redis client from TypeScript module');
                }
            } catch (e) {
                console.log('⚠️  Could not load TypeScript module:', e.message);
            }
        }

        // If we got a client, use it (even if it's already connected)
        if (!redisClient) {
            throw new Error('Could not create Redis client. Check if shared/databases/redis/connection is available.');
        }

        // Test connection
        console.log('\n🔌 Testing connection...');
        
        // Check connection status
        const status = redisClient.status;
        console.log(`   Status: ${status}`);
        
        // If not ready, try to connect
        if (status !== 'ready') {
            if (status === 'connecting') {
                console.log('   ⏳ Waiting for connection...');
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);
                    redisClient.once('ready', () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                    redisClient.once('error', (err) => {
                        clearTimeout(timeout);
                        reject(err);
                    });
                });
            } else {
                await redisClient.connect();
            }
        }
        console.log('✅ Connected to Redis!');

        // Test PING
        const pong = await redisClient.ping();
        console.log(`✅ PING response: ${pong}`);

        // Test SET/GET
        console.log('\n📝 Testing Redis operations...');
        await redisClient.set('test:connection', 'success', 'EX', 60);
        console.log('✅ SET operation: OK');

        const value = await redisClient.get('test:connection');
        console.log(`✅ GET operation: ${value}`);

        // Test PUBLISH (for event bus)
        await redisClient.publish('business-events', JSON.stringify({
            type: 'TEST',
            timestamp: Date.now(),
        }));
        console.log('✅ PUBLISH operation: OK (event bus test)');

        // Cleanup
        await redisClient.del('test:connection');
        console.log('✅ Cleanup: OK');

        // Close connection
        await redisClient.quit();
        console.log('\n🎉 All Redis tests passed!');
        console.log('✅ Redis is properly configured and working.');

    } catch (error) {
        console.error('\n❌ Redis connection failed!');
        console.error(`\nError: ${error.message}`);
        
        if (error.code === 'ECONNREFUSED') {
            console.error('\n💡 Connection refused. Possible causes:');
            console.error('   1. Redis server is not running');
            console.error('   2. Wrong host/port in configuration');
            console.error('   3. Firewall blocking the connection');
        } else if (error.code === 'ENOTFOUND') {
            console.error('\n💡 Host not found. Check your REDIS_URL or REDIS_HOST');
        } else if (error.message.includes('password') || error.message.includes('AUTH')) {
            console.error('\n💡 Authentication failed. Check your REDIS_PASSWORD');
        } else if (error.message.includes('TLS') || error.message.includes('SSL')) {
            console.error('\n💡 TLS/SSL error. For Upstash, ensure you use rediss:// (with double s)');
        }

        console.error('\n📋 Current configuration:');
        if (process.env.REDIS_URL) {
            const url = process.env.REDIS_URL;
            const maskedUrl = url.replace(/:[^:@]+@/, ':****@');
            console.error(`   REDIS_URL: ${maskedUrl}`);
        } else {
            console.error(`   REDIS_HOST: ${process.env.REDIS_HOST || 'localhost'}`);
            console.error(`   REDIS_PORT: ${process.env.REDIS_PORT || 6379}`);
            console.error(`   REDIS_PASSWORD: ${process.env.REDIS_PASSWORD ? '***' : '(not set)'}`);
            console.error(`   REDIS_TLS: ${process.env.REDIS_TLS || 'false'}`);
        }

        process.exit(1);
    }
}

testRedisConnection().catch(console.error);

