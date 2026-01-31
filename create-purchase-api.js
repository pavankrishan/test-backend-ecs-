// Create purchase via course-service API
const http = require('http');

const studentId = '809556c1-e184-4b85-8fd6-a5f1c8014bf6';
const courseId = '9e16d892-4324-4568-be60-163aa1665683';

const purchaseData = JSON.stringify({
  studentId: studentId,
  courseId: courseId,
  purchaseTier: 30,
  metadata: {}
});

const options = {
  hostname: 'localhost',
  port: 3005,
  path: '/api/v1/purchases',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(purchaseData)
  }
};

console.log('Creating purchase...');
const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (d) => body += d);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', body);
    if (res.statusCode === 201 || res.statusCode === 200) {
      console.log('✅ Purchase created successfully!');
    } else if (res.statusCode === 409) {
      console.log('ℹ️ Purchase already exists (this is okay)');
    } else {
      console.log('❌ Failed to create purchase');
      process.exit(1);
    }
  });
});

req.on('error', (e) => {
  console.error('Error:', e.message);
  process.exit(1);
});

req.write(purchaseData);
req.end();

