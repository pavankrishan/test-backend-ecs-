// Script to update existing purchases with metadata from payments table
const { Pool } = require('pg');

const POSTGRES_URL = process.env.POSTGRES_URL;

const pool = new Pool({
  connectionString: POSTGRES_URL,
  ssl: POSTGRES_URL.includes('render.com') ? { rejectUnauthorized: false } : false,
});

async function updatePurchases() {
  try {
    console.log('=== Updating Purchase Metadata ===\n');
    
    // Find purchases with empty or minimal metadata
    const purchases = await pool.query(`
      SELECT scp.id, scp.student_id, scp.course_id, scp.metadata, p.id as payment_id, p.metadata as payment_metadata
      FROM student_course_purchases scp
      LEFT JOIN payments p ON p.student_id = scp.student_id 
        AND p.status = 'succeeded'
        AND (p.metadata->>'courseId' = scp.course_id::text OR p.metadata->>'course_id' = scp.course_id::text)
      WHERE scp.is_active = true
        AND (scp.metadata IS NULL 
          OR scp.metadata = '{}'::jsonb
          OR (scp.metadata->>'sessionCount') IS NULL
          OR (scp.metadata->>'timeSlot') IS NULL)
      ORDER BY scp.created_at DESC
      LIMIT 100
    `);
    
    console.log(`Found ${purchases.rows.length} purchases with incomplete metadata\n`);
    
    let updated = 0;
    let skipped = 0;
    
    for (const purchase of purchases.rows) {
      if (!purchase.payment_metadata) {
        console.log(`⚠️  Purchase ${purchase.id.substring(0, 8)}: No payment found`);
        skipped++;
        continue;
      }
      
      const paymentMeta = typeof purchase.payment_metadata === 'string'
        ? JSON.parse(purchase.payment_metadata)
        : purchase.payment_metadata;
      
      const currentMeta = purchase.metadata && typeof purchase.metadata === 'object'
        ? purchase.metadata
        : {};
      
      // Merge payment metadata with existing (payment takes precedence)
      const completeMetadata = {
        ...paymentMeta,
        ...currentMeta, // Keep any existing data
        courseId: purchase.course_id,
        // Ensure critical fields
        purchaseTier: currentMeta.purchaseTier || paymentMeta.purchaseTier || paymentMeta.sessionCount || 30,
        sessionCount: currentMeta.sessionCount || paymentMeta.sessionCount || paymentMeta.purchaseTier || 30,
      };
      
      // Update purchase
      await pool.query(
        `UPDATE student_course_purchases
         SET metadata = $1, updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(completeMetadata), purchase.id]
      );
      
      console.log(`✅ Updated purchase ${purchase.id.substring(0, 8)}`);
      console.log(`   Metadata keys: ${Object.keys(completeMetadata).join(', ')}`);
      updated++;
    }
    
    console.log(`\n=== Summary ===`);
    console.log(`Updated: ${updated}`);
    console.log(`Skipped: ${skipped}`);
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

updatePurchases();

