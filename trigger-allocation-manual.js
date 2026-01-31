/**
 * Manual Allocation Trigger Script
 * 
 * Manually triggers trainer allocation for a purchase.
 * This calls the admin-service API directly to create allocation and sessions.
 * 
 * Usage:
 *   node trigger-allocation-manual.js <purchaseId>
 * 
 * Example:
 *   node trigger-allocation-manual.js bb5eafeb-e64a-494c-8fb2-c526983ab14b
 */

require('dotenv').config();
const { Pool } = require('pg');
const http = require('http');

const POSTGRES_URL = process.env.POSTGRES_URL || process.env.DATABASE_URL;
const purchaseId = process.argv[2];

if (!purchaseId) {
  console.error('❌ Purchase ID is required');
  console.log('Usage: node trigger-allocation-manual.js <purchaseId>');
  process.exit(1);
}

const pool = new Pool({
  connectionString: POSTGRES_URL,
  ssl: POSTGRES_URL.includes('render.com') || POSTGRES_URL.includes('amazonaws.com') 
    ? { rejectUnauthorized: false } 
    : false,
});

function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(data);
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          data: body,
        });
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function triggerAllocation() {
  try {
    console.log(`\n🔍 Fetching purchase: ${purchaseId}...`);
    
    // Fetch purchase record
    const purchaseResult = await pool.query(
      `SELECT id, student_id, course_id, purchase_tier, metadata
       FROM student_course_purchases 
       WHERE id = $1 AND is_active = true`,
      [purchaseId]
    );

    if (purchaseResult.rows.length === 0) {
      throw new Error(`Purchase ${purchaseId} not found or not active`);
    }

    const purchase = purchaseResult.rows[0];
    console.log(`✅ Purchase found:`);
    console.log(`   Student ID: ${purchase.student_id}`);
    console.log(`   Course ID: ${purchase.course_id}`);
    console.log(`   Purchase Tier: ${purchase.purchase_tier}`);

    // Parse metadata
    let metadata = {};
    if (purchase.metadata) {
      metadata = typeof purchase.metadata === 'string' 
        ? JSON.parse(purchase.metadata) 
        : purchase.metadata;
    }

    // Extract schedule info
    const schedule = metadata.schedule || {};
    const timeSlot = metadata.timeSlot || metadata.preferredTimeSlot || schedule.timeSlot || '8:00 AM';
    const startDate = schedule.startDate || schedule.date || metadata.startDate || metadata.preferredDate || new Date().toISOString().split('T')[0];

    console.log(`\n📋 Allocation details:`);
    console.log(`   Time Slot: ${timeSlot}`);
    console.log(`   Start Date: ${startDate}`);

    // Check if allocation already exists
    const existingAllocation = await pool.query(
      `SELECT id, status FROM trainer_allocations 
       WHERE student_id = $1 AND course_id = $2 AND status IN ('approved', 'active')`,
      [purchase.student_id, purchase.course_id]
    );

    if (existingAllocation.rows.length > 0) {
      console.log(`\n⚠️  Allocation already exists!`);
      console.log(`   Allocation ID: ${existingAllocation.rows[0].id}`);
      console.log(`   Status: ${existingAllocation.rows[0].status}`);
      await pool.end();
      return;
    }

    // Call admin-service auto-assign API
    const adminServiceUrl = process.env.ADMIN_SERVICE_URL || `http://localhost:3010`;
    const autoAssignUrl = `${adminServiceUrl}/api/v1/admin/allocations/auto-assign`;

    console.log(`\n📞 Calling admin-service allocation API...`);
    console.log(`   URL: ${autoAssignUrl}`);

    const response = await httpPost(autoAssignUrl, {
      studentId: purchase.student_id,
      courseId: purchase.course_id,
      timeSlot: timeSlot,
      date: startDate,
      paymentMetadata: metadata,
    });

    if (response.statusCode >= 200 && response.statusCode < 300) {
      const responseData = JSON.parse(response.data);
      const allocation = responseData?.data || responseData;
      
      console.log(`✅ Allocation created successfully!`);
      console.log(`   Allocation ID: ${allocation.id}`);
      console.log(`   Trainer ID: ${allocation.trainerId || allocation.trainer_id}`);
      console.log(`\n📝 Next steps:`);
      console.log(`   1. Allocation created: ${allocation.id}`);
      console.log(`   2. Session worker should create sessions automatically`);
      console.log(`   3. Frontend should refresh to see the course`);
    } else {
      throw new Error(`Allocation API returned status ${response.statusCode}: ${response.data}`);
    }

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    await pool.end();
    process.exit(1);
  }
}

triggerAllocation();

