// Check why purchase wasn't created automatically
// Usage: node check-purchase-event-flow.js <paymentId>

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

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

const paymentId = process.argv[2] || '5dc56599-cd44-4672-ab73-2bf7f789ef34';

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

async function checkFlow() {
  try {
    console.log('=== Checking Purchase Event Flow ===\n');
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
    console.log('   Confirmed:', payment.confirmed_at || 'Not confirmed');
    console.log('   Student ID:', payment.student_id);
    
    const metadata = typeof payment.metadata === 'string' 
      ? JSON.parse(payment.metadata)
      : payment.metadata;
    const courseId = metadata?.courseId;
    
    if (!courseId) {
      console.log('❌ No courseId in payment metadata');
      await pool.end();
      return;
    }
    
    console.log('   Course ID:', courseId);
    
    // Step 2: Check if PURCHASE_CONFIRMED event was emitted
    console.log('\nStep 2: Checking if PURCHASE_CONFIRMED event was emitted...');
    const eventResult = await pool.query(
      `SELECT event_id, event_type, correlation_id, source, processed_at, error_message
       FROM processed_events
       WHERE correlation_id = $1 
         AND event_type = 'PURCHASE_CONFIRMED'
       ORDER BY processed_at DESC
       LIMIT 1`,
      [paymentId]
    );
    
    if (eventResult.rows.length === 0) {
      console.log('❌ PURCHASE_CONFIRMED event NOT found in processed_events');
      console.log('   → This means payment-service did NOT emit the event');
      console.log('   → Possible reasons:');
      console.log('     1. Event emission failed (check payment-service logs)');
      console.log('     2. Kafka connection failed');
      console.log('     3. IdempotentEventEmitter threw error');
      console.log('     4. Payment was already succeeded (event only emitted on status change)');
      
      // Check if payment was already succeeded when confirmed
      if (payment.status === 'succeeded' && payment.confirmed_at) {
        console.log('\n   💡 Payment status check:');
        console.log('      Payment is succeeded, but event might not have been emitted');
        console.log('      if payment was already succeeded before confirmPayment() was called.');
      }
    } else {
      const event = eventResult.rows[0];
      console.log('✅ PURCHASE_CONFIRMED event found');
      console.log('   Event ID:', event.event_id);
      console.log('   Source:', event.source);
      console.log('   Processed:', event.processed_at);
      if (event.error_message) {
        console.log('   ⚠️  Error:', event.error_message);
      }
    }
    
    // Step 3: Check if purchase-worker processed it
    console.log('\nStep 3: Checking if purchase-worker processed the event...');
    const purchaseCreatedEvent = await pool.query(
      `SELECT event_id, event_type, correlation_id, source, processed_at, error_message
       FROM processed_events
       WHERE correlation_id = $1 
         AND event_type = 'PURCHASE_CREATED'
       ORDER BY processed_at DESC
       LIMIT 1`,
      [paymentId]
    );
    
    if (purchaseCreatedEvent.rows.length === 0) {
      console.log('❌ PURCHASE_CREATED event NOT found');
      console.log('   → This means purchase-worker did NOT process PURCHASE_CONFIRMED');
      console.log('   → Possible reasons:');
      console.log('     1. purchase-worker is not running');
      console.log('     2. Kafka consumer is not connected');
      console.log('     3. Event was not in Kafka topic');
      console.log('     4. purchase-worker failed to process (check logs)');
    } else {
      const event = purchaseCreatedEvent.rows[0];
      console.log('✅ PURCHASE_CREATED event found');
      console.log('   Source:', event.source);
      console.log('   Processed:', event.processed_at);
      if (event.error_message) {
        console.log('   ⚠️  Error:', event.error_message);
      }
    }
    
    // Step 4: Check purchase record
    console.log('\nStep 4: Checking purchase record...');
    const purchaseResult = await pool.query(
      `SELECT id, purchase_tier, created_at
       FROM student_course_purchases 
       WHERE student_id = $1 
         AND course_id = $2 
         AND is_active = true
       ORDER BY created_at DESC 
       LIMIT 1`,
      [payment.student_id, courseId]
    );
    
    if (purchaseResult.rows.length === 0) {
      console.log('❌ Purchase record NOT found');
      console.log('   → This confirms purchase-worker did not create the purchase');
    } else {
      const purchase = purchaseResult.rows[0];
      console.log('✅ Purchase record found');
      console.log('   Purchase ID:', purchase.id);
      console.log('   Tier:', purchase.purchase_tier, 'sessions');
      console.log('   Created:', purchase.created_at);
    }
    
    // Summary
    console.log('\n=== Summary ===');
    const hasPurchaseConfirmed = eventResult.rows.length > 0;
    const hasPurchaseCreated = purchaseCreatedEvent.rows.length > 0;
    const hasPurchase = purchaseResult.rows.length > 0;
    
    if (!hasPurchaseConfirmed) {
      console.log('❌ ROOT CAUSE: PURCHASE_CONFIRMED event was NOT emitted');
      console.log('   → Check payment-service logs for errors');
      console.log('   → Verify Kafka connection in payment-service');
      console.log('   → Check if IdempotentEventEmitter is working');
    } else if (!hasPurchaseCreated) {
      console.log('❌ ROOT CAUSE: purchase-worker did NOT process PURCHASE_CONFIRMED');
      console.log('   → Check if purchase-worker is running: docker ps | grep purchase-worker');
      console.log('   → Check purchase-worker logs: docker logs kodingcaravan-purchase-worker');
      console.log('   → Verify Kafka consumer is connected');
    } else if (!hasPurchase) {
      console.log('❌ ROOT CAUSE: purchase-worker processed event but failed to create purchase');
      console.log('   → Check purchase-worker logs for errors');
      console.log('   → Verify database connection');
    } else {
      console.log('✅ Flow completed successfully');
    }
    
    await pool.end();
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack:', error.stack);
    await pool.end();
    process.exit(1);
  }
}

checkFlow();

