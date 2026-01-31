const { Pool } = require('pg');
const POSTGRES_URL = process.env.POSTGRES_URL;
const studentId = '809556c1-e184-4b85-8fd6-a5f1c8014bf6';
const courseId = '9e16d892-4324-4568-be60-163aa1665683';

const pool = new Pool({
  connectionString: POSTGRES_URL,
  ssl: POSTGRES_URL.includes('render.com') ? { rejectUnauthorized: false } : false,
});

async function main() {
  try {
    const result = await pool.query(
      `INSERT INTO student_course_purchases 
       (student_id, course_id, purchase_tier, metadata, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, NOW(), NOW())
       ON CONFLICT (student_id, course_id) WHERE is_active = true
       DO UPDATE SET updated_at = NOW()
       RETURNING id, student_id, course_id, purchase_tier, is_active, created_at`,
      [studentId, courseId, 30, JSON.stringify({})]
    );
    
    if (result.rows.length > 0) {
      console.log('SUCCESS:', JSON.stringify(result.rows[0], null, 2));
    } else {
      console.log('FAILED: No rows returned');
      process.exit(1);
    }
    
    await pool.end();
  } catch (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }
}

main();

