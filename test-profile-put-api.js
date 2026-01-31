/**
 * Test: PUT profile endpoint (gateway -> student-service).
 * Run with gateway up: node test-profile-put-api.js
 * Optional: STUDENT_ACCESS_TOKEN=xxx to test with auth (otherwise expects 401).
 */
try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch (_) {}

const http = require('http');
const https = require('https');

const STUDENT_ID = '22246e6e-9754-4f72-a6ef-dd333f0c2913';
const GATEWAY_URL = process.env.API_GATEWAY_URL || process.env.API_URL || 'http://localhost:3000';

const body = JSON.stringify({
  fullName: 'Test Full Name',
  age: 25,
  gender: 'male',
  address: 'Singarayakonda, Andhra Pradesh, 523101, India',
  latitude: 15.2604317,
  longitude: 80.036725,
});

function request(url, options, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const mod = isHttps ? https : http;
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...(process.env.STUDENT_ACCESS_TOKEN && { Authorization: `Bearer ${process.env.STUDENT_ACCESS_TOKEN}` }),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (ch) => (raw += ch));
        res.on('end', () => {
          try {
            const json = raw ? JSON.parse(raw) : {};
            resolve({ statusCode: res.statusCode, data: json });
          } catch {
            resolve({ statusCode: res.statusCode, data: raw });
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

async function main() {
  const url = `${GATEWAY_URL.replace(/\/$/, '')}/api/v1/students/${STUDENT_ID}/profile`;
  console.log('PUT', url);
  try {
    const { statusCode, data } = await request(url, {}, body);
    console.log('Status:', statusCode);
    console.log('Body:', typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
    if (statusCode === 200) {
      console.log('OK: Profile updated via API.');
    } else if (statusCode === 401) {
      console.log('Expected without token. Set STUDENT_ACCESS_TOKEN to test with auth.');
    } else if (statusCode === 404) {
      console.log('404: Gateway may not be routing to student-service, or gateway not running.');
    }
  } catch (e) {
    console.error('Request failed:', e.message || e);
    if (e.code === 'ECONNREFUSED') {
      console.log('Start the gateway (e.g. docker compose up) and run again.');
    }
    process.exit(1);
  }
}

main();
