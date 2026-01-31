// Script to invalidate student cache
// Usage: node invalidate-student-cache.js <studentId>

const http = require('http');

const studentId = process.argv[2];

if (!studentId) {
  console.error('❌ Student ID is required');
  console.log('Usage: node invalidate-student-cache.js <studentId>');
  process.exit(1);
}

const STUDENT_SERVICE_URL = process.env.STUDENT_SERVICE_URL || 'http://localhost:3003';
const cacheInvalidationUrl = `${STUDENT_SERVICE_URL}/api/students/${studentId}/invalidate-cache`;

console.log(`\n🔄 Invalidating cache for student: ${studentId}`);
console.log(`   URL: ${cacheInvalidationUrl}\n`);

const options = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
};

const req = http.request(cacheInvalidationUrl, options, (res) => {
  let body = '';
  
  res.on('data', (chunk) => {
    body += chunk.toString();
  });
  
  res.on('end', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log(`✅ Cache invalidated successfully!`);
      console.log(`   Status: ${res.statusCode}`);
      try {
        const data = JSON.parse(body);
        console.log(`   Response:`, JSON.stringify(data, null, 2));
      } catch (e) {
        console.log(`   Response: ${body.substring(0, 200)}`);
      }
    } else {
      console.error(`❌ Cache invalidation failed`);
      console.error(`   Status: ${res.statusCode}`);
      console.error(`   Response: ${body.substring(0, 200)}`);
      process.exit(1);
    }
  });
});

req.on('error', (error) => {
  console.error(`❌ Request failed:`, error.message);
  process.exit(1);
});

req.on('timeout', () => {
  console.error(`❌ Request timeout`);
  req.destroy();
  process.exit(1);
});

req.end();
