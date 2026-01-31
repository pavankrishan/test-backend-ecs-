/**
 * Manual Purchase Creation Script
 * 
 * Creates purchase record for a payment that succeeded but purchase wasn't created.
 * This handles the case where the event was marked as processed but purchase creation failed.
 * 
 * Usage:
 *   node fix-missing-purchase-manual.js <paymentId>
 * 
 * Example:
 *   node fix-missing-purchase-manual.js ca9eb275-2a69-4f89-b4cf-a077937949f1
 */

const { Pool } = require('pg');
require('dotenv').config();

const POSTGRES_URL = process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL or DATABASE_URL environment variable is required');
  process.exit(1);
}

const paymentId = process.argv[2];

if (!paymentId) {
  console.error('❌ Payment ID is required');
  console.log('Usage: node fix-missing-purchase-manual.js <paymentId>');
  process.exit(1);
}

const pool = new Pool({
  connectionString: POSTGRES_URL,
  ssl: POSTGRES_URL.includes('render.com') || POSTGRES_URL.includes('amazonaws.com') 
    ? { rejectUnauthorized: false } 
    : false,
});

async function createPurchaseFromPayment() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    console.log(`\n🔍 Fetching payment: ${paymentId}...`);
    
    // 1. Fetch payment record
    const paymentResult = await client.query(
      `SELECT id, student_id, status, amount_cents, currency, metadata, provider_payment_id, confirmed_at
       FROM payments 
       WHERE id = $1 AND status = 'succeeded'`,
      [paymentId]
    );

    if (paymentResult.rows.length === 0) {
      throw new Error(`Payment ${paymentId} not found or not succeeded`);
    }

    const payment = paymentResult.rows[0];
    console.log(`✅ Payment found:`);
    console.log(`   Student ID: ${payment.student_id}`);
    console.log(`   Status: ${payment.status}`);
    console.log(`   Amount: ${payment.amount_cents} ${payment.currency}`);
    console.log(`   Confirmed at: ${payment.confirmed_at}`);

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
      `SELECT id FROM student_course_purchases 
       WHERE student_id = $1 AND course_id = $2 AND is_active = true`,
      [studentId, courseId]
    );

    if (existingPurchase.rows.length > 0) {
      console.log(`\n⚠️  Purchase already exists!`);
      console.log(`   Purchase ID: ${existingPurchase.rows[0].id}`);
      await client.query('ROLLBACK');
      return;
    }

    // 3. Create purchase record
    console.log(`\n🛒 Creating purchase record...`);
    
    // Try to insert purchase (without ON CONFLICT since constraint might not exist)
    let purchaseResult;
    try {
      purchaseResult = await client.query(
        `INSERT INTO student_course_purchases 
         (student_id, course_id, purchase_tier, expiry_date, metadata, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())
         RETURNING id, purchase_tier, created_at`,
        [studentId, courseId, sessionCount, null, JSON.stringify(metadata)]
      );
    } catch (insertError) {
      // If unique constraint violation, purchase already exists
      if (insertError.code === '23505' || insertError.message.includes('unique constraint') || insertError.message.includes('duplicate key')) {
        console.log(`\n⚠️  Purchase already exists (caught by constraint)`);
        const existingPurchase = await client.query(
          `SELECT id, purchase_tier, created_at FROM student_course_purchases 
           WHERE student_id = $1 AND course_id = $2 AND is_active = true`,
          [studentId, courseId]
        );
        if (existingPurchase.rows.length > 0) {
          console.log(`   Purchase ID: ${existingPurchase.rows[0].id}`);
          await client.query('ROLLBACK');
          return;
        }
      }
      throw insertError;
    }

    if (purchaseResult.rows.length === 0) {
      throw new Error('Failed to create purchase record');
    }

    const purchase = purchaseResult.rows[0];
    console.log(`✅ Purchase created successfully!`);
    console.log(`   Purchase ID: ${purchase.id}`);
    console.log(`   Purchase Tier: ${purchase.purchase_tier}`);
    console.log(`   Created at: ${purchase.created_at}`);

    // 4. Commit transaction
    await client.query('COMMIT');
    
    console.log(`\n✅ Transaction committed successfully!`);
    console.log(`\n📝 Next steps:`);
    console.log(`   1. Purchase record created: ${purchase.id}`);
    console.log(`   2. Allocation worker should create trainer allocation`);
    console.log(`   3. Session worker should create ${sessionCount} sessions`);
    console.log(`   4. Frontend should refresh to see the course`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await createPurchaseFromPayment();
    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Failed to create purchase: ${error.message}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

