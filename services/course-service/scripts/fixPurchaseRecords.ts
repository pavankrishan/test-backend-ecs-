/**
 * Fix Purchase Records Script
 * 
 * This script updates existing purchase records to match the actual payment metadata.
 * Run this if purchase records were created with incorrect purchase_tier values.
 * 
 * Usage: pnpm run fix-purchases
 */

// Load environment variables using the shared config (same as services)
import "@kodingcaravan/shared/config";

import { initPostgres, getPostgresPool } from '../src/config/database';
import { CourseStructureRepository } from '../src/models/courseStructure.model';

/**
 * Manual fixes for known purchase records
 * Format: { studentId, courseId, correctTier }
 */
const MANUAL_FIXES: Array<{ studentId: string; courseId: string; correctTier: number }> = [
  // AI Fundamentals - 20 sessions purchased
  { studentId: 'be36fafb-5cfa-444e-822b-132f071f9408', courseId: '9e16d892-4324-4568-be60-163aa1665683', correctTier: 20 },
];

async function fixPurchaseRecords() {
  let pool;
  try {
    // Initialize PostgreSQL connection
    await initPostgres();
    pool = getPostgresPool();
    const repo = new CourseStructureRepository(pool);

    console.log('🔍 Checking purchase records and payment metadata...\n');

    // Get all active purchases with payment metadata if available
    // Note: This assumes payments table is in the same database
    // If payments are in a different database, the subquery will return null
    let result;
    try {
      result = await pool.query(`
        SELECT 
          scp.id,
          scp.student_id,
          scp.course_id,
          scp.purchase_tier,
          c.title as course_title,
          (
            SELECT p.metadata
            FROM payments p
            WHERE p.student_id = scp.student_id
              AND p.status = 'succeeded'
              AND (p.metadata->>'courseId')::uuid = scp.course_id
            ORDER BY p.created_at DESC
            LIMIT 1
          ) as payment_metadata
        FROM student_course_purchases scp
        LEFT JOIN courses c ON c.id = scp.course_id
        WHERE scp.is_active = true
        ORDER BY scp.created_at DESC
      `);
    } catch (error: any) {
      // If payments table doesn't exist or is in different database, query without it
      if (error.message?.includes('relation "payments" does not exist') || 
          error.message?.includes('does not exist')) {
        console.log('⚠️  Payments table not found in this database, querying purchases only...\n');
        result = await pool.query(`
          SELECT 
            scp.id,
            scp.student_id,
            scp.course_id,
            scp.purchase_tier,
            c.title as course_title,
            NULL as payment_metadata
          FROM student_course_purchases scp
          LEFT JOIN courses c ON c.id = scp.course_id
          WHERE scp.is_active = true
          ORDER BY scp.created_at DESC
        `);
      } else {
        throw error;
      }
    }

    console.log(`Found ${result.rows.length} active purchase records\n`);

    // Apply manual fixes first
    if (MANUAL_FIXES.length > 0) {
      console.log('📝 Applying manual fixes...\n');
      for (const fix of MANUAL_FIXES) {
        const purchase = result.rows.find(
          (r) => r.student_id === fix.studentId && r.course_id === fix.courseId
        );

        if (!purchase) {
          console.log(`⚠️  Manual fix: Purchase not found for student ${fix.studentId}, course ${fix.courseId}`);
          continue;
        }

        if (purchase.purchase_tier === fix.correctTier) {
          console.log(`✅ Purchase ${purchase.id}: Tier ${fix.correctTier} is already correct`);
          continue;
        }

        console.log(`🔄 Purchase ${purchase.id}: Updating tier from ${purchase.purchase_tier} to ${fix.correctTier}`);

        await pool.query(
          `UPDATE student_course_purchases 
           SET purchase_tier = $1, updated_at = NOW()
           WHERE id = $2`,
          [fix.correctTier, purchase.id]
        );

        console.log(`✅ Purchase ${purchase.id}: Updated successfully\n`);
      }
    }

    // Try to auto-fix based on payment metadata
    console.log('\n🔧 Attempting auto-fix from payment metadata...\n');
    let autoFixed = 0;
    for (const row of result.rows) {
      if (!row.payment_metadata) {
        continue;
      }

      const metadata = row.payment_metadata;
      let correctTier: number | null = null;

      // Extract sessionCount from payment metadata
      if (metadata.sessionCount) {
        correctTier = typeof metadata.sessionCount === 'string' 
          ? parseInt(metadata.sessionCount, 10) 
          : metadata.sessionCount;
      } else if (metadata.purchaseTier) {
        correctTier = typeof metadata.purchaseTier === 'string' 
          ? parseInt(metadata.purchaseTier, 10) 
          : metadata.purchaseTier;
      }

      // Ensure valid tier
      if (correctTier && (correctTier === 10 || correctTier === 20 || correctTier === 30)) {
        if (correctTier !== row.purchase_tier) {
          console.log(`🔄 Auto-fixing Purchase ${row.id}: Updating tier from ${row.purchase_tier} to ${correctTier} (from payment metadata)`);
          
          await pool.query(
            `UPDATE student_course_purchases 
             SET purchase_tier = $1, updated_at = NOW()
             WHERE id = $2`,
            [correctTier, row.id]
          );

          row.purchase_tier = correctTier; // Update local copy
          autoFixed++;
          console.log(`✅ Purchase ${row.id}: Auto-fixed successfully\n`);
        }
      }
    }

    if (autoFixed > 0) {
      console.log(`✨ Auto-fixed ${autoFixed} purchase record(s) from payment metadata\n`);
    }

    // Display all purchases for review
    console.log('\n📊 Current Purchase Records:\n');
    for (const row of result.rows) {
      console.log(`  Purchase ID: ${row.id}`);
      console.log(`  Student: ${row.student_id}`);
      console.log(`  Course: ${row.course_title || row.course_id}`);
      console.log(`  Current Tier: ${row.purchase_tier} sessions`);
      if (row.payment_metadata) {
        const metadata = row.payment_metadata;
        const sessionCount = metadata.sessionCount || metadata.purchaseTier || 'N/A';
        console.log(`  Payment Metadata: sessionCount = ${sessionCount}`);
      }
      console.log('');
    }

    console.log('✨ Purchase records review completed!');
    console.log('\n💡 To fix a purchase, add it to MANUAL_FIXES array in the script and run again.');
  } catch (error) {
    console.error('❌ Error fixing purchase records:', error);
    throw error;
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

// Run the script
fixPurchaseRecords()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });

