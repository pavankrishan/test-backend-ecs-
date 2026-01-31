/**
 * Test the home API endpoint directly
 * Usage: node test-home-api.js <studentId>
 */

require('dotenv').config();

const STUDENT_ID = process.argv[2] || '15b88b88-5403-48c7-a29f-77a3d5a8ee87';
// Use API Gateway port (3000) - it routes to student-service (3003)
const API_BASE = process.env.API_BASE_URL || process.env.API_GATEWAY_URL || 'http://localhost:3000';
const API_URL = `${API_BASE}/api/v1/students/${STUDENT_ID}/home`;

async function testHomeAPI() {
  try {
    console.log(`\n🔍 Testing home API for student: ${STUDENT_ID}\n`);
    console.log(`API URL: ${API_URL}\n`);

    // First, clear cache
    console.log('Step 1: Clearing cache...');
    const { createClient } = require('redis');
    const redis = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });

    await redis.connect();
    const homeCacheKey = `student:home:${STUDENT_ID}`;
    await redis.del(homeCacheKey);
    console.log('✅ Cache cleared\n');

    // Now call the API
    console.log('Step 2: Calling home API...');
    const response = await fetch(API_URL, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        // Add auth token if needed
        // 'Authorization': `Bearer ${process.env.AUTH_TOKEN}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ API Error: ${response.status} ${response.statusText}`);
      console.error(`Response: ${errorText}`);
      await redis.quit();
      process.exit(1);
    }

    const data = await response.json();
    console.log('✅ API Response received\n');

    // Check the response structure
    console.log('Step 3: Analyzing response...\n');
    
    const homeData = data.data || data;
    const sessions = homeData?.upcomingSessions || [];
    
    console.log(`Response structure:`);
    console.log(`  - Has data: ${!!data.data}`);
    console.log(`  - Has upcomingSessions: ${!!homeData.upcomingSessions}`);
    console.log(`  - Session count: ${sessions.length}`);
    
    if (sessions.length > 0) {
      console.log(`\n✅ Sessions found! Sample:`);
      sessions.slice(0, 3).forEach((s, i) => {
        console.log(`  ${i + 1}. ${s.scheduledDate} ${s.scheduledTime || ''} - ${s.status}`);
        console.log(`     Course: ${s.courseName || s.courseId || 'N/A'}`);
        console.log(`     Trainer: ${s.trainerName || 'N/A'}`);
      });
    } else {
      console.log(`\n⚠️  No sessions in API response!`);
      console.log(`\nFull response keys:`, Object.keys(homeData || {}));
      
      // Check if there's an error in the response
      if (data.error || data.message) {
        console.log(`\nError message:`, data.error || data.message);
      }
    }

    // Check cache after API call
    console.log('\nStep 4: Checking cache after API call...');
    const cached = await redis.get(homeCacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      const cachedSessions = parsed?.upcomingSessions || [];
      console.log(`  Cache exists: YES`);
      console.log(`  Cached session count: ${cachedSessions.length}`);
      
      if (cachedSessions.length === 0 && sessions.length > 0) {
        console.log(`  ⚠️  WARNING: API returned ${sessions.length} sessions but cache has 0!`);
      } else if (cachedSessions.length > 0 && sessions.length === 0) {
        console.log(`  ⚠️  WARNING: Cache has ${cachedSessions.length} sessions but API returned 0!`);
      }
    } else {
      console.log(`  Cache exists: NO (might be disabled or TTL expired)`);
    }

    await redis.quit();
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Backend server might not be running!');
      console.error('   Start it with: pnpm dev (in kc-backend directory)');
    }
    console.error(error.stack);
    process.exit(1);
  }
}

testHomeAPI();

