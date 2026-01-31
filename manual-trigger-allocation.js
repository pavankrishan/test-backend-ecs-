// Script to manually trigger trainer allocation for existing purchase
const { Pool } = require('pg');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Try to load .env file if it exists
function loadEnvFile() {
  const envFiles = [
    '.env.production',
    '.env.development',
    '.env.local',
    '.env'
  ];
  
  for (const envFile of envFiles) {
    const envPath = path.join(__dirname, envFile);
    if (fs.existsSync(envPath)) {
      console.log(`Loading environment from ${envFile}...`);
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          if (key && valueParts.length > 0) {
            const value = valueParts.join('=').replace(/^["']|["']$/g, '');
            if (!process.env[key]) {
              process.env[key] = value;
            }
          }
        }
      });
      break;
    }
  }
}

// Load .env file
loadEnvFile();

// Get POSTGRES_URL or construct from individual variables
const POSTGRES_URL = process.env.POSTGRES_URL || 
  (process.env.POSTGRES_HOST ? 
    `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || 'kodingcaravan'}` :
    null);

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL not set');
  console.error('\nPlease set POSTGRES_URL in one of these ways:');
  console.error('1. Create a .env file in kc-backend with: POSTGRES_URL=your_connection_string');
  console.error('2. Set environment variable in PowerShell:');
  console.error('   $env:POSTGRES_URL="your_connection_string"');
  console.error('3. Or set individual variables: POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB');
  process.exit(1);
}

const pool = new Pool({
  connectionString: POSTGRES_URL,
  ssl: POSTGRES_URL.includes('render.com') ? { rejectUnauthorized: false } : false,
});

// Get studentId and courseId from command line args or use defaults
const studentId = process.argv[2] || '809556c1-e184-4b85-8fd6-a5f1c8014bf6';
const courseId = process.argv[3] || '9e16d892-4324-4568-be60-163aa1665683';

async function triggerAllocation() {
  try {
    console.log('=== Manual Trainer Allocation Trigger ===\n');
    console.log(`Student ID: ${studentId}`);
    console.log(`Course ID: ${courseId}\n`);
    
    // Step 1: Get purchase record
    console.log('Step 1: Finding purchase record...');
    const purchaseResult = await pool.query(
      `SELECT id, metadata, purchase_tier, created_at
       FROM student_course_purchases 
       WHERE student_id = $1 
         AND course_id = $2 
         AND is_active = true
       ORDER BY created_at DESC 
       LIMIT 1`,
      [studentId, courseId]
    );
    
    if (purchaseResult.rows.length === 0) {
      console.log('❌ No purchase found');
      await pool.end();
      return;
    }
    
    const purchase = purchaseResult.rows[0];
    console.log('✅ Purchase found:', purchase.id);
    
    // Parse metadata
    const metadata = typeof purchase.metadata === 'string' 
      ? JSON.parse(purchase.metadata)
      : purchase.metadata;
    
    // Extract schedule info
    const schedule = metadata?.schedule || {};
    const timeSlot = metadata?.timeSlot || 
                    metadata?.classTime || 
                    schedule?.timeSlot || 
                    '4:00 PM';
    const startDate = metadata?.startDate || 
                     schedule?.startDate || 
                     schedule?.date || 
                     metadata?.date || 
                     new Date().toISOString().split('T')[0];
    
    console.log('   Time Slot:', timeSlot);
    console.log('   Start Date:', startDate);
    
    // Step 2: Check if allocation already exists
    console.log('\nStep 2: Checking for existing allocation...');
    const allocationResult = await pool.query(
      `SELECT id, trainer_id, status 
       FROM trainer_allocations 
       WHERE student_id = $1 
         AND course_id = $2
       ORDER BY created_at DESC 
       LIMIT 1`,
      [studentId, courseId]
    );
    
    if (allocationResult.rows.length > 0) {
      const allocation = allocationResult.rows[0];
      console.log('⚠️  Allocation already exists:', allocation.id);
      console.log('   Status:', allocation.status);
      console.log('   Trainer ID:', allocation.trainer_id || 'NULL');
      
      if (allocation.status === 'approved' || allocation.status === 'active') {
        console.log('✅ Allocation is already approved/active');
        await pool.end();
        return;
      }
    }
    
    // Step 3: Trigger allocation via admin-service API
    console.log('\nStep 3: Triggering allocation via admin-service API...');
    
    const adminServiceUrl = process.env.ADMIN_SERVICE_URL || 
      `http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.ADMIN_SERVICE_PORT || 3010}`;
    
    const requestBody = JSON.stringify({
      studentId,
      courseId,
      timeSlot,
      date: startDate,
      paymentMetadata: metadata || {},
    });
    
    const url = new URL(`${adminServiceUrl}/api/v1/admin/allocations/auto-assign`);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? require('https') : require('http');
    
    const response = await new Promise((resolve, reject) => {
      const req = httpModule.request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk.toString(); });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            data,
          });
        });
      });
      
      req.on('error', reject);
      req.write(requestBody);
      req.end();
    });
    
    if (response.statusCode >= 200 && response.statusCode < 300) {
      console.log('✅ Allocation triggered successfully!');
      try {
        const responseData = JSON.parse(response.data);
        console.log('   Allocation ID:', responseData.data?.id || 'N/A');
        console.log('   Trainer ID:', responseData.data?.trainerId || responseData.data?.trainer_id || 'N/A');
        console.log('   Status:', responseData.data?.status || 'N/A');
      } catch (e) {
        console.log('   Response:', response.data.substring(0, 200));
      }
    } else {
      console.log('❌ Allocation failed:', response.statusCode);
      console.log('   Response:', response.data.substring(0, 300));
    }
    
    await pool.end();
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack:', error.stack);
    await pool.end();
    process.exit(1);
  }
}

triggerAllocation();

