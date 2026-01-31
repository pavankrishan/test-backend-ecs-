// Direct purchase creation script - runs inside course-service container
const { Pool } = require('pg');

const POSTGRES_URL = process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5432/kodingcaravan';

const studentId = '809556c1-e184-4b85-8fd6-a5f1c8014bf6';
const courseId = '9e16d892-4324-4568-be60-163aa1665683';

async function createPurchase() {
  const pool = new Pool({
    connectionString: POSTGRES_URL,
    ssl: POSTGRES_URL.includes('render.com') ? { rejectUnauthorized: false } : false,
  });

  try {
    // Check if purchase already exists
    const checkResult = await pool.query(
      `SELECT id FROM student_course_purchases 
       WHERE student_id = $1 AND course_id = $2 AND is_active = true
       LIMIT 1`,
      [studentId, courseId]
    );

    if (checkResult.rows.length > 0) {
      console.log('✅ Purchase already exists:', checkResult.rows[0].id);
      await pool.end();
      return;
    }

    // Create purchase
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
      console.log('✅ Purchase created successfully!');
      console.log('Purchase ID:', result.rows[0].id);
      console.log('Student ID:', result.rows[0].student_id);
      console.log('Course ID:', result.rows[0].course_id);
      console.log('Purchase Tier:', result.rows[0].purchase_tier);
      console.log('Created At:', result.rows[0].created_at);
    } else {
      console.log('❌ Failed to create purchase');
      process.exit(1);
    }

    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

createPurchase();

