/**
 * Test Learning API Directly
 * Tests the aggregation service directly to verify allocation data is included
 */

require('dotenv').config();
const { Pool } = require('pg');
const { getRedisClient } = require('./shared/dist/databases/redis/connection');

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL?.includes('render.com') ? { rejectUnauthorized: false } : false,
});

async function testLearningData() {
  try {
    const studentId = '401ca863-4543-4b3e-9bc6-c8ad49a77a03';
    const courseId = 'ebefde63-8a3a-4d45-a594-c04275a03092';
    
    console.log('🔍 Testing allocation query...');
    
    // Test the allocation query directly
    const allocationResult = await pool.query(
      `
        SELECT 
          ta.id,
          ta.student_id AS "studentId",
          ta.course_id AS "courseId",
          ta.trainer_id AS "trainerId",
          ta.status,
          t.name AS "trainerName",
          t.photo_url AS "trainerPhoto"
        FROM trainer_allocations ta
        LEFT JOIN trainers t ON ta.trainer_id = t.id
        WHERE ta.student_id = $1
          AND ta.course_id = $2
          AND ta.status IN ('approved', 'active')
        ORDER BY ta.created_at DESC
      `,
      [studentId, courseId]
    );
    
    console.log('✅ Allocation query result:', allocationResult.rows.length, 'rows');
    if (allocationResult.rows.length > 0) {
      allocationResult.rows.forEach((row, i) => {
        console.log(`  Allocation ${i + 1}:`, {
          id: row.id,
          trainerId: row.trainerId,
          trainerName: row.trainerName,
          status: row.status,
        });
      });
    } else {
      console.log('  ⚠️  No allocations found');
    }
    
    // Test with ANY array
    console.log('\n🔍 Testing with ANY array...');
    const allocationResult2 = await pool.query(
      `
        SELECT 
          ta.id,
          ta.student_id AS "studentId",
          ta.course_id AS "courseId",
          ta.trainer_id AS "trainerId",
          ta.status,
          t.name AS "trainerName",
          t.photo_url AS "trainerPhoto"
        FROM trainer_allocations ta
        LEFT JOIN trainers t ON ta.trainer_id = t.id
        WHERE ta.student_id = $1
          AND ta.course_id = ANY($2::uuid[])
          AND ta.status IN ('approved', 'active')
        ORDER BY ta.created_at DESC
      `,
      [studentId, [courseId]]
    );
    
    console.log('✅ ANY array query result:', allocationResult2.rows.length, 'rows');
    if (allocationResult2.rows.length > 0) {
      allocationResult2.rows.forEach((row, i) => {
        console.log(`  Allocation ${i + 1}:`, {
          id: row.id,
          trainerId: row.trainerId,
          trainerName: row.trainerName,
          status: row.status,
        });
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

testLearningData();

