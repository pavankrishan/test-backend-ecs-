/**
 * Diagnostic script to check payment status and course purchase creation
 * Usage: node diagnose-payment-issue.js [paymentId]
 */

const { Pool } = require('pg');
require('dotenv').config();

// Helper function to create database connection
function createDatabasePool(dbType = 'default') {
  // Support connection string (DATABASE_URL, POSTGRES_URL, POSTGRES_URI)
  const connectionString = 
    (dbType === 'payment' && process.env.PAYMENT_DATABASE_URL) ||
    (dbType === 'course' && process.env.COURSE_DATABASE_URL) ||
    process.env.DATABASE_URL || 
    process.env.POSTGRES_URL || 
    process.env.POSTGRES_URI;
  
  const useSSL = process.env.POSTGRES_SSL === 'true' || process.env.CLOUD_DATABASE === 'true';
  
  if (connectionString) {
    // Parse connection string and add SSL if needed
    let finalConnectionString = connectionString;
    
    // If SSL is required but not in connection string, add it
    if (useSSL && !/sslmode=/.test(connectionString)) {
      const separator = connectionString.includes('?') ? '&' : '?';
      finalConnectionString = `${connectionString}${separator}sslmode=require`;
    }
    
    return new Pool({
      connectionString: finalConnectionString,
      ssl: useSSL ? { rejectUnauthorized: false } : undefined,
      max: 5,
    });
  } else {
    // Fallback to individual environment variables
    return new Pool({
      host: process.env.DB_HOST || process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || process.env.POSTGRES_PORT || '5432'),
      database: process.env.DB_NAME || process.env.POSTGRES_DB || 'koding_caravan',
      user: process.env.DB_USER || process.env.POSTGRES_USER || 'postgres',
      password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || 'postgres',
      ssl: useSSL ? { rejectUnauthorized: false } : undefined,
      max: 5,
    });
  }
}

// Database connections (both services typically use the same database)
const paymentPool = createDatabasePool('payment');
const coursePool = createDatabasePool('course');

async function diagnosePayment(paymentId) {
  try {
    console.log('🔍 Diagnosing payment issue...\n');
    console.log(`Payment ID: ${paymentId}\n`);

    // Test database connection first
    try {
      await paymentPool.query('SELECT 1');
      console.log('✅ Payment database connection successful\n');
    } catch (dbError) {
      console.error('❌ Database connection failed!');
      console.error('Error:', dbError.message);
      console.error('\n💡 Please check your .env file:');
      console.error('   - DATABASE_URL or POSTGRES_URL');
      console.error('   - Or set: POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB');
      console.error('\n   If using connection string, ensure password is properly encoded.');
      process.exit(1);
    }

    // 1. Check payment status
    console.log('1️⃣ Checking payment status...');
    const paymentResult = await paymentPool.query(
      `SELECT id, student_id, amount_cents, status, metadata, created_at, confirmed_at
       FROM payments
       WHERE id = $1`,
      [paymentId]
    );

    if (paymentResult.rows.length === 0) {
      console.error('❌ Payment not found!');
      process.exit(1);
    }

    const payment = paymentResult.rows[0];
    console.log(`   Status: ${payment.status}`);
    console.log(`   Student ID: ${payment.student_id}`);
    console.log(`   Amount: ₹${(payment.amount_cents / 100).toFixed(2)}`);
    console.log(`   Created: ${payment.created_at}`);
    console.log(`   Confirmed: ${payment.confirmed_at || 'Not confirmed'}`);
    
    const metadata = payment.metadata || {};
    const courseId = metadata.courseId;
    console.log(`   Course ID in metadata: ${courseId || '❌ MISSING!'}`);
    console.log(`   Session Count: ${metadata.sessionCount || 'N/A'}`);
    console.log(`   Purchase Tier: ${metadata.purchaseTier || 'N/A'}`);
    console.log('');

    if (payment.status !== 'succeeded') {
      console.error('❌ Payment is not succeeded! Status:', payment.status);
      console.log('   The course will only be created after payment succeeds.');
      process.exit(1);
    }

    if (!courseId) {
      console.error('❌ CRITICAL: courseId is missing from payment metadata!');
      console.log('   This is why the course was not created.');
      console.log('   The enrollment process requires courseId to be in payment metadata.');
      process.exit(1);
    }

    // 2. Check if purchase record exists
    console.log('2️⃣ Checking for course purchase record...');
    const purchaseResult = await coursePool.query(
      `SELECT id, student_id, course_id, purchase_tier, is_active, purchase_date, metadata
       FROM student_course_purchases
       WHERE student_id = $1 AND course_id = $2
       ORDER BY created_at DESC`,
      [payment.student_id, courseId]
    );

    if (purchaseResult.rows.length === 0) {
      console.log('   ❌ No purchase record found!');
      console.log('   This means the course purchase was not created after payment.');
      console.log('');
      console.log('   🔧 SOLUTION: Run the createCoursePurchase script:');
      console.log(`   cd services/admin-service && npm run create-purchase ${payment.student_id} ${courseId} ${metadata.sessionCount || metadata.purchaseTier || 30}`);
      console.log('');
    } else {
      const purchase = purchaseResult.rows[0];
      console.log(`   ✅ Purchase record found:`);
      console.log(`      Purchase ID: ${purchase.id}`);
      console.log(`      Purchase Tier: ${purchase.purchase_tier} sessions`);
      console.log(`      Is Active: ${purchase.is_active}`);
      console.log(`      Purchase Date: ${purchase.purchase_date}`);
      
      if (!purchase.is_active) {
        console.log('   ⚠️  WARNING: Purchase record exists but is INACTIVE!');
        console.log('   This might be why the course is not showing up.');
      }
      console.log('');
    }

    // 3. Check student progress (enrollment)
    console.log('3️⃣ Checking student enrollment/progress...');
    const progressResult = await coursePool.query(
      `SELECT COUNT(*) as count
       FROM student_progress
       WHERE student_id = $1 AND course_id = $2`,
      [payment.student_id, courseId]
    );

    const progressCount = parseInt(progressResult.rows[0].count);
    console.log(`   Progress records: ${progressCount}`);
    
    if (progressCount === 0) {
      console.log('   ⚠️  No progress records found. Student may not be enrolled.');
    } else {
      console.log('   ✅ Student has progress records (enrolled).');
    }
    console.log('');

    // 4. Check allocations
    console.log('4️⃣ Checking trainer allocations...');
    const allocationResult = await coursePool.query(
      `SELECT 
         ta.id, 
         ta.trainer_id, 
         ta.status,
         scp.purchase_tier as session_count
       FROM trainer_allocations ta
       LEFT JOIN student_course_purchases scp 
         ON ta.student_id = scp.student_id 
         AND ta.course_id = scp.course_id 
         AND scp.is_active = true
       WHERE ta.student_id = $1 AND ta.course_id = $2
       ORDER BY ta.created_at DESC
       LIMIT 1`,
      [payment.student_id, courseId]
    );

    if (allocationResult.rows.length === 0) {
      console.log('   ⚠️  No allocation found. Trainer may not be assigned yet.');
    } else {
      const allocation = allocationResult.rows[0];
      console.log(`   ✅ Allocation found:`);
      console.log(`      Allocation ID: ${allocation.id}`);
      console.log(`      Trainer ID: ${allocation.trainer_id || 'Not assigned'}`);
      console.log(`      Status: ${allocation.status}`);
      console.log(`      Session Count: ${allocation.session_count || 'N/A (purchase not found)'}`);
    }
    console.log('');

    // 5. Summary and recommendations
    console.log('📊 SUMMARY:');
    console.log('');
    
    if (purchaseResult.rows.length === 0) {
      console.log('❌ ISSUE: Course purchase record was NOT created after payment.');
      console.log('');
      console.log('🔧 RECOMMENDED FIX:');
      console.log('   1. Check payment service logs for errors during enrollment');
      console.log('   2. Check if course service is accessible from payment service');
      console.log('   3. Manually create purchase using the script:');
      console.log(`      cd services/admin-service && npm run create-purchase ${payment.student_id} ${courseId} ${metadata.sessionCount || metadata.purchaseTier || 30}`);
      console.log('');
    } else if (!purchaseResult.rows[0].is_active) {
      console.log('⚠️  ISSUE: Purchase record exists but is INACTIVE.');
      console.log('');
      console.log('🔧 RECOMMENDED FIX:');
      console.log('   Activate the purchase record:');
      console.log(`   UPDATE student_course_purchases SET is_active = true WHERE id = '${purchaseResult.rows[0].id}';`);
      console.log('');
    } else {
      console.log('✅ Purchase record exists and is active.');
      console.log('   If course is still not showing, check:');
      console.log('   - Student bootstrap data refresh');
      console.log('   - Frontend cache');
      console.log('   - Course service API availability');
      console.log('');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  } finally {
    await paymentPool.end();
    await coursePool.end();
  }
}

// Get payment ID from command line
const paymentId = process.argv[2];

if (!paymentId) {
  console.error('❌ Please provide a payment ID');
  console.log('Usage: node diagnose-payment-issue.js <paymentId>');
  process.exit(1);
}

diagnosePayment(paymentId);

