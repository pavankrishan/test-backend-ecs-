/**
 * Script to create sessions for student allocations
 */
import "@kodingcaravan/shared/config";
import { Pool } from 'pg';
import { buildPostgresConnectionString } from '@kodingcaravan/shared/databases/postgres/connection';
import { AllocationService } from '../src/services/allocation.service';

// Create pool for testing
const pool = new Pool({
  connectionString: buildPostgresConnectionString(process.env),
});

async function createSessionsForStudent() {
  const allocationService = new AllocationService(pool);

  try {
    console.log('🔧 Creating sessions for student...\n');

    const studentId = '77697c62-0c49-4fb1-99b0-79d568576f45';

    // Update student coordinates first
    console.log('📍 Updating student coordinates...');
    await pool.query(`
      UPDATE student_profiles
      SET latitude = 16.3067, longitude = 80.4365, updated_at = NOW()
      WHERE student_id = $1
        AND (latitude IS NULL OR longitude IS NULL);
    `, [studentId]);

    // Get student's allocations
    const allocationsResult = await pool.query(`
      SELECT * FROM trainer_allocations
      WHERE student_id = $1 AND status IN ('approved', 'active') AND trainer_id IS NOT NULL;
    `, [studentId]);

    console.log(`📋 Found ${allocationsResult.rows.length} approved/active allocations for student`);

    let totalSessionsCreated = 0;

    // Create sessions for each allocation
    for (const allocation of allocationsResult.rows) {
      try {
        console.log(`📅 Creating sessions for allocation ${allocation.id}...`);
        await allocationService.createInitialSession(allocation);
        console.log(`✅ Created sessions for allocation ${allocation.id}`);

        // Count sessions created for this allocation
        const sessionCountResult = await pool.query(`
          SELECT COUNT(*) as count FROM tutoring_sessions WHERE allocation_id = $1;
        `, [allocation.id]);

        totalSessionsCreated += parseInt(sessionCountResult.rows[0].count);
      } catch (error: any) {
        console.error(`❌ Failed to create sessions for allocation ${allocation.id}:`, error.message);
      }
    }

    console.log(`\n📊 Total sessions created: ${totalSessionsCreated}`);

    // Verify total sessions for student
    const verifyResult = await pool.query(`
      SELECT COUNT(*) as total_sessions
      FROM tutoring_sessions
      WHERE student_id = $1;
    `, [studentId]);

    console.log(`📊 Total sessions for student: ${verifyResult.rows[0].total_sessions}`);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

createSessionsForStudent();
