/**
 * Diagnostic Script: Check why trainer allocations are not showing
 * 
 * This script checks:
 * 1. If allocations exist for the trainer
 * 2. What status they have
 * 3. If trainer_id is set correctly
 * 4. If the query matches correctly
 */

import '@kodingcaravan/shared/config';
import { getPool } from '../src/config/database';

// Use the same pool as the admin service (handles all connection details correctly)
const pool = getPool();

const TRAINER_ID = 'b0625c89-b226-44a7-afbb-300c3698bd43';

async function diagnose() {
  console.log('🔍 Diagnosing trainer allocations...\n');
  console.log(`Trainer ID: ${TRAINER_ID}\n`);

  try {
    // 1. Check ALL allocations for this trainer (no status filter)
    console.log('1️⃣ Checking ALL allocations for trainer (no status filter):');
    const allAllocations = await pool.query(
      `SELECT 
        id,
        student_id,
        trainer_id,
        course_id,
        status,
        created_at,
        updated_at,
        metadata
      FROM trainer_allocations
      WHERE trainer_id = $1
      ORDER BY created_at DESC
      LIMIT 20`,
      [TRAINER_ID]
    );
    console.log(`   Found ${allAllocations.rows.length} total allocations\n`);
    if (allAllocations.rows.length > 0) {
      allAllocations.rows.forEach((row, idx) => {
        console.log(`   ${idx + 1}. ID: ${row.id}`);
        console.log(`      Status: ${row.status}`);
        console.log(`      Student: ${row.student_id}`);
        console.log(`      Course: ${row.course_id || 'NULL'}`);
        console.log(`      Created: ${row.created_at}`);
        console.log(`      Trainer ID: ${row.trainer_id || 'NULL ⚠️'}`);
        console.log('');
      });
    } else {
      console.log('   ⚠️ NO ALLOCATIONS FOUND FOR THIS TRAINER\n');
    }

    // 2. Check allocations with status='approved'
    console.log('2️⃣ Checking allocations with status="approved":');
    const approvedAllocations = await pool.query(
      `SELECT 
        id,
        student_id,
        trainer_id,
        course_id,
        status,
        created_at
      FROM trainer_allocations
      WHERE trainer_id = $1 AND status = $2
      ORDER BY created_at DESC
      LIMIT 20`,
      [TRAINER_ID, 'approved']
    );
    console.log(`   Found ${approvedAllocations.rows.length} approved allocations\n`);

    // 3. Check allocations with status='active'
    console.log('3️⃣ Checking allocations with status="active":');
    const activeAllocations = await pool.query(
      `SELECT 
        id,
        student_id,
        trainer_id,
        course_id,
        status,
        created_at
      FROM trainer_allocations
      WHERE trainer_id = $1 AND status = $2
      ORDER BY created_at DESC
      LIMIT 20`,
      [TRAINER_ID, 'active']
    );
    console.log(`   Found ${activeAllocations.rows.length} active allocations\n`);

    // 4. Check if there are allocations with NULL trainer_id (shouldn't happen but check)
    console.log('4️⃣ Checking for allocations with NULL trainer_id (should be 0):');
    const nullTrainerAllocations = await pool.query(
      `SELECT 
        id,
        student_id,
        course_id,
        status,
        created_at,
        metadata
      FROM trainer_allocations
      WHERE trainer_id IS NULL
      AND status IN ('approved', 'active', 'pending')
      ORDER BY created_at DESC
      LIMIT 10`
    );
    console.log(`   Found ${nullTrainerAllocations.rows.length} allocations with NULL trainer_id\n`);
    if (nullTrainerAllocations.rows.length > 0) {
      console.log('   ⚠️ WARNING: Found allocations with NULL trainer_id!');
      nullTrainerAllocations.rows.forEach((row, idx) => {
        console.log(`   ${idx + 1}. ID: ${row.id}`);
        console.log(`      Status: ${row.status}`);
        console.log(`      Student: ${row.student_id}`);
        console.log(`      Course: ${row.course_id || 'NULL'}`);
        console.log(`      Created: ${row.created_at}`);
        console.log(`      Metadata: ${JSON.stringify(row.metadata || {})}`);
        console.log('');
      });
    }

    // 4b. Check pending allocations for this trainer
    console.log('4b️⃣ Checking pending allocations for this trainer:');
    const pendingAllocations = await pool.query(
      `SELECT 
        id,
        student_id,
        trainer_id,
        course_id,
        status,
        created_at,
        metadata
      FROM trainer_allocations
      WHERE trainer_id = $1 AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 10`,
      [TRAINER_ID]
    );
    console.log(`   Found ${pendingAllocations.rows.length} pending allocations\n`);
    if (pendingAllocations.rows.length > 0) {
      pendingAllocations.rows.forEach((row, idx) => {
        console.log(`   ${idx + 1}. ID: ${row.id}`);
        console.log(`      Student: ${row.student_id}`);
        console.log(`      Course: ${row.course_id || 'NULL'}`);
        console.log(`      Created: ${row.created_at}`);
        console.log(`      Metadata: ${JSON.stringify(row.metadata || {})}`);
        console.log('');
      });
    }

    // 5. Check recent allocations (last 24 hours) to see if any were created
    console.log('5️⃣ Checking allocations created in last 24 hours:');
    const recentAllocations = await pool.query(
      `SELECT 
        id,
        student_id,
        trainer_id,
        course_id,
        status,
        created_at
      FROM trainer_allocations
      WHERE created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC
      LIMIT 10`
    );
    console.log(`   Found ${recentAllocations.rows.length} allocations created in last 24 hours\n`);
    if (recentAllocations.rows.length > 0) {
      recentAllocations.rows.forEach((row, idx) => {
        console.log(`   ${idx + 1}. ID: ${row.id}`);
        console.log(`      Trainer: ${row.trainer_id || 'NULL ⚠️'}`);
        console.log(`      Status: ${row.status}`);
        console.log(`      Created: ${row.created_at}`);
        console.log('');
      });
    }

    // 6. Check sessions for this trainer
    console.log('6️⃣ Checking sessions for this trainer:');
    const sessions = await pool.query(
      `SELECT 
        COUNT(*) as count
      FROM tutoring_sessions
      WHERE trainer_id = $1`,
      [TRAINER_ID]
    );
    console.log(`   Found ${sessions.rows[0].count} total sessions\n`);

    // 7. Check sessions linked via allocations
    console.log('7️⃣ Checking sessions linked via allocations:');
    const sessionsViaAllocations = await pool.query(
      `SELECT 
        COUNT(*) as count
      FROM tutoring_sessions ts
      INNER JOIN trainer_allocations ta ON ts.allocation_id = ta.id
      WHERE ta.trainer_id = $1`,
      [TRAINER_ID]
    );
    console.log(`   Found ${sessionsViaAllocations.rows[0].count} sessions linked via allocations\n`);

    // 8. Check recent course purchases that should have triggered allocations
    console.log('8️⃣ Checking recent course purchases (last 7 days):');
    const recentPurchases = await pool.query(
      `SELECT 
        p.id as payment_id,
        p.student_id,
        p.metadata->>'courseId' as course_id,
        p.status as payment_status,
        p.created_at as purchase_date,
        p.metadata
      FROM payments p
      WHERE p.status IN ('succeeded', 'completed')
      AND p.created_at > NOW() - INTERVAL '7 days'
      ORDER BY p.created_at DESC
      LIMIT 10`
    );
    console.log(`   Found ${recentPurchases.rows.length} completed purchases in last 7 days\n`);
    if (recentPurchases.rows.length > 0) {
      for (const purchase of recentPurchases.rows) {
        // Check if allocation exists for this purchase
        const allocationCheck = await pool.query(
          `SELECT id, trainer_id, status
          FROM trainer_allocations
          WHERE student_id = $1 AND course_id = $2
          ORDER BY created_at DESC
          LIMIT 1`,
          [purchase.student_id, purchase.course_id]
        );
        console.log(`   Purchase ID: ${purchase.payment_id}`);
        console.log(`      Student: ${purchase.student_id}`);
        console.log(`      Course: ${purchase.course_id}`);
        console.log(`      Date: ${purchase.purchase_date}`);
        if (allocationCheck.rows.length > 0) {
          const alloc = allocationCheck.rows[0];
          console.log(`      ✅ Allocation exists: ${alloc.id}`);
          console.log(`         Trainer: ${alloc.trainer_id || 'NULL ⚠️'}`);
          console.log(`         Status: ${alloc.status}`);
        } else {
          console.log(`      ❌ NO ALLOCATION FOUND for this purchase!`);
        }
        console.log('');
      }
    }

    // 9. Summary
    console.log('📊 SUMMARY:');
    console.log(`   Total allocations for trainer: ${allAllocations.rows.length}`);
    console.log(`   Approved allocations: ${approvedAllocations.rows.length}`);
    console.log(`   Active allocations: ${activeAllocations.rows.length}`);
    console.log(`   Pending allocations: ${pendingAllocations.rows.length}`);
    console.log(`   Allocations with NULL trainer_id: ${nullTrainerAllocations.rows.length}`);
    console.log(`   Total sessions: ${sessions.rows[0].count}`);
    console.log(`   Sessions via allocations: ${sessionsViaAllocations.rows[0].count}`);
    console.log(`   Recent purchases (7 days): ${recentPurchases.rows.length}`);

    if (allAllocations.rows.length === 0) {
      console.log('\n❌ ISSUE: No allocations found for this trainer in database.');
      console.log('   This means allocations are not being created after purchase.');
      console.log('   Check the auto-assignment flow in payment service.');
    } else if (approvedAllocations.rows.length === 0 && activeAllocations.rows.length === 0) {
      console.log('\n⚠️ ISSUE: Allocations exist but none have status "approved" or "active".');
      console.log('   Check what status they have and why they are not approved.');
    } else {
      console.log('\n✅ Allocations exist and have correct status.');
      console.log('   If frontend still shows 0, check API response handling.');
    }

  } catch (error: any) {
    console.error('❌ Error during diagnosis:', error);
  } finally {
    await pool.end();
  }
}

diagnose();

