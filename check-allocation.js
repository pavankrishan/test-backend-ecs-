require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL?.includes('render.com') ? { rejectUnauthorized: false } : false,
});

async function checkAllocation() {
  try {
    const studentId = '401ca863-4543-4b3e-9bc6-c8ad49a77a03';
    const courseId = 'ebefde63-8a3a-4d45-a594-c04275a03092';
    
    const result = await pool.query(
      'SELECT id, student_id, course_id, trainer_id, status FROM trainer_allocations WHERE student_id = $1 AND course_id = $2',
      [studentId, courseId]
    );
    
    console.log('Allocations found:', result.rows.length);
    if (result.rows.length > 0) {
      result.rows.forEach((row, i) => {
        console.log(`Allocation ${i + 1}:`, {
          id: row.id,
          trainerId: row.trainer_id,
          status: row.status,
        });
      });
    } else {
      console.log('No allocations found');
    }
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkAllocation();

