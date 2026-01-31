const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5432/kodingcaravan',
});

async function checkAllocations() {
  try {
    await client.connect();
    console.log('Connected to database');

    const studentId = '77697c62-0c49-4fb1-99b0-79d568576f45';

    // Check allocations for this student
    const allocResult = await client.query(`
      SELECT
        id,
        student_id,
        trainer_id,
        course_id,
        status,
        created_at
      FROM trainer_allocations
      WHERE student_id = $1
      ORDER BY created_at DESC;
    `, [studentId]);

    console.log(`Found ${allocResult.rows.length} allocations for student ${studentId}:`);
    allocResult.rows.forEach((row, index) => {
      console.log(`${index + 1}. ID: ${row.id}`);
      console.log(`   Student: ${row.student_id}`);
      console.log(`   Trainer: ${row.trainer_id}`);
      console.log(`   Course: ${row.course_id}`);
      console.log(`   Status: ${row.status}`);
      console.log(`   Created: ${row.created_at}`);
      console.log('---');
    });

    // Check sessions linked to these allocations
    const sessionResult = await client.query(`
      SELECT
        s.id,
        s.allocation_id,
        s.student_id,
        s.trainer_id,
        s.session_date,
        s.time_slot,
        s.status,
        s.created_at
      FROM tutoring_sessions s
      JOIN trainer_allocations a ON s.allocation_id = a.id
      WHERE a.student_id = $1
      ORDER BY s.session_date DESC
      LIMIT 10;
    `, [studentId]);

    console.log(`\nFound ${sessionResult.rows.length} sessions linked to allocations for student ${studentId}:`);
    sessionResult.rows.forEach((row, index) => {
      console.log(`${index + 1}. ID: ${row.id}`);
      console.log(`   Allocation: ${row.allocation_id}`);
      console.log(`   Student: ${row.student_id}`);
      console.log(`   Trainer: ${row.trainer_id}`);
      console.log(`   Date: ${row.session_date}`);
      console.log(`   Time: ${row.time_slot}`);
      console.log(`   Status: ${row.status}`);
      console.log(`   Created: ${row.created_at}`);
      console.log('---');
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

checkAllocations();
