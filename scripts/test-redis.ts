/**
 * Test Redis Connection Script
 * Run with: npx tsx scripts/test-redis.ts
 */

import 'dotenv/config';
import { getRedisClient, testRedisConnection, closeRedisConnection } from '../shared/databases/redis/connection';

async function main() {
  console.log('🔍 Testing Redis connection...\n');

  // Debug: Show which Redis URL is being used
  if (process.env.REDIS_URL) {
    const url = new URL(process.env.REDIS_URL);
    console.log(`📡 Connecting to: ${url.protocol}//${url.hostname}:${url.port}`);
    console.log(`🔒 TLS: ${url.protocol === 'rediss:' ? 'Enabled' : 'Disabled'}\n`);
  } else {
    console.log(`📡 Connecting to: ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`);
    console.log(`⚠️  REDIS_URL not set, using individual config\n`);
  }

  try {
    // Create Redis client
    const client = getRedisClient();

    // Test connection
    const isConnected = await testRedisConnection(client);
    
    if (isConnected) {
      console.log('✅ Redis connection successful!\n');

      // Test basic operations
      console.log('📝 Testing Redis operations...');
      
      // Set a test key
      await client.set('test:connection', 'success', 'EX', 60);
      console.log('✅ SET operation: OK');

      // Get the test key
      const value = await client.get('test:connection');
      console.log(`✅ GET operation: ${value}`);

      // Test hash
      await client.hset('test:hash', { field1: 'value1', field2: 'value2' });
      const hash = await client.hgetall('test:hash');
      console.log('✅ HASH operations:', hash);

      // Clean up
      await client.del('test:connection', 'test:hash');
      console.log('✅ Cleanup: OK');

      console.log('\n🎉 All Redis tests passed!');
    } else {
      console.error('❌ Redis connection failed!');
      process.exit(1);
    }

    // Close connection
    await closeRedisConnection(client);
  } catch (error) {
    console.error('❌ Error testing Redis:', error);
    process.exit(1);
  }
}

main();

