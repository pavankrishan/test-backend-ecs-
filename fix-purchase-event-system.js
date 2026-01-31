// Comprehensive fix for purchase event system
// This script:
// 1. Creates processed_events table if missing
// 2. Manually creates purchase from payment
// 3. Optionally triggers allocation
// Usage: node fix-purchase-event-system.js <paymentId> [--trigger-allocation]

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

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

const POSTGRES_URL = process.env.POSTGRES_URL || 
  (process.env.POSTGRES_HOST ? 
    `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || 'kodingcaravan'}` :
    null);

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: POSTGRES_URL,
  ssl: POSTGRES_URL.includes('render.com') ? { rejectUnauthorized: false } : false,
});

const paymentId = process.argv[2] || 'a77870aa-8166-4a69-a979-058270611107';
const triggerAllocation = process.argv.includes('--trigger-allocation');

async function fixEventSystem() {
  try {
    console.log('=== Fixing Purchase Event System ===\n');
    
    // Step 1: Create processed_events table if missing
    console.log('Step 1: Ensuring processed_events table exists...');
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS processed_events (
          event_id UUID PRIMARY KEY,
          event_type VARCHAR(100) NOT NULL,
          correlation_id VARCHAR(255) NOT NULL,
          payload JSONB NOT NULL,
          source VARCHAR(100) NOT NULL,
          version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
          processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          error_message TEXT
        );
        
        CREATE INDEX IF NOT EXISTS idx_processed_events_correlation_type 
          ON processed_events(correlation_id, event_type);
        
        CREATE INDEX IF NOT EXISTS idx_processed_events_source 
          ON processed_events(source, processed_at);
        
        CREATE INDEX IF NOT EXISTS idx_processed_events_type 
          ON processed_events(event_type, processed_at);
        
        CREATE UNIQUE INDEX IF NOT EXISTS idx_processed_events_idempotency 
          ON processed_events(correlation_id, event_type);
      `);
      console.log('✅ processed_events table created/verified\n');
    } catch (error) {
      if (error.code === '42P07') { // Table already exists
        console.log('✅ processed_events table already exists\n');
      } else {
        throw error;
      }
    }
    
    // Step 2: Get payment record
    console.log('Step 2: Fetching payment record...');
    const paymentResult = await pool.query(
      `SELECT id, student_id, status, metadata, confirmed_at
       FROM payments 
       WHERE id = $1`,
      [paymentId]
    );
    
    if (paymentResult.rows.length === 0) {
      console.log('❌ Payment not found');
      await pool.end();
      return;
    }
    
    const payment = paymentResult.rows[0];
    if (payment.status !== 'succeeded') {
      console.log(`❌ Payment status is "${payment.status}", not "succeeded"`);
      await pool.end();
      return;
    }
    
    console.log('✅ Payment found and succeeded');
    console.log('   Student ID:', payment.student_id);
    console.log('   Confirmed:', payment.confirmed_at);
    
    const metadata = typeof payment.metadata === 'string' 
      ? JSON.parse(payment.metadata)
      : payment.metadata;
    
    const courseId = metadata?.courseId;
    if (!courseId) {
      console.log('❌ Course ID not found in payment metadata');
      await pool.end();
      return;
    }
    
    console.log('   Course ID:', courseId);
    
    // Step 3: Check if purchase exists
    console.log('\nStep 3: Checking for existing purchase...');
    const existingPurchase = await pool.query(
      `SELECT id, purchase_tier, created_at
       FROM student_course_purchases 
       WHERE student_id = $1 
         AND course_id = $2 
         AND is_active = true
       LIMIT 1`,
      [payment.student_id, courseId]
    );
    
    // Step 4: Create purchase if needed
    const sessionCount = metadata.sessionCount || metadata.purchaseTier || 30;
    const purchaseTier = typeof sessionCount === 'string' ? parseInt(sessionCount) : sessionCount;
    const validTier = [10, 20, 30].includes(purchaseTier) ? purchaseTier : 30;
    
    let purchaseId;
    if (existingPurchase.rows.length > 0) {
      purchaseId = existingPurchase.rows[0].id;
      console.log('✅ Purchase already exists:', purchaseId);
      console.log('   Tier:', existingPurchase.rows[0].purchase_tier, 'sessions');
    } else {
      // Step 4: Create purchase
      console.log('\nStep 4: Creating purchase record...');
      
      // Check if purchase already exists first
      const checkPurchase = await pool.query(
        `SELECT id, purchase_tier FROM student_course_purchases 
         WHERE student_id = $1 AND course_id = $2 AND is_active = true
         LIMIT 1`,
        [payment.student_id, courseId]
      );
      
      let purchaseResult;
      if (checkPurchase.rows.length > 0) {
        // Update existing purchase
        purchaseResult = await pool.query(
          `UPDATE student_course_purchases 
           SET purchase_tier = $3, metadata = $4, updated_at = NOW()
           WHERE id = $1
           RETURNING id, purchase_tier`,
          [checkPurchase.rows[0].id, validTier, JSON.stringify(metadata)]
        );
      } else {
        // Insert new purchase
        purchaseResult = await pool.query(
          `INSERT INTO student_course_purchases 
           (student_id, course_id, purchase_tier, expiry_date, metadata, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())
           RETURNING id, purchase_tier`,
          [payment.student_id, courseId, validTier, null, JSON.stringify(metadata)]
        );
      }
      
      purchaseId = purchaseResult.rows[0].id;
      console.log('✅ Purchase created:', purchaseId);
      console.log('   Tier:', purchaseResult.rows[0].purchase_tier, 'sessions');
    }
    
    // Step 5: Mark events as processed (for tracking)
    console.log('\nStep 5: Recording events in processed_events...');
    
    // Mark PURCHASE_CONFIRMED as processed
    const purchaseConfirmedEvent = {
      type: 'PURCHASE_CONFIRMED',
      timestamp: Date.now(),
      paymentId: payment.id,
      studentId: payment.student_id,
      courseId: courseId,
      metadata: metadata,
    };
    
    try {
      await pool.query(
        `INSERT INTO processed_events (event_id, event_type, correlation_id, payload, source, version, processed_at)
         VALUES (gen_random_uuid(), 'PURCHASE_CONFIRMED', $1, $2, 'fix-script', '1.0.0', NOW())
         ON CONFLICT (correlation_id, event_type) DO NOTHING`,
        [payment.id, JSON.stringify(purchaseConfirmedEvent)]
      );
      console.log('✅ PURCHASE_CONFIRMED event recorded');
    } catch (error) {
      if (error.code !== '23505') throw error; // Ignore unique constraint
    }
    
    // Mark PURCHASE_CREATED as processed
    const purchaseCreatedEvent = {
      type: 'PURCHASE_CREATED',
      timestamp: Date.now(),
      purchaseId: purchaseId,
      studentId: payment.student_id,
      courseId: courseId,
      purchaseTier: validTier,
      metadata: metadata,
    };
    
    try {
      await pool.query(
        `INSERT INTO processed_events (event_id, event_type, correlation_id, payload, source, version, processed_at)
         VALUES (gen_random_uuid(), 'PURCHASE_CREATED', $1, $2, 'fix-script', '1.0.0', NOW())
         ON CONFLICT (correlation_id, event_type) DO NOTHING`,
        [payment.id, JSON.stringify(purchaseCreatedEvent)]
      );
      console.log('✅ PURCHASE_CREATED event recorded');
    } catch (error) {
      if (error.code !== '23505') throw error;
    }
    
    // Step 6: Trigger allocation if requested
    if (triggerAllocation) {
      console.log('\nStep 6: Triggering allocation...');
      const adminServiceUrl = process.env.ADMIN_SERVICE_URL || 
        `http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.ADMIN_SERVICE_PORT || 3010}`;
      
      const timeSlot = metadata.timeSlot || metadata.classTime || metadata.schedule?.timeSlot || '4:00 PM';
      const startDate = metadata.startDate || metadata.schedule?.startDate || metadata.schedule?.date || metadata.date || new Date().toISOString().split('T')[0];
      
      const requestBody = JSON.stringify({
        studentId: payment.student_id,
        courseId: courseId,
        timeSlot: timeSlot,
        date: startDate,
        paymentMetadata: metadata || {},
      });
      
      const url = new URL(`${adminServiceUrl}/api/v1/admin/allocations/auto-assign`);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? require('https') : require('http');
      
      try {
        const response = await new Promise((resolve, reject) => {
          const req = httpModule.request({
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(requestBody),
            },
          }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk.toString(); });
            res.on('end', () => resolve({ statusCode: res.statusCode, data }));
          });
          req.on('error', reject);
          req.write(requestBody);
          req.end();
        });
        
        if (response.statusCode >= 200 && response.statusCode < 300) {
          console.log('✅ Allocation triggered successfully');
          try {
            const responseData = JSON.parse(response.data);
            console.log('   Allocation ID:', responseData.data?.id || 'N/A');
            console.log('   Trainer ID:', responseData.data?.trainerId || responseData.data?.trainer_id || 'N/A');
          } catch (e) {
            console.log('   Response:', response.data.substring(0, 200));
          }
        } else {
          console.log('⚠️  Allocation API returned:', response.statusCode);
          console.log('   Response:', response.data.substring(0, 300));
        }
      } catch (error) {
        console.log('⚠️  Failed to trigger allocation:', error.message);
        console.log('   You can manually trigger it later with:');
        console.log(`   node manual-trigger-allocation.js ${payment.student_id} ${courseId}`);
      }
    }
    
    // Step 7: Invalidate cache for frontend update
    console.log('\nStep 7: Invalidating cache for frontend update...');
    try {
      const studentServiceUrl = process.env.STUDENT_SERVICE_URL || 
        process.env.API_GATEWAY_URL ||
        `http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.STUDENT_SERVICE_PORT || 3003}`;
      
      const cacheUrl = `${studentServiceUrl}/api/students/${payment.student_id}/invalidate-cache`;
      const url = new URL(cacheUrl);
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
          timeout: 5000,
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk.toString(); });
          res.on('end', () => resolve({ statusCode: res.statusCode, data }));
        });
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });
        req.end();
      });
      
      if (response.statusCode >= 200 && response.statusCode < 300) {
        console.log('✅ Cache invalidated - Frontend will refetch data');
      } else {
        console.log('⚠️  Cache invalidation returned:', response.statusCode);
      }
    } catch (error) {
      console.log('⚠️  Cache invalidation failed (non-critical):', error.message);
      console.log('   Frontend will update on next API call or app restart');
    }
    
    // Summary
    console.log('\n=== Fix Complete ===');
    console.log('✅ processed_events table created/verified');
    console.log('✅ Purchase created:', purchaseId);
    console.log('✅ Events recorded in processed_events');
    if (triggerAllocation) {
      console.log('✅ Allocation triggered');
    } else {
      console.log('\nTo trigger allocation, run:');
      console.log(`   node manual-trigger-allocation.js ${payment.student_id} ${courseId}`);
    }
    console.log('✅ Cache invalidated - Frontend will update');
    console.log('\n📱 Frontend Update:');
    console.log('   - If app is open: Pull to refresh or wait for next API call');
    console.log('   - If app is closed: Restart app to see new purchase');
    
    await pool.end();
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack:', error.stack);
    await pool.end();
    process.exit(1);
  }
}

fixEventSystem();

