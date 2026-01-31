// Test script to create sessions for student
const axios = require('axios');

async function createSessionsForStudent() {
  const studentId = '77697c62-0c49-4fb1-99b0-79d568576f45';

  try {
    // First, get student's allocations
    const allocResponse = await axios.get(`http://localhost:3010/api/admin/students/${studentId}/allocations`);
    const allocations = allocResponse.data?.data || [];

    console.log(`Found ${allocations.length} allocations for student ${studentId}`);

    for (const allocation of allocations) {
      if (allocation.status === 'approved' || allocation.status === 'active') {
        console.log(`Creating sessions for allocation ${allocation.id}...`);

        try {
          const sessionResponse = await axios.post(
            `http://localhost:3010/api/admin/allocations/${allocation.id}/create-sessions`,
            {},
            { headers: { 'Content-Type': 'application/json' } }
          );
          console.log(`✅ Created sessions for allocation ${allocation.id}`);
        } catch (error) {
          console.error(`❌ Failed to create sessions for allocation ${allocation.id}:`, error.response?.data || error.message);
        }
      }
    }

    // Verify sessions were created
    const verifyResponse = await axios.get(`http://localhost:3010/api/admin/sessions/student/${studentId}?status=scheduled&limit=10`);
    console.log(`✅ Found ${verifyResponse.data?.data?.length || 0} sessions for student`);

  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

createSessionsForStudent();
