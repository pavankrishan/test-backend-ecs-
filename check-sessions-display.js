// Check why sessions are not showing on home screen
// Usage: node check-sessions-display.js <studentId> <courseId>
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

function loadEnvFile() {
  const envFiles = ['.env.production', '.env.development', '.env.local', '.env'];
  for (const envFile of envFiles) {
    const envPath = path.join(__dirname, envFile);
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          if (key && valueParts.length > 0) {
            const value = valueParts.join('=').replace(/^["']|["']$/g, '');
            if (!process.env[key]) process.env[key] = value;
          }
        }
      });
      break;
    }
  }
}

loadEnvFile();

const POSTGRES_URL = process.env.POSTGRES_URL || 
  (process.env.POSTGRES_HOST ? 
    `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || 'kodingcaravan'}` :
    null);

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: POSTGRES_URL,
  ssl: POSTGRES_URL.includes('render.com') ? { rejectUnauthorized: false } : false,
});

const studentId = process.argv[2] || '15b88b88-5403-48c7-a29f-77a3d5a8ee87';
const courseId = process.argv[3] || 'e555cd6c-3440-4d55-940a-e051da2811d8';

async function checkSessionsDisplay() {
  try {
    console.log('=== Sessions Display Check ===\n');
    console.log(`Student ID: ${studentId}`);
    console.log(`Course ID: ${courseId}\n`);
    
    // Step 1: Check sessions in database
    console.log('Step 1: Checking sessions in database...');
    const sessionsResult = await pool.query(
      `SELECT 
        id, 
        student_id, 
        trainer_id, 
        course_id, 
        allocation_id,
        scheduled_date, 
        scheduled_time, 
        status,
        created_at
       FROM tutoring_sessions
       WHERE student_id = $1
         AND course_id = $2
       ORDER BY scheduled_date ASC, scheduled_time ASC
       LIMIT 10`,
      [studentId, courseId]
    );
    
    console.log(`Found ${sessionsResult.rows.length} sessions (showing first 10):`);
    sessionsResult.rows.forEach((s, i) => {
      console.log(`   ${i + 1}. ID: ${s.id.substring(0, 8)}...`);
      console.log(`      Date: ${s.scheduled_date || 'NULL'}`);
      console.log(`      Time: ${s.scheduled_time || 'NULL'}`);
      console.log(`      Status: ${s.status || 'NULL'}`);
      console.log(`      Allocation ID: ${s.allocation_id || 'NULL'}`);
      console.log('');
    });
    
    // Step 2: Check allocation
    console.log('Step 2: Checking allocation...');
    const allocationResult = await pool.query(
      `SELECT id, trainer_id, status, metadata
       FROM trainer_allocations
       WHERE student_id = $1 AND course_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [studentId, courseId]
    );
    
    if (allocationResult.rows.length > 0) {
      const alloc = allocationResult.rows[0];
      console.log('✅ Allocation found:', alloc.id);
      console.log('   Trainer ID:', alloc.trainer_id);
      console.log('   Status:', alloc.status);
      
      // Check if sessions have correct allocation_id
      const sessionsWithAlloc = sessionsResult.rows.filter(s => s.allocation_id === alloc.id);
      console.log(`   Sessions linked to this allocation: ${sessionsWithAlloc.length}`);
    }
    
    // Step 3: Check date filtering (what home screen expects)
    console.log('\nStep 3: Checking date filtering...');
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + 90);
    endDate.setHours(23, 59, 59, 999);
    
    console.log('   Today:', today.toISOString());
    console.log('   End date (90 days):', endDate.toISOString());
    
    const upcomingSessions = sessionsResult.rows.filter(s => {
      if (!s.scheduled_date) return false;
      const sessionDate = new Date(s.scheduled_date);
      sessionDate.setHours(0, 0, 0, 0);
      return sessionDate >= today && sessionDate <= endDate;
    });
    
    console.log(`   Sessions within 90 days: ${upcomingSessions.length}`);
    
    // Step 4: Check session status
    console.log('\nStep 4: Checking session status...');
    const statusCounts = {};
    sessionsResult.rows.forEach(s => {
      const status = s.status || 'NULL';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    console.log('   Status breakdown:', statusCounts);
    
    // Step 5: Check if sessions have required fields
    console.log('\nStep 5: Checking required fields...');
    const sessionsWithIssues = sessionsResult.rows.filter(s => {
      return !s.scheduled_date || !s.scheduled_time || !s.allocation_id;
    });
    
    if (sessionsWithIssues.length > 0) {
      console.log(`   ⚠️  ${sessionsWithIssues.length} sessions missing required fields:`);
      sessionsWithIssues.forEach(s => {
        const issues = [];
        if (!s.scheduled_date) issues.push('scheduled_date');
        if (!s.scheduled_time) issues.push('scheduled_time');
        if (!s.allocation_id) issues.push('allocation_id');
        console.log(`      Session ${s.id.substring(0, 8)}... missing: ${issues.join(', ')}`);
      });
    } else {
      console.log('   ✅ All sessions have required fields');
    }
    
    // Step 6: Check cache
    console.log('\nStep 6: Recommendations...');
    if (sessionsResult.rows.length === 0) {
      console.log('   ❌ No sessions found in database');
      console.log('   → Sessions may not have been created after allocation');
    } else if (sessionsWithIssues.length > 0) {
      console.log('   ⚠️  Some sessions are missing required fields');
      console.log('   → This may cause them to be filtered out');
    } else if (upcomingSessions.length === 0) {
      console.log('   ⚠️  No sessions within 90-day window');
      console.log('   → Sessions may be too far in the future or in the past');
    } else {
      console.log('   ✅ Sessions exist and should be visible');
      console.log('   → If not showing, check:');
      console.log('      1. Cache invalidation (try refreshing)');
      console.log('      2. API response format');
      console.log('      3. Frontend filtering logic');
    }
    
    await pool.end();
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack:', error.stack);
    await pool.end();
    process.exit(1);
  }
}

checkSessionsDisplay();

