// Direct database test
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5432/kodingcaravan',
});

async function testSessionsDirect() {
  try {
    await client.connect();

    const studentId = '77697c62-0c49-4fb1-99b0-79d568576f45';

    // Test the exact query used by the admin service
    console.log('Testing admin service query...');
    const result = await client.query(`
      SELECT
        id,
        allocation_id AS "allocationId",
        student_id AS "studentId",
        trainer_id AS "trainerId",
        course_id AS "courseId",
        session_date AS "scheduledDate",
        time_slot AS "scheduledTime",
        duration,
        status,
        created_at
      FROM tutoring_sessions
      WHERE student_id = $1 AND status = $2
      ORDER BY session_date DESC, time_slot DESC
      LIMIT 5;
    `, [studentId, 'scheduled']);

    console.log(`Found ${result.rows.length} sessions with status 'scheduled'`);
    result.rows.forEach((row, i) => {
      console.log(`${i+1}. ID: ${row.id}, Date: ${row.scheduledDate}, Time: ${row.scheduledTime}, Status: ${row.status}`);
    });

    // Check all sessions for this student
    const allResult = await client.query(`
      SELECT id, session_date, time_slot, status
      FROM tutoring_sessions
      WHERE student_id = $1
      LIMIT 10;
    `, [studentId]);

    console.log(`\nTotal sessions for student: ${allResult.rows.length}`);
    console.log('Status distribution:');
    const statusCount = {};
    allResult.rows.forEach(row => {
      statusCount[row.status] = (statusCount[row.status] || 0) + 1;
    });
    console.log(statusCount);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

testSessionsDirect();
