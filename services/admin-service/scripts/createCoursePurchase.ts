/**
 * Script to create a course purchase record for a student
 * Use this to fix missing purchase records after payment
 */

import "@kodingcaravan/shared/config";
import { Pool } from 'pg';
import { buildPostgresConnectionString } from '@kodingcaravan/shared/databases/postgres/connection';
import { request } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';

// Create pool for testing
const pool = new Pool({
  connectionString: buildPostgresConnectionString(process.env),
});

async function createCoursePurchase() {
  try {
    console.log('🔍 Finding student and course...\n');

    // Get student ID from command line or use default
    const studentId = process.argv[2] || 'be36fafb-5cfa-444e-822b-132f071f9408';
    const courseId = process.argv[3] || '9e16d892-4324-4568-be60-163aa1665683';
    const purchaseTier = parseInt(process.argv[4] || '30') as 10 | 20 | 30;

    // Verify student exists
    const student = await pool.query(`
      SELECT sp.student_id, sp.full_name, sp.gender
      FROM student_profiles sp
      WHERE sp.student_id = $1
    `, [studentId]);

    if (student.rows.length === 0) {
      console.error(`❌ Student not found: ${studentId}`);
      process.exit(1);
    }

    console.log(`✅ Found student: ${student.rows[0].full_name} (${studentId})\n`);

    // Verify course exists
    const course = await pool.query(`
      SELECT id, title
      FROM courses
      WHERE id = $1
    `, [courseId]);

    if (course.rows.length === 0) {
      console.error(`❌ Course not found: ${courseId}`);
      process.exit(1);
    }

    console.log(`✅ Found course: ${course.rows[0].title} (${courseId})\n`);

    // Check if purchase already exists
    const existingPurchase = await pool.query(`
      SELECT id, purchase_tier, is_active
      FROM student_course_purchases
      WHERE student_id = $1 AND course_id = $2
      ORDER BY created_at DESC
      LIMIT 1
    `, [studentId, courseId]);

    if (existingPurchase.rows.length > 0 && existingPurchase.rows[0].is_active) {
      console.log('⚠️  Active purchase already exists:');
      console.log(`   Purchase ID: ${existingPurchase.rows[0].id}`);
      console.log(`   Purchase Tier: ${existingPurchase.rows[0].purchase_tier} sessions`);
      console.log('\n✅ No action needed - purchase already exists!');
      process.exit(0);
    }

    // Create purchase directly in database (more reliable than API call)
    console.log('🚀 Creating course purchase...\n');
    console.log(`   Student: ${student.rows[0].full_name}`);
    console.log(`   Course: ${course.rows[0].title}`);
    console.log(`   Purchase Tier: ${purchaseTier} sessions\n`);

    // Deactivate any existing purchases for this course
    await pool.query(`
      UPDATE student_course_purchases
      SET is_active = false
      WHERE student_id = $1 AND course_id = $2
    `, [studentId, courseId]);

    // Create new purchase
    const purchaseResult = await pool.query(`
      INSERT INTO student_course_purchases (
        student_id,
        course_id,
        purchase_tier,
        purchase_date,
        is_active
      )
      VALUES ($1, $2, $3, NOW(), true)
      RETURNING id, student_id, course_id, purchase_tier, purchase_date, is_active
    `, [studentId, courseId, purchaseTier]);

    const purchase = purchaseResult.rows[0];

    console.log('✅ Course purchase created successfully!\n');
    console.log('📊 Purchase Details:');
    console.log(`   Purchase ID: ${purchase.id}`);
    console.log(`   Student ID: ${purchase.student_id}`);
    console.log(`   Course ID: ${purchase.course_id}`);
    console.log(`   Purchase Tier: ${purchase.purchase_tier} sessions`);
    console.log(`   Purchase Date: ${purchase.purchase_date}`);
    console.log(`   Is Active: ${purchase.is_active}`);
    console.log('\n✅ The course should now appear in the student\'s learnings!');
    
    // Initialize student access (unlock sessions based on purchase tier)
    console.log('\n🔓 Initializing student access...');
    
    // Get phases for the course
    const phases = await pool.query(`
      SELECT id, sequence
      FROM course_phases
      WHERE course_id = $1
      ORDER BY sequence
    `, [courseId]);
    
    let unlockedSessions = 0;
    
    for (const phase of phases.rows) {
      // Get levels for this phase
      const levels = await pool.query(`
        SELECT id, level_type, sequence
        FROM course_levels
        WHERE phase_id = $1
        ORDER BY sequence
      `, [phase.id]);
      
      for (const level of levels.rows) {
        // Determine unlock based on level type and purchase tier
        // Tier 10: foundation level only (sessions 1-10)
        // Tier 20: foundation + development (sessions 1-20)
        // Tier 30: all levels (sessions 1-30)
        const levelOrder: Record<string, number> = {
          foundation: 1,
          development: 2,
          mastery: 3,
        };
        
        const maxLevelOrder = purchaseTier === 10 ? 1 : purchaseTier === 20 ? 2 : 3;
        const maxSessionNumber = purchaseTier;
        const currentLevelOrder = levelOrder[level.level_type] || 0;
        
        // Check if level should be unlocked
        let shouldUnlockLevel = false;
        if (currentLevelOrder < maxLevelOrder) {
          shouldUnlockLevel = true; // Earlier levels are always unlocked
        } else if (currentLevelOrder === maxLevelOrder) {
          shouldUnlockLevel = true; // Same level, check session numbers
        } else {
          shouldUnlockLevel = false; // Beyond max level
        }
        
        if (shouldUnlockLevel) {
          // Get sessions for this level
          const sessions = await pool.query(`
            SELECT id, session_number
            FROM course_sessions
            WHERE level_id = $1
            ORDER BY session_number
          `, [level.id]);
          
          // Create progress records for unlocked sessions
          for (const session of sessions.rows) {
            // For same level, check if session number is within purchase tier
            let shouldUnlockSession = true;
            if (currentLevelOrder === maxLevelOrder) {
              shouldUnlockSession = session.session_number <= maxSessionNumber;
            }
            
            if (shouldUnlockSession) {
              await pool.query(`
                INSERT INTO student_progress (
                  student_id, course_id, phase_id, level_id, session_id, is_unlocked, status, unlocked_at
                )
                VALUES ($1, $2, $3, $4, $5, true, 'not_started', NOW())
                ON CONFLICT (student_id, session_id) 
                DO UPDATE SET 
                  is_unlocked = true, 
                  unlocked_at = NOW(),
                  status = CASE WHEN student_progress.status = 'locked' THEN 'not_started' ELSE student_progress.status END,
                  updated_at = NOW()
              `, [studentId, courseId, phase.id, level.id, session.id]);
              unlockedSessions++;
            }
          }
        }
      }
    }
    
    // Count total sessions in course for verification
    const totalSessionsResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM course_sessions cs
      INNER JOIN course_levels cl ON cs.level_id = cl.id
      INNER JOIN course_phases cp ON cl.phase_id = cp.id
      WHERE cp.course_id = $1
    `, [courseId]);
    
    const totalSessions = parseInt(totalSessionsResult.rows[0]?.total || '0');
    
    console.log(`✅ Unlocked ${unlockedSessions} sessions for student!`);
    console.log(`   Total sessions in course: ${totalSessions}`);
    console.log(`   Purchase Tier: ${purchaseTier} sessions`);
    console.log(`   Access Level: ${purchaseTier === 10 ? 'Level 1 (Foundation)' : purchaseTier === 20 ? 'Level 1-2 (Foundation + Development)' : 'All Levels (Full Course)'}`);
    
    if (totalSessions === 0) {
      console.warn('\n⚠️  WARNING: No sessions found in this course!');
      console.warn('   The course structure may not be fully created.');
      console.warn('   Run: cd ../course-service && npm run create-robotics-course');
    } else if (unlockedSessions < totalSessions && purchaseTier === 30) {
      console.warn(`\n⚠️  WARNING: Only ${unlockedSessions} of ${totalSessions} sessions were unlocked!`);
      console.warn('   This might indicate an issue with the unlock logic.');
    } else if (unlockedSessions === totalSessions) {
      console.log(`\n✅ All ${totalSessions} sessions are now unlocked!`);
    }

    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createCoursePurchase();

