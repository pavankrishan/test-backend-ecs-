require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL?.includes('render.com') ? { rejectUnauthorized: false } : false,
});

async function testQuery() {
  try {
    const studentId = '401ca863-4543-4b3e-9bc6-c8ad49a77a03';
    const courseId = 'ebefde63-8a3a-4d45-a594-c04275a03092';
    
    console.log('🔍 Testing fixed allocation query...');
    
    const result = await pool.query(
      `
        SELECT 
          ta.id,
          ta.student_id AS "studentId",
          ta.course_id AS "courseId",
          ta.trainer_id AS "trainerId",
          ta.status,
          tp.full_name AS "trainerName",
          COALESCE(
            (tp.extra->>'avatarUrl')::text,
            (tp.extra->>'avatar_url')::text,
            NULL
          ) AS "trainerPhoto"
        FROM trainer_allocations ta
        LEFT JOIN trainer_profiles tp ON ta.trainer_id = tp.trainer_id
        WHERE ta.student_id = $1
          AND ta.course_id = ANY($2::uuid[])
          AND ta.status IN ('approved', 'active')
        ORDER BY ta.created_at DESC
      `,
      [studentId, [courseId]]
    );
    
    console.log('✅ Query result:', result.rows.length, 'rows');
    if (result.rows.length > 0) {
      result.rows.forEach((row, i) => {
        console.log(`  Allocation ${i + 1}:`, {
          id: row.id,
          trainerId: row.trainerId,
          trainerName: row.trainerName,
          trainerPhoto: row.trainerPhoto,
          status: row.status,
        });
      });
    } else {
      console.log('  ⚠️  No allocations found');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

testQuery();

