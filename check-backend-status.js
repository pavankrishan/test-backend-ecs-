/**
 * Check if backend services are running and accessible
 * Usage: node check-backend-status.js
 */

require('dotenv').config();

const API_GATEWAY_PORT = process.env.API_GATEWAY_PORT || 3000;
const STUDENT_SERVICE_PORT = process.env.STUDENT_SERVICE_PORT || 3003;
const API_BASE = process.env.API_BASE_URL || process.env.API_GATEWAY_URL || `http://localhost:${API_GATEWAY_PORT}`;

async function checkBackendStatus() {
  console.log('\n🔍 Checking Backend Services Status...\n');
  console.log(`API Gateway URL: ${API_BASE}`);
  console.log(`Student Service Port: ${STUDENT_SERVICE_PORT}\n`);

  const services = [
    {
      name: 'API Gateway',
      url: `${API_BASE}/health`,
      port: API_GATEWAY_PORT,
    },
    {
      name: 'Student Service',
      url: `http://localhost:${STUDENT_SERVICE_PORT}/health`,
      port: STUDENT_SERVICE_PORT,
    },
  ];

  for (const service of services) {
    try {
      console.log(`Checking ${service.name} (${service.url})...`);
      const response = await fetch(service.url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`  ✅ ${service.name} is running`);
        console.log(`     Status: ${data.status || 'ok'}`);
        console.log(`     Service: ${data.service || 'N/A'}\n`);
      } else {
        console.log(`  ⚠️  ${service.name} returned ${response.status}\n`);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log(`  ❌ ${service.name} - Connection timeout (service not responding)\n`);
      } else if (error.code === 'ECONNREFUSED') {
        console.log(`  ❌ ${service.name} - Connection refused (service not running on port ${service.port})\n`);
      } else {
        console.log(`  ❌ ${service.name} - ${error.message}\n`);
      }
    }
  }

  // Test the actual home endpoint
  const studentId = '15b88b88-5403-48c7-a29f-77a3d5a8ee87';
  const homeUrl = `${API_BASE}/api/v1/students/${studentId}/home`;
  
  console.log(`\nTesting Home API Endpoint: ${homeUrl}`);
  try {
    const response = await fetch(homeUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (response.ok) {
      const data = await response.json();
      const sessions = data.data?.upcomingSessions || data.upcomingSessions || [];
      console.log(`  ✅ Home API is working`);
      console.log(`     Sessions returned: ${sessions.length}`);
      if (sessions.length > 0) {
        console.log(`     Sample session: ${sessions[0].scheduledDate} - ${sessions[0].status}`);
      }
    } else {
      const errorText = await response.text();
      console.log(`  ❌ Home API returned ${response.status}`);
      console.log(`     Error: ${errorText.substring(0, 200)}\n`);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log(`  ❌ Home API - Connection timeout\n`);
    } else if (error.code === 'ECONNREFUSED') {
      console.log(`  ❌ Home API - Connection refused (backend not running)\n`);
    } else {
      console.log(`  ❌ Home API - ${error.message}\n`);
    }
  }

  console.log('\n💡 Tips:');
  console.log('  1. If services are not running, start them with: pnpm dev');
  console.log('  2. Check that ports are not blocked by firewall');
  console.log('  3. Verify API_BASE_URL in frontend matches backend URL');
  console.log('  4. For mobile emulator, use 10.0.2.2 instead of localhost\n');
}

checkBackendStatus().catch(console.error);

