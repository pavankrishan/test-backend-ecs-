const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5432/kodingcaravan',
});

async function checkStudent() {
  try {
    await client.connect();
    
    console.log('ðŸ” Checking student 77697c62-0c49-4fb1-99b0-79d568576f45...\n');
    
    // Check student profile
    const profile = await client.query(
      'SELECT address, latitude, longitude FROM student_profiles WHERE student_id = \',
      ['77697c62-0c49-4fb1-99b0-79d568576f45']
    );
    
    console.log('ðŸ“‹ Student Profile:');
    if (profile.rows.length === 0) {
      console.log('âŒ No profile found');
    } else {
      console.log(JSON.stringify(profile.rows[0], null, 2));
    }
    
    // Check allocations
    const allocations = await client.query(
      SELECT a.id, a.status, a.trainer_id, a.course_id, 
              COALESCE(s.session_count, 0) as existing_sessions
       FROM trainer_allocations a
       LEFT JOIN (
         SELECT allocation_id, COUNT(*) as session_count
         FROM sessions
         GROUP BY allocation_id
       ) s ON a.id = s.allocation_id
       WHERE a.student_id = \
       ORDER BY a.created_at DESC,
      ['77697c62-0c49-4fb1-99b0-79d568576f45']
    );
    
    console.log('\nðŸ“Š Allocations:');
    if (allocations.rows.length === 0) {
      console.log('âŒ No allocations found');
    } else {
      allocations.rows.forEach((alloc, index) => {
        console.log(${index + 1}. ID: );
        console.log(   Status: );
        console.log(   Trainer: );
        console.log(   Course: );
        console.log(   Sessions: );
        console.log('');
      });
    }
    
  } catch (error) {
    console.error('âŒ Error:', error.message);
  } finally {
    await client.end();
  }
}

checkStudent();
