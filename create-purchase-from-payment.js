// Script to manually create purchase record from a confirmed payment
// Usage: node create-purchase-from-payment.js <paymentId>
// This bypasses Kafka and directly creates the purchase record

require('dotenv').config();
const { Pool } = require('pg');

const paymentId = process.argv[2] || 'fb8f4aae-7fb3-43d0-8782-cacbaea2cc8c';

// Use POSTGRES_URL if available, otherwise build from components
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: process.env.POSTGRES_URL || process.env.DATABASE_URL ? {
    rejectUnauthorized: false
  } : false,
});

async function createPurchaseFromPayment() {
  try {
    console.log('🔍 Fetching payment record...');
    console.log('Payment ID:', paymentId);

    // Get payment details
    const paymentResult = await pool.query(
      `SELECT 
        id, 
        student_id, 
        amount_cents, 
        status,
        metadata,
        provider_payment_id,
        confirmed_at
      FROM payments 
      WHERE id = $1`,
      [paymentId]
    );

    if (paymentResult.rows.length === 0) {
      console.error('❌ Payment not found:', paymentId);
      process.exit(1);
    }

    const payment = paymentResult.rows[0];
    console.log('✅ Payment found:', {
      id: payment.id,
      studentId: payment.student_id,
      status: payment.status,
      amountCents: payment.amount_cents,
      confirmedAt: payment.confirmed_at,
    });

    if (payment.status !== 'succeeded') {
      console.error('❌ Payment status is not "succeeded":', payment.status);
      process.exit(1);
    }

    // Parse metadata
    const metadata = typeof payment.metadata === 'string' 
      ? JSON.parse(payment.metadata) 
      : (payment.metadata || {});

    console.log('📦 Payment metadata:', {
      courseId: metadata.courseId,
      sessionCount: metadata.sessionCount,
      purchaseTier: metadata.purchaseTier,
      startDate: metadata.startDate,
      timeSlot: metadata.timeSlot,
    });

    const courseId = metadata.courseId;
    const studentId = payment.student_id;
    const purchaseTier = metadata.purchaseTier || metadata.sessionCount || 30;

    if (!courseId) {
      console.error('❌ Course ID not found in payment metadata');
      process.exit(1);
    }

    // Check if purchase already exists
    const existingPurchase = await pool.query(
      `SELECT id FROM student_course_purchases 
       WHERE student_id = $1 AND course_id = $2 AND is_active = true`,
      [studentId, courseId]
    );

    if (existingPurchase.rows.length > 0) {
      console.log('⚠️  Purchase already exists:', existingPurchase.rows[0].id);
      console.log('✅ Skipping creation');
      process.exit(0);
    }

    // Create purchase record
    console.log('📝 Creating purchase record...');
    const purchaseResult = await pool.query(
      `INSERT INTO student_course_purchases (
        student_id,
        course_id,
        purchase_tier,
        metadata,
        is_active,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING id`,
      [
        studentId,
        courseId,
        purchaseTier,
        JSON.stringify(metadata),
        true,
      ]
    );

    const purchaseId = purchaseResult.rows[0].id;
    console.log('✅ Purchase created successfully!');
    console.log('Purchase ID:', purchaseId);
    console.log('Student ID:', studentId);
    console.log('Course ID:', courseId);
    console.log('Purchase Tier:', purchaseTier);

    // Mark PURCHASE_CONFIRMED event as processed (if not already)
    const eventCheck = await pool.query(
      `SELECT 1 FROM processed_events 
       WHERE correlation_id = $1 AND event_type = $2`,
      [paymentId, 'PURCHASE_CONFIRMED']
    );

    if (eventCheck.rows.length === 0) {
      console.log('📝 Recording PURCHASE_CONFIRMED event as processed...');
      const { randomUUID } = require('crypto');
      await pool.query(
        `INSERT INTO processed_events (
          event_id,
          event_type,
          correlation_id,
          payload,
          source,
          version,
          processed_at,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        ON CONFLICT (correlation_id, event_type) DO NOTHING`,
        [
          randomUUID(),
          'PURCHASE_CONFIRMED',
          paymentId,
          JSON.stringify({
            type: 'PURCHASE_CONFIRMED',
            paymentId,
            studentId,
            courseId,
            metadata,
          }),
          'create-purchase-from-payment-script',
          '1.0.0',
        ]
      );
      console.log('✅ Event recorded');
    } else {
      console.log('ℹ️  Event already recorded');
    }

    // Mark PURCHASE_CREATED event as processed
    console.log('📝 Recording PURCHASE_CREATED event...');
    const { randomUUID } = require('crypto');
    await pool.query(
      `INSERT INTO processed_events (
        event_id,
        event_type,
        correlation_id,
        payload,
        source,
        version,
        processed_at,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      ON CONFLICT (correlation_id, event_type) DO NOTHING`,
      [
        randomUUID(),
        'PURCHASE_CREATED',
        purchaseId,
        JSON.stringify({
          type: 'PURCHASE_CREATED',
          purchaseId,
          studentId,
          courseId,
          purchaseTier,
          metadata,
        }),
        'create-purchase-from-payment-script',
        '1.0.0',
      ]
    );
    console.log('✅ PURCHASE_CREATED event recorded');

    console.log('\n✅ Purchase creation complete!');
    console.log('Next steps:');
    console.log('1. Backend cache will be invalidated on next API call');
    console.log('2. Frontend will refresh data automatically');
    console.log('3. Course should appear in learning screen');

    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

createPurchaseFromPayment();

