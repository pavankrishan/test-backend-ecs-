// Script to trigger frontend update after manual purchase creation
// This invalidates cache and optionally emits events to Redis Pub/Sub
// Usage: node trigger-frontend-update.js <studentId> [courseId]

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Load .env file
function loadEnvFile() {
  const envFiles = ['.env.production', '.env.development', '.env.local', '.env'];
  for (const envFile of envFiles) {
    const envPath = path.join(__dirname, envFile);
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          if (key && valueParts.length > 0) {
            const value = valueParts.join('=').replace(/^["']|["']$/g, '');
            if (!process.env[key]) process.env[key] = value;
          }
        }
      });
      break;
    }
  }
}

loadEnvFile();

const studentId = process.argv[2];
const courseId = process.argv[3];

if (!studentId) {
  console.error('Usage: node trigger-frontend-update.js <studentId> [courseId]');
  process.exit(1);
}

const POSTGRES_URL = process.env.POSTGRES_URL || 
  (process.env.POSTGRES_HOST ? 
    `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || 'kodingcaravan'}` :
    null);

const pool = POSTGRES_URL ? new Pool({
  connectionString: POSTGRES_URL,
  ssl: POSTGRES_URL.includes('render.com') ? { rejectUnauthorized: false } : false,
}) : null;

// Get API Gateway URL
const apiGatewayUrl = process.env.API_GATEWAY_URL || 
  process.env.STUDENT_SERVICE_URL ||
  `http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.API_GATEWAY_PORT || 3000}`;

async function invalidateCache() {
  try {
    console.log('Step 1: Invalidating cache...');
    const url = new URL(`${apiGatewayUrl}/api/v1/students/${studentId}/invalidate-cache`);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? require('https') : require('http');
    
    const response = await new Promise((resolve, reject) => {
      const req = httpModule.request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk.toString(); });
        res.on('end', () => resolve({ statusCode: res.statusCode, data }));
      });
      req.on('error', reject);
      req.end();
    });
    
    if (response.statusCode >= 200 && response.statusCode < 300) {
      console.log('✅ Cache invalidated successfully');
      return true;
    } else {
      console.log('⚠️  Cache invalidation returned:', response.statusCode);
      return false;
    }
  } catch (error) {
    console.log('⚠️  Cache invalidation failed:', error.message);
    return false;
  }
}

async function emitWebSocketEvent() {
  if (!pool) {
    console.log('⚠️  Cannot emit WebSocket event (no database connection)');
    return false;
  }

  try {
    console.log('Step 2: Emitting WebSocket event...');
    
    // Get purchase info
    let purchaseId = null;
    let purchaseTier = null;
    
    if (courseId) {
      const purchaseResult = await pool.query(
        `SELECT id, purchase_tier 
         FROM student_course_purchases 
         WHERE student_id = $1 
           AND course_id = $2 
           AND is_active = true
         ORDER BY created_at DESC 
         LIMIT 1`,
        [studentId, courseId]
      );
      
      if (purchaseResult.rows.length > 0) {
        purchaseId = purchaseResult.rows[0].id;
        purchaseTier = purchaseResult.rows[0].purchase_tier;
      }
    }
    
    // Emit to Redis Pub/Sub (for WebSocket)
    try {
      const { getRedisClient } = require('@kodingcaravan/shared/databases/redis/connection');
      const redis = getRedisClient();
      
      if (redis && redis.status === 'ready') {
        const purchaseCreatedEvent = {
          type: 'PURCHASE_CREATED',
          timestamp: Date.now(),
          userId: studentId,
          role: 'student',
          purchaseId: purchaseId || 'manual-fix',
          studentId: studentId,
          courseId: courseId || '',
          purchaseTier: purchaseTier || 30,
          metadata: {},
        };
        
        await redis.publish('business-events', JSON.stringify(purchaseCreatedEvent));
        console.log('✅ WebSocket event emitted to Redis Pub/Sub');
        return true;
      } else {
        console.log('⚠️  Redis not available, skipping WebSocket event');
        return false;
      }
    } catch (redisError) {
      console.log('⚠️  Failed to emit WebSocket event:', redisError.message);
      return false;
    }
  } catch (error) {
    console.log('⚠️  Error emitting WebSocket event:', error.message);
    return false;
  }
}

async function main() {
  console.log('=== Triggering Frontend Update ===\n');
  console.log(`Student ID: ${studentId}`);
  if (courseId) {
    console.log(`Course ID: ${courseId}`);
  }
  console.log('');
  
  const cacheInvalidated = await invalidateCache();
  const eventEmitted = await emitWebSocketEvent();
  
  console.log('\n=== Summary ===');
  if (cacheInvalidated) {
    console.log('✅ Cache invalidated - Frontend will refetch data');
  } else {
    console.log('⚠️  Cache invalidation failed - Frontend may show stale data');
  }
  
  if (eventEmitted) {
    console.log('✅ WebSocket event emitted - Frontend will receive real-time update');
  } else {
    console.log('⚠️  WebSocket event not emitted - Frontend will update on next API call');
  }
  
  console.log('\n📱 Frontend Update:');
  console.log('   1. If app is open: Pull to refresh or wait for cache TTL (5 min)');
  console.log('   2. If app is closed: Restart app to see new purchase');
  console.log('   3. WebSocket will deliver real-time update if connected');
  
  if (pool) {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('\n❌ Error:', error.message);
  if (pool) pool.end();
  process.exit(1);
});

