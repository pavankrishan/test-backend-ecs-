// Diagnostic script to check purchase and allocation status
// Usage: node diagnose-purchase-allocation.js [studentId] [courseId]
const { Pool } = require('pg');
const http = require('http');
const https = require('https');
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
const studentId = process.argv[2] || null;
const courseId = process.argv[3] || null;

async function diagnose() {
  try {
    console.log('=== Purchase & Allocation Diagnostic ===\n');
    
    if (!studentId || !courseId) {
      console.log('Usage: node diagnose-purchase-allocation.js <studentId> <courseId>');
      console.log('\nOr set them in the script.\n');
      
      // Show recent purchases
      console.log('Recent purchases (last 5):');
      const recentPurchases = await pool.query(
        `SELECT scp.id, scp.student_id, scp.course_id, scp.purchase_tier, 
                scp.created_at, c.title as course_title
         FROM student_course_purchases scp
         LEFT JOIN courses c ON c.id = scp.course_id
         WHERE scp.is_active = true
         ORDER BY scp.created_at DESC
         LIMIT 5`
      );
      
      if (recentPurchases.rows.length === 0) {
        console.log('   No active purchases found');
      } else {
        recentPurchases.rows.forEach((p, i) => {
          console.log(`   ${i + 1}. Student: ${p.student_id.substring(0, 8)}...`);
          console.log(`      Course: ${p.course_id.substring(0, 8)}... (${p.course_title || 'N/A'})`);
          console.log(`      Tier: ${p.purchase_tier} sessions`);
          console.log(`      Created: ${p.created_at}`);
          console.log('');
        });
      }
      
      await pool.end();
      return;
    }
    
    console.log(`Student ID: ${studentId}`);
    console.log(`Course ID: ${courseId}\n`);
    
    // Step 1: Check payment
    console.log('Step 1: Checking payment...');
    const paymentResult = await pool.query(
      `SELECT id, status, amount_cents, provider, metadata, created_at, confirmed_at
       FROM payments 
       WHERE student_id = $1 
         AND (metadata->>'courseId')::uuid = $2
         AND status = 'succeeded'
       ORDER BY created_at DESC 
       LIMIT 1`,
      [studentId, courseId]
    );
    
    if (paymentResult.rows.length === 0) {
      console.log('   ⚠️  No succeeded payment found for this course');
    } else {
      const payment = paymentResult.rows[0];
      console.log('   ✅ Payment found:', payment.id);
      console.log('      Status:', payment.status);
      console.log('      Amount:', payment.amount_cents, 'cents');
      console.log('      Provider:', payment.provider || 'N/A');
      console.log('      Confirmed:', payment.confirmed_at || 'N/A');
      
      if (payment.metadata) {
        const meta = typeof payment.metadata === 'string' ? JSON.parse(payment.metadata) : payment.metadata;
        console.log('      Metadata keys:', Object.keys(meta).join(', '));
      }
    }
    
    // Step 2: Check purchase
    console.log('\nStep 2: Checking purchase record...');
    const purchaseResult = await pool.query(
      `SELECT id, metadata, purchase_tier, created_at, updated_at
       FROM student_course_purchases 
       WHERE student_id = $1 
         AND course_id = $2 
         AND is_active = true
       ORDER BY created_at DESC 
       LIMIT 1`,
      [studentId, courseId]
    );
    
    if (purchaseResult.rows.length === 0) {
      console.log('   ❌ No purchase found!');
      console.log('   → This means the PURCHASE_CONFIRMED event was not processed');
      console.log('   → Check if purchase-worker is running');
      await pool.end();
      return;
    }
    
    const purchase = purchaseResult.rows[0];
    console.log('   ✅ Purchase found:', purchase.id);
    console.log('      Tier:', purchase.purchase_tier, 'sessions');
    console.log('      Created:', purchase.created_at);
    
    // Parse metadata
    const metadata = typeof purchase.metadata === 'string' 
      ? JSON.parse(purchase.metadata)
      : purchase.metadata;
    
    if (metadata) {
      console.log('      Metadata keys:', Object.keys(metadata).join(', '));
    }
    
    // Step 3: Check processed events
    console.log('\nStep 3: Checking processed events...');
    const eventsResult = await pool.query(
      `SELECT event_type, correlation_id, source, processed_at
       FROM processed_events
       WHERE correlation_id IN (
         SELECT id::text FROM payments 
         WHERE student_id = $1 
           AND (metadata->>'courseId')::uuid = $2
           AND status = 'succeeded'
         ORDER BY created_at DESC
         LIMIT 1
       )
       ORDER BY processed_at DESC`,
      [studentId, courseId]
    );
    
    if (eventsResult.rows.length === 0) {
      console.log('   ⚠️  No processed events found');
      console.log('   → Events may not have been emitted or processed');
    } else {
      console.log(`   Found ${eventsResult.rows.length} processed events:`);
      eventsResult.rows.forEach((e, i) => {
        console.log(`      ${i + 1}. ${e.event_type} (${e.source}) - ${e.processed_at}`);
      });
      
      const hasPurchaseConfirmed = eventsResult.rows.some(e => e.event_type === 'PURCHASE_CONFIRMED');
      const hasPurchaseCreated = eventsResult.rows.some(e => e.event_type === 'PURCHASE_CREATED');
      
      if (!hasPurchaseConfirmed) {
        console.log('   ⚠️  PURCHASE_CONFIRMED event not processed');
      }
      if (!hasPurchaseCreated) {
        console.log('   ⚠️  PURCHASE_CREATED event not processed');
        console.log('   → Check if purchase-worker is running and emitting events');
      }
    }
    
    // Step 4: Check allocation
    console.log('\nStep 4: Checking trainer allocation...');
    const allocationResult = await pool.query(
      `SELECT id, trainer_id, status, created_at, updated_at
       FROM trainer_allocations 
       WHERE student_id = $1 
         AND course_id = $2
       ORDER BY created_at DESC 
       LIMIT 1`,
      [studentId, courseId]
    );
    
    if (allocationResult.rows.length === 0) {
      console.log('   ❌ No allocation found!');
      console.log('   → This means the PURCHASE_CREATED event was not processed by allocation-worker');
      console.log('   → Check if allocation-worker is running');
      console.log('   → Or manually trigger allocation (see below)');
    } else {
      const allocation = allocationResult.rows[0];
      console.log('   ✅ Allocation found:', allocation.id);
      console.log('      Status:', allocation.status);
      console.log('      Trainer ID:', allocation.trainer_id || 'NULL');
      console.log('      Created:', allocation.created_at);
      
      if (allocation.status !== 'approved' && allocation.status !== 'active') {
        console.log('   ⚠️  Allocation is not approved/active');
      }
    }
    
    // Step 5: Check sessions
    console.log('\nStep 5: Checking sessions...');
    const sessionsResult = await pool.query(
      `SELECT COUNT(*) as count, 
              COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled,
              COUNT(*) FILTER (WHERE status = 'completed') as completed
       FROM tutoring_sessions
       WHERE student_id = $1
         AND course_id = $2`,
      [studentId, courseId]
    );
    
    const sessionCount = parseInt(sessionsResult.rows[0].count) || 0;
    const scheduledCount = parseInt(sessionsResult.rows[0].scheduled) || 0;
    const completedCount = parseInt(sessionsResult.rows[0].completed) || 0;
    
    if (sessionCount === 0) {
      console.log('   ⚠️  No sessions found');
      console.log('   → Sessions should be created automatically after allocation');
    } else {
      console.log(`   ✅ Found ${sessionCount} sessions`);
      console.log(`      Scheduled: ${scheduledCount}`);
      console.log(`      Completed: ${completedCount}`);
    }
    
    // Summary
    console.log('\n=== Summary ===');
    const hasPurchase = purchaseResult.rows.length > 0;
    const hasAllocation = allocationResult.rows.length > 0 && 
                          ['approved', 'active'].includes(allocationResult.rows[0].status);
    const hasSessions = sessionCount > 0;
    
    if (hasPurchase && hasAllocation && hasSessions) {
      console.log('✅ Everything looks good! Purchase → Allocation → Sessions all exist.');
    } else if (hasPurchase && !hasAllocation) {
      console.log('⚠️  Purchase exists but allocation is missing.');
      console.log('   → Run: node manual-trigger-allocation.js');
      console.log('   → Or check if allocation-worker is running');
    } else if (hasPurchase && hasAllocation && !hasSessions) {
      console.log('⚠️  Purchase and allocation exist but no sessions.');
      console.log('   → Sessions should be created automatically after allocation');
      console.log('   → Check session-worker logs');
    } else if (!hasPurchase) {
      console.log('❌ Purchase not found. Check purchase-worker.');
    }
    
    await pool.end();
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack:', error.stack);
    await pool.end();
    process.exit(1);
  }
}

diagnose();

