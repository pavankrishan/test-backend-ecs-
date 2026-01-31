// Check purchase data in cloud database
const { Pool } = require('pg');

const POSTGRES_URL = process.env.POSTGRES_URL;

const pool = new Pool({
  connectionString: POSTGRES_URL,
  ssl: POSTGRES_URL.includes('render.com') ? { rejectUnauthorized: false } : false,
});

const studentId = '809556c1-e184-4b85-8fd6-a5f1c8014bf6';
const courseId = '9e16d892-4324-4568-be60-163aa1665683';

async function main() {
  try {
    console.log('=== Checking Purchase Data ===\n');
    
    // 1. Check payments table
    console.log('1. Checking payments table...');
    const payments = await pool.query(
      `SELECT id, student_id, amount_cents, status, provider, provider_payment_id, metadata, created_at 
       FROM payments 
       WHERE student_id = $1 
       ORDER BY created_at DESC 
       LIMIT 5`,
      [studentId]
    );
    console.log(`   Found ${payments.rows.length} payments`);
    payments.rows.forEach((p, i) => {
      console.log(`   Payment ${i + 1}:`);
      console.log(`     ID: ${p.id}`);
      console.log(`     Status: ${p.status}`);
      console.log(`     Amount: ${p.amount_cents} cents`);
      console.log(`     Provider: ${p.provider}`);
      console.log(`     Created: ${p.created_at}`);
      if (p.metadata) {
        const meta = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : p.metadata;
        if (meta.courseId) {
          console.log(`     Course ID: ${meta.courseId}`);
        }
      }
    });
    
    // 2. Check student_course_purchases table
    console.log('\n2. Checking student_course_purchases table...');
    const purchases = await pool.query(
      `SELECT id, student_id, course_id, purchase_tier, purchase_date, expiry_date, 
              is_active, metadata, created_at, updated_at
       FROM student_course_purchases 
       WHERE student_id = $1 
       ORDER BY created_at DESC`,
      [studentId]
    );
    console.log(`   Found ${purchases.rows.length} purchases`);
    purchases.rows.forEach((p, i) => {
      console.log(`   Purchase ${i + 1}:`);
      console.log(`     ID: ${p.id}`);
      console.log(`     Course ID: ${p.course_id}`);
      console.log(`     Purchase Tier: ${p.purchase_tier}`);
      console.log(`     Is Active: ${p.is_active}`);
      console.log(`     Created: ${p.created_at}`);
      if (p.course_id === courseId) {
        console.log(`     ✅ MATCHES TARGET COURSE!`);
      }
    });
    
    // 3. Check specific course purchase
    console.log(`\n3. Checking for purchase of course ${courseId}...`);
    const specificPurchase = await pool.query(
      `SELECT * FROM student_course_purchases 
       WHERE student_id = $1 AND course_id = $2 AND is_active = true`,
      [studentId, courseId]
    );
    
    if (specificPurchase.rows.length > 0) {
      console.log(`   ✅ Purchase EXISTS for this course!`);
      console.log(`   Purchase ID: ${specificPurchase.rows[0].id}`);
      console.log(`   Purchase Tier: ${specificPurchase.rows[0].purchase_tier}`);
      console.log(`   Created: ${specificPurchase.rows[0].created_at}`);
    } else {
      console.log(`   ❌ NO ACTIVE PURCHASE found for this course`);
      console.log(`   Need to create purchase record`);
    }
    
    // 4. Check if payment has courseId in metadata
    console.log(`\n4. Checking payment metadata for courseId...`);
    const paymentWithCourse = await pool.query(
      `SELECT id, status, metadata 
       FROM payments 
       WHERE student_id = $1 AND status = 'succeeded'
       ORDER BY created_at DESC 
       LIMIT 1`,
      [studentId]
    );
    
    if (paymentWithCourse.rows.length > 0) {
      const payment = paymentWithCourse.rows[0];
      const metadata = typeof payment.metadata === 'string' ? JSON.parse(payment.metadata) : payment.metadata;
      console.log(`   Payment ID: ${payment.id}`);
      console.log(`   Status: ${payment.status}`);
      if (metadata && metadata.courseId) {
        console.log(`   Course ID in metadata: ${metadata.courseId}`);
        if (metadata.courseId === courseId) {
          console.log(`   ✅ Payment is for the target course!`);
        }
      } else {
        console.log(`   ⚠️  No courseId in payment metadata`);
      }
    }
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

main();

