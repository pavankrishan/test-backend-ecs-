// Script to manually create purchase record from payment
// Usage: node manual-create-purchase.js <paymentId> [studentId] [courseId]
const { Pool } = require('pg');
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

// Get paymentId from command line args
const paymentId = process.argv[2] || 'a77870aa-8166-4a69-a979-058270611107';
const studentIdArg = process.argv[3];
const courseIdArg = process.argv[4];

async function createPurchase() {
  try {
    console.log('=== Manual Purchase Creation ===\n');
    console.log(`Payment ID: ${paymentId}\n`);
    
    // Step 1: Get payment record
    console.log('Step 1: Fetching payment record...');
    const paymentResult = await pool.query(
      `SELECT id, student_id, amount_cents, status, metadata, created_at, confirmed_at
       FROM payments 
       WHERE id = $1 
         AND status = 'succeeded'`,
      [paymentId]
    );
    
    if (paymentResult.rows.length === 0) {
      console.log('❌ Payment not found or not succeeded');
      await pool.end();
      return;
    }
    
    const payment = paymentResult.rows[0];
    console.log('✅ Payment found');
    console.log('   Student ID:', payment.student_id);
    console.log('   Status:', payment.status);
    console.log('   Confirmed:', payment.confirmed_at);
    
    // Parse metadata
    const metadata = typeof payment.metadata === 'string' 
      ? JSON.parse(payment.metadata)
      : payment.metadata;
    
    if (!metadata) {
      console.log('❌ Payment metadata is missing');
      await pool.end();
      return;
    }
    
    // Extract courseId and studentId
    const courseId = courseIdArg || metadata.courseId;
    const studentId = studentIdArg || payment.student_id;
    
    if (!courseId) {
      console.log('❌ Course ID not found in payment metadata');
      console.log('   Please provide courseId as argument: node manual-create-purchase.js <paymentId> <studentId> <courseId>');
      await pool.end();
      return;
    }
    
    console.log('   Course ID:', courseId);
    console.log('   Metadata keys:', Object.keys(metadata).join(', '));
    
    // Step 2: Check if purchase already exists
    console.log('\nStep 2: Checking for existing purchase...');
    const existingPurchase = await pool.query(
      `SELECT id, purchase_tier, created_at
       FROM student_course_purchases 
       WHERE student_id = $1 
         AND course_id = $2 
         AND is_active = true
       LIMIT 1`,
      [studentId, courseId]
    );
    
    if (existingPurchase.rows.length > 0) {
      const purchase = existingPurchase.rows[0];
      console.log('⚠️  Purchase already exists:', purchase.id);
      console.log('   Tier:', purchase.purchase_tier, 'sessions');
      console.log('   Created:', purchase.created_at);
      console.log('\n✅ Purchase already exists, no action needed.');
      await pool.end();
      return;
    }
    
    // Step 3: Extract purchase tier from metadata
    const sessionCount = metadata.sessionCount || metadata.purchaseTier || 30;
    const purchaseTier = typeof sessionCount === 'string' ? parseInt(sessionCount) : sessionCount;
    
    // Validate purchase tier
    if (![10, 20, 30].includes(purchaseTier)) {
      console.log(`⚠️  Invalid purchase tier: ${purchaseTier}, defaulting to 30`);
      purchaseTier = 30;
    }
    
    console.log('\nStep 3: Creating purchase record...');
    console.log('   Purchase Tier:', purchaseTier, 'sessions');
    console.log('   Student ID:', studentId);
    console.log('   Course ID:', courseId);
    
    // Step 4: Create purchase record
    const result = await pool.query(
      `INSERT INTO student_course_purchases 
       (student_id, course_id, purchase_tier, expiry_date, metadata, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())
       ON CONFLICT (student_id, course_id) WHERE is_active = true
       DO UPDATE SET 
         purchase_tier = EXCLUDED.purchase_tier,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()
       RETURNING id, purchase_tier, created_at`,
      [studentId, courseId, purchaseTier, null, JSON.stringify(metadata)]
    );
    
    if (result.rows.length === 0) {
      console.log('❌ Failed to create purchase record');
      await pool.end();
      return;
    }
    
    const purchase = result.rows[0];
    console.log('✅ Purchase created successfully!');
    console.log('   Purchase ID:', purchase.id);
    console.log('   Tier:', purchase.purchase_tier, 'sessions');
    console.log('   Created:', purchase.created_at);
    
    // Step 5: Check if we should trigger allocation
    console.log('\nStep 5: Next steps...');
    console.log('   Purchase created, but allocation may not be triggered automatically.');
    console.log('   To trigger allocation, run:');
    console.log(`   node manual-trigger-allocation.js ${studentId} ${courseId}`);
    
    await pool.end();
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.code === '23505') { // Unique violation
      console.error('   Purchase already exists (unique constraint violation)');
    }
    console.error('Stack:', error.stack);
    await pool.end();
    process.exit(1);
  }
}

createPurchase();

