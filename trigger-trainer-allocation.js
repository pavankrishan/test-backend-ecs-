/**
 * Script to trigger trainer allocation for an existing purchase
 * This calls the admin-service API directly to allocate a trainer
 * 
 * Usage: node trigger-trainer-allocation.js <studentId> <courseId>
 */

const http = require('http');

const studentId = process.argv[2];
const courseId = process.argv[3];

if (!studentId || !courseId) {
  console.error('Usage: node trigger-trainer-allocation.js <studentId> <courseId>');
  console.error('Example: node trigger-trainer-allocation.js 401ca863-4543-4b3e-9bc6-c8ad49a77a03 9e16d892-4324-4568-be60-163aa1665683');
  process.exit(1);
}

const ADMIN_SERVICE_URL = process.env.ADMIN_SERVICE_URL || 'http://localhost:3010';
const autoAssignUrl = `${ADMIN_SERVICE_URL}/api/v1/admin/allocations/auto-assign`;

console.log(`\n🎯 Triggering trainer allocation for:`);
console.log(`   Student ID: ${studentId}`);
console.log(`   Course ID: ${courseId}`);
console.log(`   API: ${autoAssignUrl}\n`);

const requestData = JSON.stringify({
  studentId,
  courseId,
  timeSlot: '4:00 PM', // Default time slot
  date: new Date().toISOString().split('T')[0], // Today's date
  paymentMetadata: {}, // Empty metadata for manual trigger
});

const options = {
  hostname: new URL(ADMIN_SERVICE_URL).hostname,
  port: new URL(ADMIN_SERVICE_URL).port || (ADMIN_SERVICE_URL.startsWith('https') ? 443 : 80),
  path: '/api/v1/admin/allocations/auto-assign',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(requestData),
  },
};

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      try {
        const response = JSON.parse(data);
        console.log('✅ Trainer allocation successful!');
        console.log('   Allocation ID:', response.data?.id || response.id);
        console.log('   Trainer ID:', response.data?.trainerId || response.data?.trainer_id || 'N/A');
        console.log('   Status:', response.data?.status || response.status || 'N/A');
        console.log('\n📋 The trainer has been allocated. Sessions will be created by the session worker.');
      } catch (error) {
        console.log('✅ Response received (non-JSON):', data);
      }
    } else {
      console.error('❌ Allocation failed with status:', res.statusCode);
      console.error('   Response:', data);
      process.exit(1);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request failed:', error.message);
  console.error('   Make sure the admin-service is running and accessible at:', ADMIN_SERVICE_URL);
  process.exit(1);
});

req.write(requestData);
req.end();

