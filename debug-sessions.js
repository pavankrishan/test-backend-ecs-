/**
 * Diagnostic script to check why sessions aren't appearing
 * Usage: node debug-sessions.js <studentId>
 */

require('dotenv').config();
const { Pool } = require('pg');

const STUDENT_ID = process.argv[2] || '15b88b88-5403-48c7-a29f-77a3d5a8ee87';

// Get POSTGRES_URL or construct from individual variables
const POSTGRES_URL = process.env.POSTGRES_URL || 
  (process.env.POSTGRES_HOST ? 
    `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || 'kodingcaravan'}` :
    process.env.DATABASE_URL);

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL or DATABASE_URL not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: POSTGRES_URL,
  ssl: POSTGRES_URL.includes('render.com') ? { rejectUnauthorized: false } : false,
});

async function debugSessions() {
  try {
    console.log(`\n🔍 Debugging sessions for student: ${STUDENT_ID}\n`);

    // Step 1: Check active purchases and allocations
    console.log('📊 Step 1: Checking active courses...');
    const [purchasesCheck, allocationsCheck] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS count
        FROM student_course_purchases
        WHERE student_id = $1 AND is_active = true`,
        [STUDENT_ID]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count
        FROM trainer_allocations
        WHERE student_id = $1 
          AND status IN ('approved', 'active')
          AND course_id IS NOT NULL`,
        [STUDENT_ID]
      )
    ]);

    const activePurchases = purchasesCheck.rows[0]?.count ?? 0;
    const activeAllocations = allocationsCheck.rows[0]?.count ?? 0;

    console.log(`  Active purchases: ${activePurchases}`);
    console.log(`  Active allocations: ${activeAllocations}`);

    if (activePurchases === 0 && activeAllocations === 0) {
      console.log('\n⚠️  Student has NO active courses - sessions won\'t be fetched!');
      console.log('   This is why sessions aren\'t appearing.\n');
      return;
    }

    // Step 2: Check all sessions (no filters)
    console.log('\n📊 Step 2: Checking all sessions in database...');
    const allSessions = await pool.query(
      `SELECT 
        id,
        status,
        scheduled_date,
        scheduled_time,
        course_id,
        trainer_id,
        EXTRACT(DOW FROM scheduled_date) as day_of_week,
        metadata->>'isSundayOnly' as is_sunday_only
      FROM tutoring_sessions 
      WHERE student_id = $1
      ORDER BY scheduled_date ASC, scheduled_time ASC
      LIMIT 20`,
      [STUDENT_ID]
    );

    console.log(`  Total sessions found: ${allSessions.rows.length}`);
    if (allSessions.rows.length === 0) {
      console.log('\n⚠️  No sessions exist in database for this student!\n');
      return;
    }

    console.log('\n  Sample sessions:');
    allSessions.rows.slice(0, 5).forEach((s, i) => {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      console.log(`    ${i + 1}. ID: ${s.id.substring(0, 8)}...`);
      console.log(`       Status: ${s.status}`);
      console.log(`       Date: ${s.scheduled_date} (${dayNames[s.day_of_week]})`);
      console.log(`       Time: ${s.scheduled_time}`);
      console.log(`       Course: ${s.course_id?.substring(0, 8) || 'NULL'}...`);
    });

    // Step 3: Check status filter
    console.log('\n📊 Step 3: Checking status filter...');
    const validStatuses = ['scheduled', 'pending_verification', 'pending_confirmation', 'in_progress'];
    const statusFilterResult = await pool.query(
      `SELECT COUNT(*) as count FROM tutoring_sessions 
      WHERE student_id = $1 
      AND status = ANY($2::text[])`,
      [STUDENT_ID, validStatuses]
    );
    const passingStatus = parseInt(statusFilterResult.rows[0]?.count || '0', 10);
    console.log(`  Sessions with valid status: ${passingStatus}/${allSessions.rows.length}`);
    
    const invalidStatuses = allSessions.rows
      .filter(s => !validStatuses.includes(s.status))
      .map(s => s.status);
    if (invalidStatuses.length > 0) {
      const uniqueInvalid = [...new Set(invalidStatuses)];
      console.log(`  ⚠️  Invalid statuses found: ${uniqueInvalid.join(', ')}`);
    }

    // Step 4: Check date filter
    console.log('\n📊 Step 4: Checking date filter...');
    const currentDateResult = await pool.query(`SELECT CURRENT_DATE as today, NOW() as now`);
    const currentDate = currentDateResult.rows[0]?.today;
    const currentTimestamp = currentDateResult.rows[0]?.now;
    
    console.log(`  Current date: ${currentDate}`);
    console.log(`  Current timestamp: ${currentTimestamp.toISOString()}`);

    const dateFilterResult = await pool.query(
      `SELECT COUNT(*) as count FROM tutoring_sessions 
      WHERE student_id = $1 
      AND status = ANY($2::text[])
      AND scheduled_date >= (CURRENT_DATE - INTERVAL '1 day')`,
      [STUDENT_ID, validStatuses]
    );
    const passingDate = parseInt(dateFilterResult.rows[0]?.count || '0', 10);
    console.log(`  Sessions passing date filter: ${passingDate}/${passingStatus}`);

    // Check which sessions are failing date filter
    const failingDate = allSessions.rows.filter(s => {
      if (!validStatuses.includes(s.status)) return false;
      const sessionDate = new Date(s.scheduled_date);
      const cutoffDate = new Date(currentDate);
      cutoffDate.setDate(cutoffDate.getDate() - 1);
      return sessionDate < cutoffDate;
    });
    if (failingDate.length > 0) {
      console.log(`  ⚠️  ${failingDate.length} sessions are too old (before ${currentDate})`);
      failingDate.slice(0, 3).forEach(s => {
        console.log(`     - ${s.scheduled_date} (status: ${s.status})`);
      });
    }

    // Step 5: Check Sunday filter
    console.log('\n📊 Step 5: Checking Sunday filter...');
    const sundayFilterResult = await pool.query(
      `SELECT COUNT(*) as count FROM tutoring_sessions 
      WHERE student_id = $1 
      AND status = ANY($2::text[])
      AND scheduled_date >= (CURRENT_DATE - INTERVAL '1 day')
      AND NOT (
        EXTRACT(DOW FROM scheduled_date) != 0
        OR (EXTRACT(YEAR FROM scheduled_date) = EXTRACT(YEAR FROM CURRENT_DATE) 
            AND EXTRACT(MONTH FROM scheduled_date) > 7)
        OR (EXTRACT(YEAR FROM scheduled_date) = EXTRACT(YEAR FROM CURRENT_DATE) 
            AND EXTRACT(MONTH FROM scheduled_date) = 7 
            AND EXTRACT(DAY FROM scheduled_date) > 31)
        OR (metadata->>'isSundayOnly')::boolean = true
        OR status = 'in_progress'
      )`,
      [STUDENT_ID, validStatuses]
    );
    const excludedBySunday = parseInt(sundayFilterResult.rows[0]?.count || '0', 10);
    console.log(`  Sessions excluded by Sunday filter: ${excludedBySunday}`);

    // Step 6: Final query (what the API actually returns)
    console.log('\n📊 Step 6: Final query result (what API returns)...');
    const finalResult = await pool.query(
      `SELECT 
        s.id,
        s.status,
        s.scheduled_date AS "scheduledDate",
        s.scheduled_time AS "scheduledTime",
        s.course_id AS "courseId"
      FROM tutoring_sessions s
      WHERE s.student_id = $1
        AND s.status = ANY($2::text[])
        AND s.scheduled_date >= (CURRENT_DATE - INTERVAL '1 day')
        AND (
          EXTRACT(DOW FROM s.scheduled_date) != 0
          OR (EXTRACT(YEAR FROM s.scheduled_date) = EXTRACT(YEAR FROM CURRENT_DATE) 
              AND EXTRACT(MONTH FROM s.scheduled_date) > 7)
          OR (EXTRACT(YEAR FROM s.scheduled_date) = EXTRACT(YEAR FROM CURRENT_DATE) 
              AND EXTRACT(MONTH FROM s.scheduled_date) = 7 
              AND EXTRACT(DAY FROM s.scheduled_date) > 31)
          OR (s.metadata->>'isSundayOnly')::boolean = true
          OR s.status = 'in_progress'
        )
      ORDER BY s.scheduled_date ASC, s.scheduled_time ASC
      LIMIT 50`,
      [STUDENT_ID, validStatuses]
    );

    console.log(`  Final sessions returned: ${finalResult.rows.length}`);
    
    if (finalResult.rows.length === 0) {
      console.log('\n❌ DIAGNOSIS: No sessions passing all filters!');
      console.log('\n   Summary:');
      console.log(`   - Total sessions: ${allSessions.rows.length}`);
      console.log(`   - Passing status filter: ${passingStatus}`);
      console.log(`   - Passing date filter: ${passingDate}`);
      console.log(`   - Excluded by Sunday filter: ${excludedBySunday}`);
      console.log(`   - Final result: ${finalResult.rows.length}`);
      
      if (passingStatus === 0) {
        console.log('\n   🔴 ROOT CAUSE: All sessions have invalid status!');
        console.log(`      Valid statuses: ${validStatuses.join(', ')}`);
      } else if (passingDate === 0) {
        console.log('\n   🔴 ROOT CAUSE: All sessions are in the past!');
        console.log(`      Current date: ${currentDate}`);
      } else if (excludedBySunday > 0) {
        console.log('\n   🔴 ROOT CAUSE: Sessions excluded by Sunday filter!');
        console.log('      Sunday sessions are excluded until July 31st (unless isSundayOnly=true)');
      }
    } else {
      console.log('\n✅ Sessions found! Sample:');
      finalResult.rows.slice(0, 3).forEach((s, i) => {
        console.log(`    ${i + 1}. ${s.scheduledDate} ${s.scheduledTime} - ${s.status}`);
      });
    }

    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

debugSessions();

