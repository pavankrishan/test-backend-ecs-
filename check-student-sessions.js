const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5432/kodingcaravan',
});

async function checkStudentSessions() {
  try {
    await client.connect();
    console.log('Connected to database');

    const studentId = '77697c62-0c49-4fb1-99b0-79d568576f45';

    // Check what sessions exist for this student
    const result = await client.query(`
      SELECT
        id,
        student_id,
        trainer_id,
        course_id,
        session_date,
        time_slot,
        status,
        created_at
      FROM tutoring_sessions
      WHERE student_id = $1
      ORDER BY session_date DESC
      LIMIT 10;
    `, [studentId]);

    console.log(`Found ${result.rows.length} sessions for student ${studentId}:`);
    result.rows.forEach((row, index) => {
      console.log(`${index + 1}. ID: ${row.id}`);
      console.log(`   Student: ${row.student_id}`);
      console.log(`   Trainer: ${row.trainer_id}`);
      console.log(`   Course: ${row.course_id}`);
      console.log(`   Date: ${row.session_date}`);
      console.log(`   Time: ${row.time_slot}`);
      console.log(`   Status: ${row.status}`);
      console.log(`   Created: ${row.created_at}`);
      console.log('---');
    });

    // Check what the admin query would return
    const adminResult = await client.query(`
      SELECT
        id,
        student_id,
        trainer_id,
        course_id,
        session_date AS "scheduledDate",
        time_slot AS "scheduledTime",
        status,
        created_at
      FROM tutoring_sessions
      WHERE student_id = $1 AND status = $2
      ORDER BY session_date DESC, time_slot DESC
      LIMIT 5;
    `, [studentId, 'scheduled']);

    console.log(`\nAdmin API query result (${adminResult.rows.length} rows):`);
    console.log(JSON.stringify(adminResult.rows, null, 2));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

checkStudentSessions();
