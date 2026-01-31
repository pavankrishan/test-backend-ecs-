// Script to update existing purchase with metadata from payments table
const { Pool } = require('pg');

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('POSTGRES_URL not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: POSTGRES_URL,
  ssl: POSTGRES_URL.includes('render.com') ? { rejectUnauthorized: false } : false,
});

const studentId = '809556c1-e184-4b85-8fd6-a5f1c8014bf6';
const courseId = '9e16d892-4324-4568-be60-163aa1665683';

async function updatePurchase() {
  try {
    console.log('=== Updating Purchase Metadata ===\n');
    console.log('Student ID:', studentId);
    console.log('Course ID:', courseId);
    console.log('Database:', POSTGRES_URL.split('@')[1]?.split('/')[1] || 'unknown');
    console.log('');
    
    // Step 1: Find the payment
    console.log('Step 1: Finding payment record...');
    const paymentResult = await pool.query(
      `SELECT id, status, metadata, created_at 
       FROM payments 
       WHERE student_id = $1 
         AND status = 'succeeded'
         AND (metadata->>'courseId' = $2 OR metadata->>'course_id' = $2)
       ORDER BY created_at DESC 
       LIMIT 1`,
      [studentId, courseId]
    );
    
    if (paymentResult.rows.length === 0) {
      console.log('❌ No succeeded payment found for this student and course');
      console.log('   Checking all payments for this student...');
      
      const allPayments = await pool.query(
        `SELECT id, status, metadata->>'courseId' as course_id, created_at 
         FROM payments 
         WHERE student_id = $1 
         ORDER BY created_at DESC 
         LIMIT 5`,
        [studentId]
      );
      
      console.log(`   Found ${allPayments.rows.length} payments:`);
      allPayments.rows.forEach((p, i) => {
        console.log(`   ${i + 1}. Payment ${p.id.substring(0, 8)} - Status: ${p.status}, Course: ${p.course_id || 'N/A'}`);
      });
      
      await pool.end();
      return;
    }
    
    const payment = paymentResult.rows[0];
    console.log('✅ Found payment:', payment.id);
    console.log('   Status:', payment.status);
    console.log('   Created:', payment.created_at);
    
    // Parse payment metadata
    const paymentMetadata = typeof payment.metadata === 'string' 
      ? JSON.parse(payment.metadata)
      : payment.metadata;
    
    console.log('   Metadata keys:', Object.keys(paymentMetadata || {}).join(', '));
    
    // Step 2: Find the purchase
    console.log('\nStep 2: Finding purchase record...');
    const purchaseResult = await pool.query(
      `SELECT id, metadata, purchase_tier, created_at, updated_at
       FROM student_course_purchases 
       WHERE student_id = $1 
         AND course_id = $2 
         AND is_active = true
       ORDER BY created_at DESC 
       LIMIT 1`,
      [studentId, courseId]
    );
    
    if (purchaseResult.rows.length === 0) {
      console.log('❌ No active purchase found');
      console.log('   Creating new purchase...');
      
      // Create purchase with payment metadata
      const purchaseTier = paymentMetadata?.purchaseTier || 
                          paymentMetadata?.sessionCount || 
                          30;
      
      const completeMetadata = {
        ...paymentMetadata,
        courseId: courseId,
        purchaseTier: purchaseTier,
        sessionCount: purchaseTier,
      };
      
      const createResult = await pool.query(
        `INSERT INTO student_course_purchases 
         (student_id, course_id, purchase_tier, metadata, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, true, NOW(), NOW())
         RETURNING id`,
        [studentId, courseId, purchaseTier, JSON.stringify(completeMetadata)]
      );
      
      console.log('✅ Purchase created:', createResult.rows[0].id);
      console.log('   Metadata keys:', Object.keys(completeMetadata).join(', '));
      await pool.end();
      return;
    }
    
    const purchase = purchaseResult.rows[0];
    console.log('✅ Found purchase:', purchase.id);
    console.log('   Purchase Tier:', purchase.purchase_tier);
    console.log('   Created:', purchase.created_at);
    
    // Parse current purchase metadata
    const currentMetadata = purchase.metadata && typeof purchase.metadata === 'object'
      ? purchase.metadata
      : (purchase.metadata ? JSON.parse(purchase.metadata) : {});
    
    console.log('   Current metadata keys:', Object.keys(currentMetadata || {}).join(', ') || 'NONE');
    
    // Step 3: Merge metadata
    console.log('\nStep 3: Merging metadata...');
    const purchaseTier = purchase.purchase_tier || 
                        currentMetadata.purchaseTier || 
                        paymentMetadata?.purchaseTier || 
                        paymentMetadata?.sessionCount || 
                        30;
    
    const completeMetadata = {
      ...paymentMetadata, // Payment metadata is source of truth
      ...currentMetadata, // Keep any existing purchase-specific data
      // Ensure critical fields
      courseId: courseId,
      purchaseTier: purchaseTier,
      sessionCount: purchaseTier,
    };
    
    console.log('   Complete metadata keys:', Object.keys(completeMetadata).join(', '));
    
    // Step 4: Update purchase
    console.log('\nStep 4: Updating purchase...');
    await pool.query(
      `UPDATE student_course_purchases
       SET metadata = $1, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(completeMetadata), purchase.id]
    );
    
    console.log('✅ Purchase updated successfully!');
    console.log('\n=== Summary ===');
    console.log('Purchase ID:', purchase.id);
    console.log('Metadata fields:', Object.keys(completeMetadata).length);
    console.log('Key fields present:');
    console.log('  - startDate:', !!completeMetadata.startDate || !!completeMetadata.schedule?.startDate);
    console.log('  - classTime:', !!completeMetadata.timeSlot || !!completeMetadata.schedule?.timeSlot);
    console.log('  - classTypeId:', !!completeMetadata.classTypeId);
    console.log('  - sessionCount:', !!completeMetadata.sessionCount);
    console.log('  - scheduleType:', !!completeMetadata.scheduleType);
    
    // Step 5: Verify update
    console.log('\nStep 5: Verifying update...');
    const verifyResult = await pool.query(
      `SELECT metadata FROM student_course_purchases WHERE id = $1`,
      [purchase.id]
    );
    
    if (verifyResult.rows.length > 0) {
      const verified = typeof verifyResult.rows[0].metadata === 'string'
        ? JSON.parse(verifyResult.rows[0].metadata)
        : verifyResult.rows[0].metadata;
      
      console.log('✅ Verification successful');
      console.log('   Verified metadata keys:', Object.keys(verified || {}).join(', '));
    }
    
    await pool.end();
    console.log('\n✅ Update complete!');
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack:', error.stack);
    await pool.end();
    process.exit(1);
  }
}

updatePurchase();

