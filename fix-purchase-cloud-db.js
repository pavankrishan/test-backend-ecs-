// Script to create purchase in cloud database via course-service API
// This ensures the purchase is created in the correct database

const http = require('http');

const studentId = '809556c1-e184-4b85-8fd6-a5f1c8014bf6';
const courseId = '9e16d892-4324-4568-be60-163aa1665683';
const purchaseTier = 30; // Default to 30 sessions

const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3005';
const purchaseUrl = `${courseServiceUrl}/api/v1/purchases`;

const purchaseData = {
  studentId: studentId,
  courseId: courseId,
  purchaseTier: purchaseTier,
  metadata: {}
};

console.log('Creating purchase via course-service API...');
console.log('URL:', purchaseUrl);
console.log('Data:', JSON.stringify(purchaseData, null, 2));

const postData = JSON.stringify(purchaseData);

const options = {
  hostname: 'localhost',
  port: 3005,
  path: '/api/v1/purchases',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('Response Status:', res.statusCode);
    console.log('Response Headers:', res.headers);
    console.log('Response Body:', data);
    
    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('✅ Purchase created successfully!');
      try {
        const response = JSON.parse(data);
        console.log('Purchase ID:', response.data?.id || 'unknown');
      } catch (e) {
        console.log('Could not parse response as JSON');
      }
    } else if (res.statusCode === 409) {
      console.log('ℹ️ Purchase already exists (409 conflict - this is okay)');
    } else {
      console.log('❌ Failed to create purchase');
      process.exit(1);
    }
  });
});

req.on('error', (error) => {
  console.error('Error:', error.message);
  process.exit(1);
});

req.write(postData);
req.end();

