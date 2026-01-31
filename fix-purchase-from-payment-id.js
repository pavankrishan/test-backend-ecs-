// Script to check and fix missing purchase for a payment
// Usage: node fix-purchase-from-payment-id.js <paymentId>

const { Pool } = require('pg');
require('dotenv').config();

const paymentId = process.argv[2];

if (!paymentId) {
  console.error('❌ Payment ID is required');
  console.log('Usage: node fix-purchase-from-payment-id.js <paymentId>');
  process.exit(1);
}

const POSTGRES_URL = process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL or DATABASE_URL environment variable is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: POSTGRES_URL,
  ssl: POSTGRES_URL.includes('render.com') || POSTGRES_URL.includes('amazonaws.com') 
    ? { rejectUnauthorized: false } 
    : false,
});

async function checkAndFixPurchase() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    console.log(`\n🔍 Checking payment: ${paymentId}...`);
    
    // 1. Fetch payment record
    const paymentResult = await client.query(
      `SELECT id, student_id, status, amount_cents, currency, metadata, provider_payment_id, confirmed_at
       FROM payments 
       WHERE id = $1`,
      [paymentId]
    );

    if (paymentResult.rows.length === 0) {
      throw new Error(`Payment ${paymentId} not found`);
    }

    const payment = paymentResult.rows[0];
    console.log(`✅ Payment found:`);
    console.log(`   Student ID: ${payment.student_id}`);
    console.log(`   Status: ${payment.status}`);
    console.log(`   Amount: ${payment.amount_cents} ${payment.currency}`);
    console.log(`   Confirmed at: ${payment.confirmed_at}`);

    if (payment.status !== 'succeeded') {
      console.log(`\n⚠️  Payment status is '${payment.status}', not 'succeeded'`);
      console.log(`   Cannot create purchase for non-succeeded payment`);
      await client.query('ROLLBACK');
      return;
    }

    // Parse metadata
    let metadata = {};
    if (payment.metadata) {
      metadata = typeof payment.metadata === 'string' 
        ? JSON.parse(payment.metadata) 
        : payment.metadata;
    }

    const courseId = metadata.courseId || metadata.course_id;
    if (!courseId) {
      throw new Error('Course ID not found in payment metadata');
    }

    const sessionCount = metadata.sessionCount || metadata.purchaseTier || 30;
    const studentId = payment.student_id;

    console.log(`\n📋 Purchase details:`);
    console.log(`   Course ID: ${courseId}`);
    console.log(`   Session Count: ${sessionCount}`);
    console.log(`   Student ID: ${studentId}`);

    // 2. Check if purchase already exists
    const existingPurchase = await client.query(
      `SELECT id, purchase_tier, created_at FROM student_course_purchases 
       WHERE student_id = $1 AND course_id = $2 AND is_active = true`,
      [studentId, courseId]
    );

    if (existingPurchase.rows.length > 0) {
      console.log(`\n✅ Purchase already exists!`);
      console.log(`   Purchase ID: ${existingPurchase.rows[0].id}`);
      console.log(`   Purchase Tier: ${existingPurchase.rows[0].purchase_tier}`);
      console.log(`   Created at: ${existingPurchase.rows[0].created_at}`);
      await client.query('ROLLBACK');
      return;
    }

    // 3. Check processed_events
    const processedEvents = await client.query(
      `SELECT event_id, source, processed_at FROM processed_events 
       WHERE correlation_id = $1 AND event_type = $2`,
      [paymentId, 'PURCHASE_CONFIRMED']
    );

    console.log(`\n📊 Processed Events:`);
    if (processedEvents.rows.length > 0) {
      processedEvents.rows.forEach((event, idx) => {
        console.log(`   Event ${idx + 1}:`);
        console.log(`     Event ID: ${event.event_id}`);
        console.log(`     Source: ${event.source}`);
        console.log(`     Processed at: ${event.processed_at}`);
      });
    } else {
      console.log(`   No processed events found`);
    }

    // 4. Create purchase record
    console.log(`\n🛒 Creating purchase record...`);
    
    // Calculate expiry date (30 days from now if not specified)
    const expiryDate = metadata.expiryDate || metadata.expiry_date || null;
    
    // Try to insert purchase (handle case where constraint might not exist)
    let purchaseResult;
    try {
      purchaseResult = await client.query(
        `INSERT INTO student_course_purchases 
         (student_id, course_id, purchase_tier, expiry_date, metadata, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())
         ON CONFLICT (student_id, course_id) WHERE is_active = true
         DO UPDATE SET updated_at = NOW()
         RETURNING id, purchase_tier, created_at`,
        [studentId, courseId, sessionCount, expiryDate, JSON.stringify(metadata)]
      );
    } catch (error) {
      // If ON CONFLICT fails (constraint doesn't exist), rollback and retry with simple INSERT
      if (error.code === '42P10' || error.message.includes('ON CONFLICT')) {
        console.log(`   ⚠️  ON CONFLICT constraint not found, rolling back and retrying with simple INSERT...`);
        await client.query('ROLLBACK');
        await client.query('BEGIN');
        purchaseResult = await client.query(
          `INSERT INTO student_course_purchases 
           (student_id, course_id, purchase_tier, expiry_date, metadata, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())
           RETURNING id, purchase_tier, created_at`,
          [studentId, courseId, sessionCount, expiryDate, JSON.stringify(metadata)]
        );
      } else {
        throw error;
      }
    }

    if (purchaseResult.rows.length === 0) {
      throw new Error('Failed to create purchase record');
    }

    const purchase = purchaseResult.rows[0];
    console.log(`\n✅ Purchase created successfully!`);
    console.log(`   Purchase ID: ${purchase.id}`);
    console.log(`   Purchase Tier: ${purchase.purchase_tier}`);
    console.log(`   Created at: ${purchase.created_at}`);

    // 5. Mark event as processed if not already
    if (processedEvents.rows.length === 0) {
      console.log(`\n📝 Marking event as processed...`);
      const eventId = `purchase-confirmed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await client.query(
        `INSERT INTO processed_events (event_id, event_type, correlation_id, payload, source, version, processed_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (correlation_id, event_type) DO NOTHING`,
        [
          eventId,
          'PURCHASE_CONFIRMED',
          paymentId,
          JSON.stringify({
            type: 'PURCHASE_CONFIRMED',
            paymentId,
            studentId,
            courseId,
            metadata,
          }),
          'fix-purchase-script',
          '1.0.0',
        ]
      );
      console.log(`   Event marked as processed`);
    }

    await client.query('COMMIT');
    console.log(`\n✅ Transaction committed successfully!`);
    console.log(`\n📝 Next steps:`);
    console.log(`   1. Purchase record created: ${purchase.id}`);
    console.log(`   2. Clear cache for student: ${studentId}`);
    console.log(`   3. Frontend should refresh automatically on next API call`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`\n❌ Error:`, error.message);
    console.error(error.stack);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

checkAndFixPurchase().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

