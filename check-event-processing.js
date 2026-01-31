// Script to check why PURCHASE_CONFIRMED event wasn't processed
// Usage: node check-event-processing.js <paymentId>
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Try to load .env file if it exists
function loadEnvFile() {
  const envFiles = [
    '.env.production',
    '.env.development',
    '.env.local',
    '.env'
  ];
  
  for (const envFile of envFiles) {
    const envPath = path.join(__dirname, envFile);
    if (fs.existsSync(envPath)) {
      console.log(`Loading environment from ${envFile}...`);
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          if (key && valueParts.length > 0) {
            const value = valueParts.join('=').replace(/^["']|["']$/g, '');
            if (!process.env[key]) {
              process.env[key] = value;
            }
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

async function checkEventProcessing() {
  try {
    console.log('=== PURCHASE_CONFIRMED Event Processing Check ===\n');
    console.log(`Payment ID: ${paymentId}\n`);
    
    // Step 1: Check payment
    console.log('Step 1: Checking payment...');
    const paymentResult = await pool.query(
      `SELECT id, student_id, status, confirmed_at, metadata
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
    console.log('✅ Payment found');
    console.log('   Status:', payment.status);
    console.log('   Confirmed:', payment.confirmed_at);
    console.log('   Student ID:', payment.student_id);
    
    if (payment.status !== 'succeeded') {
      console.log('⚠️  Payment is not succeeded, so event would not be emitted');
      await pool.end();
      return;
    }
    
    // Step 2: Check if event was emitted (check processed_events)
    console.log('\nStep 2: Checking if PURCHASE_CONFIRMED event was processed...');
    const eventsResult = await pool.query(
      `SELECT event_type, correlation_id, event_id, source, processed_at, error_message
       FROM processed_events
       WHERE correlation_id = $1
         AND event_type = 'PURCHASE_CONFIRMED'
       ORDER BY processed_at DESC
       LIMIT 5`,
      [paymentId]
    );
    
    if (eventsResult.rows.length === 0) {
      console.log('❌ PURCHASE_CONFIRMED event NOT found in processed_events');
      console.log('   → This means either:');
      console.log('     1. Event was never emitted from payment service');
      console.log('     2. Event was emitted but not consumed by purchase-worker');
      console.log('     3. Event was consumed but failed to process');
    } else {
      const event = eventsResult.rows[0];
      console.log('✅ PURCHASE_CONFIRMED event found in processed_events');
      console.log('   Event ID:', event.event_id);
      console.log('   Source:', event.source);
      console.log('   Processed at:', event.processed_at);
      if (event.error_message) {
        console.log('   ⚠️  Error:', event.error_message);
      }
    }
    
    // Step 3: Check if purchase was created
    console.log('\nStep 3: Checking if purchase was created...');
    const metadata = typeof payment.metadata === 'string' 
      ? JSON.parse(payment.metadata)
      : payment.metadata;
    
    const courseId = metadata?.courseId;
    if (!courseId) {
      console.log('⚠️  Course ID not found in payment metadata');
      await pool.end();
      return;
    }
    
    const purchaseResult = await pool.query(
      `SELECT id, purchase_tier, created_at
       FROM student_course_purchases 
       WHERE student_id = $1 
         AND course_id = $2 
         AND is_active = true
       LIMIT 1`,
      [payment.student_id, courseId]
    );
    
    if (purchaseResult.rows.length === 0) {
      console.log('❌ Purchase NOT created');
      console.log('   → This confirms the PURCHASE_CONFIRMED event was not processed');
    } else {
      const purchase = purchaseResult.rows[0];
      console.log('✅ Purchase exists:', purchase.id);
      console.log('   Tier:', purchase.purchase_tier, 'sessions');
      console.log('   Created:', purchase.created_at);
    }
    
    // Step 4: Check for PURCHASE_CREATED event
    console.log('\nStep 4: Checking if PURCHASE_CREATED event was emitted...');
    const purchaseCreatedResult = await pool.query(
      `SELECT event_type, correlation_id, source, processed_at
       FROM processed_events
       WHERE correlation_id = $1
         AND event_type = 'PURCHASE_CREATED'
       ORDER BY processed_at DESC
       LIMIT 1`,
      [paymentId]
    );
    
    if (purchaseCreatedResult.rows.length === 0) {
      console.log('❌ PURCHASE_CREATED event NOT found');
      console.log('   → This confirms purchase-worker did not process the event');
    } else {
      console.log('✅ PURCHASE_CREATED event found');
      console.log('   Processed at:', purchaseCreatedResult.rows[0].processed_at);
    }
    
    // Step 5: Summary and recommendations
    console.log('\n=== Summary & Recommendations ===');
    
    const eventProcessed = eventsResult.rows.length > 0;
    const purchaseExists = purchaseResult.rows.length > 0;
    
    if (!eventProcessed && !purchaseExists) {
      console.log('🔍 Root Cause: PURCHASE_CONFIRMED event was never processed');
      console.log('\nPossible reasons:');
      console.log('1. Purchase-worker is not running');
      console.log('2. Kafka is not running or misconfigured');
      console.log('3. Event was never emitted from payment service');
      console.log('4. Consumer group issue');
      console.log('\n✅ Solutions:');
      console.log('1. Check if purchase-worker is running:');
      console.log('   docker ps | grep purchase-worker');
      console.log('2. Check Kafka is running:');
      console.log('   docker ps | grep kafka');
      console.log('3. Check purchase-worker logs:');
      console.log('   docker logs kodingcaravan-purchase-worker | tail -50');
      console.log('4. Manually create purchase:');
      console.log(`   node manual-create-purchase.js ${paymentId}`);
    } else if (eventProcessed && !purchaseExists) {
      console.log('🔍 Root Cause: Event was processed but purchase creation failed');
      console.log('\n✅ Solution: Manually create purchase:');
      console.log(`   node manual-create-purchase.js ${paymentId}`);
    } else if (purchaseExists) {
      console.log('✅ Purchase exists - no action needed');
    }
    
    await pool.end();
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack:', error.stack);
    await pool.end();
    process.exit(1);
  }
}

checkEventProcessing();

