const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5432/kodingcaravan',
});

async function checkStudentSessionsIssue() {
  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    const studentId = '4902a349-8a45-428b-a8df-e8da57fce131';

    // 1. Check student profile and GPS coordinates
    console.log('📍 Checking student profile and GPS coordinates...');
    const profileResult = await client.query(`
      SELECT 
        student_id,
        full_name,
        address,
        latitude,
        longitude,
        created_at
      FROM student_profiles
      WHERE student_id = $1
    `, [studentId]);

    if (profileResult.rows.length === 0) {
      console.log('❌ Student profile not found!');
      return;
    }

    const profile = profileResult.rows[0];
    console.log('Student Profile:');
    console.log(`  Name: ${profile.full_name || 'N/A'}`);
    console.log(`  Address: ${profile.address || 'N/A'}`);
    console.log(`  Latitude: ${profile.latitude || '❌ MISSING'}`);
    console.log(`  Longitude: ${profile.longitude || '❌ MISSING'}`);
    
    if (!profile.latitude || !profile.longitude) {
      console.log('\n⚠️  CRITICAL: Student is missing GPS coordinates!');
      console.log('   Sessions cannot be created without GPS coordinates.');
      console.log('   Solution: Update student address in profile to generate coordinates.\n');
    } else {
      console.log('✅ GPS coordinates are set\n');
    }

    // 2. Check allocations
    console.log('📋 Checking allocations...');
    const allocationResult = await client.query(`
      SELECT 
        id,
        student_id,
        trainer_id,
        course_id,
        status,
        metadata,
        created_at
      FROM trainer_allocations
      WHERE student_id = $1
      ORDER BY created_at DESC
    `, [studentId]);

    console.log(`Found ${allocationResult.rows.length} allocations:`);
    allocationResult.rows.forEach((alloc, idx) => {
      console.log(`\n  ${idx + 1}. Allocation ID: ${alloc.id}`);
      console.log(`     Status: ${alloc.status}`);
      console.log(`     Trainer: ${alloc.trainer_id || 'Not assigned'}`);
      console.log(`     Course: ${alloc.course_id || 'N/A'}`);
      const metadata = alloc.metadata || {};
      console.log(`     Session Count: ${metadata.sessionCount || 'Not set'}`);
      console.log(`     Schedule: ${metadata.schedule ? JSON.stringify(metadata.schedule) : 'Not set'}`);
    });

    // 3. Check sessions
    console.log('\n📅 Checking sessions...');
    const sessionResult = await client.query(`
      SELECT 
        id,
        allocation_id,
        student_id,
        trainer_id,
        course_id,
        scheduled_date,
        scheduled_time,
        status,
        created_at
      FROM tutoring_sessions
      WHERE student_id = $1
      ORDER BY scheduled_date ASC, scheduled_time ASC
      LIMIT 20
    `, [studentId]);

    console.log(`Found ${sessionResult.rows.length} sessions:`);
    if (sessionResult.rows.length === 0) {
      console.log('❌ NO SESSIONS FOUND!');
      console.log('\n🔍 Possible reasons:');
      console.log('   1. Sessions were not created after payment');
      console.log('   2. Student missing GPS coordinates (prevents session creation)');
      console.log('   3. Allocation was not approved');
      console.log('   4. Session creation failed silently');
    } else {
      sessionResult.rows.forEach((session, idx) => {
        console.log(`\n  ${idx + 1}. Session ID: ${session.id}`);
        console.log(`     Date: ${session.scheduled_date}`);
        console.log(`     Time: ${session.scheduled_time}`);
        console.log(`     Status: ${session.status}`);
        console.log(`     Trainer: ${session.trainer_id || 'N/A'}`);
        console.log(`     Course: ${session.course_id || 'N/A'}`);
      });
    }

    // 4. Check purchase records
    console.log('\n💰 Checking purchase records...');
    const purchaseResult = await client.query(`
      SELECT 
        id,
        student_id,
        course_id,
        purchase_tier,
        metadata,
        created_at
      FROM purchases
      WHERE student_id = $1
      ORDER BY created_at DESC
    `, [studentId]);

    console.log(`Found ${purchaseResult.rows.length} purchases:`);
    purchaseResult.rows.forEach((purchase, idx) => {
      console.log(`\n  ${idx + 1}. Purchase ID: ${purchase.id}`);
      console.log(`     Course: ${purchase.course_id}`);
      console.log(`     Tier: ${purchase.purchase_tier || 'N/A'}`);
      console.log(`     Created: ${purchase.created_at}`);
    });

    // 5. Summary and recommendations
    console.log('\n📊 SUMMARY:');
    console.log(`   Allocations: ${allocationResult.rows.length}`);
    console.log(`   Sessions: ${sessionResult.rows.length}`);
    console.log(`   Purchases: ${purchaseResult.rows.length}`);
    
    if (sessionResult.rows.length === 0 && allocationResult.rows.length > 0) {
      console.log('\n🔧 RECOMMENDED ACTIONS:');
      const approvedAllocations = allocationResult.rows.filter(a => a.status === 'approved');
      if (approvedAllocations.length > 0) {
        console.log(`   1. Create sessions for ${approvedAllocations.length} approved allocation(s)`);
        approvedAllocations.forEach(alloc => {
          console.log(`      - Allocation ID: ${alloc.id}`);
          const sessionCount = alloc.metadata?.sessionCount || 30;
          console.log(`        Expected sessions: ${sessionCount}`);
        });
      }
      
      if (!profile.latitude || !profile.longitude) {
        console.log('   2. Update student address to generate GPS coordinates');
        console.log('      (Required for session creation)');
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

checkStudentSessionsIssue();

