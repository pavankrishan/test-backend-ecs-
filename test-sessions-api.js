// Test script to check sessions API
const axios = require('axios');

async function testSessionsAPI() {
  try {
    // Test the sessions endpoint
    const response = await axios.get('http://localhost:3010/api/admin/sessions/student/77697c62-0c49-4fb1-99b0-79d568576f45?status=scheduled&limit=5', {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ API Response:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('❌ API Error:', error.response?.status, error.response?.data || error.message);
  }
}

testSessionsAPI();
