/**
 * Test script for automatic trainer assignment
 * Tests with existing trainers and student who purchased robotics course
 */

import "@kodingcaravan/shared/config";
import { Pool } from 'pg';
import { buildPostgresConnectionString } from '@kodingcaravan/shared/databases/postgres/connection';
import { initializeAdminAuth } from '../src/config/database';
import { AllocationService } from '../src/services/allocation.service';

// Create pool for testing
const pool = new Pool({
  connectionString: buildPostgresConnectionString(process.env),
});

async function testAutoAssignment() {
  console.log('🚀 Starting auto-assignment test...\n');
  
  // Initialize database connection
  try {
    await pool.query('SELECT 1');
    console.log('✅ Database connection successful\n');
  } catch (error: any) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }

  // Initialize admin auth (creates tables if needed)
  try {
    await initializeAdminAuth();
    console.log('✅ Database initialized\n');
  } catch (error: any) {
    console.error('❌ Database initialization failed:', error.message);
    process.exit(1);
  }

  const allocationService = new AllocationService();

  try {
    console.log('🔍 Checking existing data...\n');

    // 1. Get approved trainers
    const trainers = await pool.query(`
      SELECT 
        t.id,
        t.approval_status,
        tp.full_name,
        tp.gender,
        tp.specialties,
        tp.availability,
        tp.years_of_experience
      FROM trainers t
      LEFT JOIN trainer_profiles tp ON t.id = tp.trainer_id
      WHERE t.approval_status = 'approved'
      ORDER BY t.created_at
      LIMIT 10
    `);

    console.log(`✅ Found ${trainers.rows.length} approved trainer(s):`);
    trainers.rows.forEach((trainer, idx) => {
      console.log(`   ${idx + 1}. ${trainer.full_name || 'No name'} (${trainer.id})`);
      console.log(`      Gender: ${trainer.gender || 'Not set'}`);
      console.log(`      Specialties: ${trainer.specialties ? JSON.stringify(trainer.specialties) : 'None'}`);
      console.log(`      Experience: ${trainer.years_of_experience || 'Not set'} years`);
      console.log('');
    });

    // 2. Get robotics course
    const courses = await pool.query(`
      SELECT id, title, category, subcategory
      FROM courses
      WHERE title LIKE '%Robotics%' OR title LIKE '%robotics%'
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (courses.rows.length === 0) {
      console.error('❌ No Robotics course found!');
      console.log('   Please run: npm run create-robotics-course in course-service');
      process.exit(1);
    }

    const roboticsCourse = courses.rows[0];
    console.log(`✅ Found Robotics course: ${roboticsCourse.title} (${roboticsCourse.id})`);
    console.log(`   Category: ${roboticsCourse.category || 'Not set'}`);
    console.log(`   Subcategory: ${roboticsCourse.subcategory || 'Not set'}\n`);

    // 3. Get students with robotics course purchase
    const studentsWithPurchase = await pool.query(`
      SELECT DISTINCT
        sp.student_id,
        sp.full_name,
        sp.gender,
        spp.course_id,
        spp.purchase_tier
      FROM student_course_purchases spp
      INNER JOIN student_profiles sp ON sp.student_id = spp.student_id
      WHERE spp.course_id = $1
        AND spp.is_active = true
      LIMIT 5
    `, [roboticsCourse.id]);

    if (studentsWithPurchase.rows.length === 0) {
      console.warn('⚠️  No students found with active Robotics course purchase!');
      console.log('   This might mean the purchase record was not created after payment.');
      console.log('   Checking if student has progress record...\n');
      
      // Check if student has progress (meaning they were enrolled)
      const studentsWithProgress = await pool.query(`
        SELECT DISTINCT
          sp.student_id,
          sp.full_name,
          sp.gender
        FROM student_progress sp_progress
        INNER JOIN student_profiles sp ON sp.student_id = sp_progress.student_id
        WHERE sp_progress.course_id = $1
        LIMIT 5
      `, [roboticsCourse.id]);
      
      if (studentsWithProgress.rows.length > 0) {
        console.log(`✅ Found ${studentsWithProgress.rows.length} student(s) with progress (enrolled but no purchase record):`);
        studentsWithProgress.rows.forEach((student, idx) => {
          console.log(`   ${idx + 1}. ${student.full_name || 'No name'} (${student.student_id})`);
        });
        console.log('\n💡 To fix this, run:');
        console.log(`   npm run create-purchase ${studentsWithProgress.rows[0].student_id} ${roboticsCourse.id} 30`);
        console.log('\n   Or test auto-assignment with a student that has a purchase record.\n');
        process.exit(1);
      } else {
        console.error('❌ No students found with Robotics course enrollment!');
        console.log('   Please ensure a student has purchased and been enrolled in the Robotics course');
        process.exit(1);
      }
    }

    console.log(`✅ Found ${studentsWithPurchase.rows.length} student(s) with Robotics course purchase:`);
    studentsWithPurchase.rows.forEach((student, idx) => {
      console.log(`   ${idx + 1}. ${student.full_name || 'No name'} (${student.student_id})`);
      console.log(`      Gender: ${student.gender || 'Not set'}`);
      console.log(`      Purchase Tier: ${student.purchase_tier || 'Not set'} sessions\n`);
    });

    // 4. Check existing allocations for the first student
    const testStudent = studentsWithPurchase.rows[0];
    const existingAllocations = await pool.query(`
      SELECT id, trainer_id, status, metadata
      FROM trainer_allocations
      WHERE student_id = $1 AND course_id = $2
      ORDER BY created_at DESC
      LIMIT 5
    `, [testStudent.student_id, roboticsCourse.id]);

    console.log(`📋 Existing allocations for ${testStudent.full_name}:`);
    if (existingAllocations.rows.length === 0) {
      console.log('   No existing allocations found - ready for auto-assignment!\n');
    } else {
      existingAllocations.rows.forEach((alloc, idx) => {
        console.log(`   ${idx + 1}. Allocation ${alloc.id}`);
        console.log(`      Trainer: ${alloc.trainer_id || 'Not assigned'}`);
        console.log(`      Status: ${alloc.status}`);
        console.log(`      Metadata: ${alloc.metadata ? JSON.stringify(alloc.metadata) : 'None'}\n`);
      });
    }

    // 5. Test auto-assignment
    console.log('🚀 Testing auto-assignment...\n');
    console.log(`   Student: ${testStudent.full_name} (${testStudent.student_id})`);
    console.log(`   Course: ${roboticsCourse.title} (${roboticsCourse.id})`);
    console.log(`   Time Slot: 4:00 PM`);
    console.log(`   Date: ${new Date().toISOString().split('T')[0]}\n`);

    const allocation = await allocationService.autoAssignTrainerAfterPurchase(
      testStudent.student_id,
      roboticsCourse.id,
      '4:00 PM',
      new Date().toISOString().split('T')[0],
      testStudent.student_id
    );

    console.log('✅ Auto-assignment completed!\n');
    console.log('📊 Result:');
    console.log(`   Allocation ID: ${allocation.id}`);
    console.log(`   Status: ${allocation.status}`);
    console.log(`   Trainer ID: ${allocation.trainerId || 'Not assigned'}`);
    console.log(`   Notes: ${allocation.notes || 'None'}`);
    
    if (allocation.metadata) {
      console.log(`   Metadata:`);
      console.log(`      Auto-assigned: ${allocation.metadata.autoAssigned || false}`);
      console.log(`      Schedule: ${JSON.stringify(allocation.metadata.schedule || {})}`);
      if (allocation.metadata.matchingCriteria) {
        console.log(`      Matching Criteria:`);
        console.log(`         Gender Match: ${allocation.metadata.matchingCriteria.genderMatch}`);
        console.log(`         Time Slot Match: ${allocation.metadata.matchingCriteria.timeSlotMatch}`);
        console.log(`         Workload Balance: ${allocation.metadata.matchingCriteria.workloadBalance}`);
      }
    }

    // 6. Get trainer details if assigned
    if (allocation.trainerId) {
      const assignedTrainer = await pool.query(`
        SELECT 
          t.id,
          tp.full_name,
          tp.gender,
          tp.specialties
        FROM trainers t
        LEFT JOIN trainer_profiles tp ON t.id = tp.trainer_id
        WHERE t.id = $1
      `, [allocation.trainerId]);

      if (assignedTrainer.rows.length > 0) {
        const trainer = assignedTrainer.rows[0];
        console.log(`\n👤 Assigned Trainer:`);
        console.log(`   Name: ${trainer.full_name || 'No name'}`);
        console.log(`   Gender: ${trainer.gender || 'Not set'}`);
        console.log(`   Specialties: ${trainer.specialties ? JSON.stringify(trainer.specialties) : 'None'}`);
        
        // Check gender match
        if (testStudent.gender && trainer.gender) {
          const genderMatch = testStudent.gender.toLowerCase() === trainer.gender.toLowerCase();
          console.log(`   Gender Match: ${genderMatch ? '✅' : '❌'} (Student: ${testStudent.gender}, Trainer: ${trainer.gender})`);
        }
      }
    } else {
      console.log('\n⚠️  No trainer was assigned automatically.');
      console.log('   This allocation is pending and needs manual review.');
    }

    console.log('\n✅ Test completed successfully!');
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Ensure output is flushed
process.stdout.write('Starting test script...\n');

testAutoAssignment()
  .then(() => {
    console.log('\n✅ Test script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  });

