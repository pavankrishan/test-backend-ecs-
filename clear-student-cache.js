/**
 * Manual script to clear Redis cache for a student
 * Usage: node clear-student-cache.js <studentId>
 */

require('dotenv').config();
const { createClient } = require('redis');

const STUDENT_ID = process.argv[2] || '15b88b88-5403-48c7-a29f-77a3d5a8ee87';

async function clearCache() {
  const redis = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  });

  try {
    await redis.connect();
    console.log('✅ Connected to Redis');

    const homeCacheKey = `student:home:${STUDENT_ID}`;
    const learningCacheKey = `student:learning:${STUDENT_ID}`;

    // Check if cache exists
    const homeExists = await redis.exists(homeCacheKey);
    const learningExists = await redis.exists(learningCacheKey);

    console.log(`\n📊 Cache Status:`);
    console.log(`  Home cache exists: ${homeExists ? 'YES' : 'NO'}`);
    console.log(`  Learning cache exists: ${learningExists ? 'YES' : 'NO'}`);

    if (homeExists) {
      const homeData = await redis.get(homeCacheKey);
      const parsed = JSON.parse(homeData);
      console.log(`  Home cache session count: ${parsed?.upcomingSessions?.length || 0}`);
    }

    // Delete caches
    if (homeExists) {
      await redis.del(homeCacheKey);
      console.log(`\n🗑️  Deleted: ${homeCacheKey}`);
    }

    if (learningExists) {
      await redis.del(learningCacheKey);
      console.log(`🗑️  Deleted: ${learningCacheKey}`);
    }

    if (!homeExists && !learningExists) {
      console.log('\n⚠️  No cache found for this student');
    } else {
      console.log('\n✅ Cache cleared successfully!');
      console.log('   Next API call will fetch fresh data from database.');
    }

    await redis.quit();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

clearCache();

