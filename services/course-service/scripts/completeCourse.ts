/**
 * Script to mark a course as completed for a student
 * 
 * This script:
 * - Marks all sessions in the course as completed
 * - Updates student_progress table for all sessions
 * - Sets video_watched, sheet_previewed, quiz_completed to true
 * - Sets status to 'completed' for all sessions
 * 
 * Usage:
 *   ts-node scripts/completeCourse.ts <studentId> <courseId>
 * 
 * Example:
 *   ts-node scripts/completeCourse.ts "123e4567-e89b-12d3-a456-426614174000" "123e4567-e89b-12d3-a456-426614174001"
 */

import "@kodingcaravan/shared/config";

import { initPostgres, getPostgresPool } from '../src/config/database';
import { createCourseStructureTables } from '../src/models/courseStructure.model';
import { CourseStructureRepository } from '../src/models/courseStructure.model';
import { CourseRepository } from '../src/models/course.model';

async function completeCourse(studentId: string, courseId: string) {
  let pool;
  try {
    // Validate inputs
    if (!studentId || !courseId) {
      console.error('❌ Error: Both studentId and courseId are required');
      console.error('\nUsage: ts-node scripts/completeCourse.ts <studentId> <courseId>');
      process.exit(1);
    }

    // Check environment variables
    console.log('🔍 Checking environment variables...');
    console.log('   DATABASE_URL:', process.env.DATABASE_URL ? '✓ Set' : '✗ Not set');
    console.log('   POSTGRES_URL:', process.env.POSTGRES_URL ? '✓ Set' : '✗ Not set');
    console.log('   POSTGRES_URI:', process.env.POSTGRES_URI ? '✓ Set' : '✗ Not set');
    console.log('   POSTGRES_HOST:', process.env.POSTGRES_HOST || 'Not set');
    console.log('');

    if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL && !process.env.POSTGRES_URI && !process.env.POSTGRES_HOST) {
      console.error('\n❌ Database configuration missing!');
      console.error('\n📝 Please set database credentials in your .env file: kc-backend/.env');
      console.error('   Required: DATABASE_URL, POSTGRES_URL, POSTGRES_URI, or POSTGRES_HOST (with POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB)\n');
      process.exit(1);
    }

    // Initialize PostgreSQL connection
    console.log('🔌 Connecting to PostgreSQL...');
    try {
      await initPostgres();
      pool = getPostgresPool();
      console.log('✅ Database connected successfully!\n');
    } catch (error: any) {
      console.error('\n❌ Database connection failed!');
      console.error('Error:', error.message);
      throw error;
    }

    // Ensure tables exist
    await createCourseStructureTables(pool);

    const courseRepo = new CourseRepository(pool);
    const structureRepo = new CourseStructureRepository(pool);

    console.log('🚀 Starting Course Completion Process...\n');

    // ============================================================================
    // VALIDATE COURSE EXISTS
    // ============================================================================
    console.log('📚 Validating course...');
    const course = await courseRepo.findById(courseId);
    if (!course) {
      console.error(`❌ Course not found: ${courseId}`);
      process.exit(1);
    }
    console.log(`✅ Course found: ${course.title} (${course.id})\n`);

    // ============================================================================
    // GET ALL SESSIONS IN COURSE
    // ============================================================================
    console.log('📖 Getting course structure...');
    const phases = await structureRepo.getPhasesByCourseId(courseId);
    
    if (phases.length === 0) {
      console.error(`❌ No phases found for course: ${course.title}`);
      process.exit(1);
    }

    let totalSessions = 0;
    const sessionsToComplete: Array<{
      sessionId: string;
      phaseId: string;
      levelId: string;
      sessionNumber: number;
      title: string;
    }> = [];

    for (const phase of phases) {
      const levels = await structureRepo.getLevelsByPhaseId(phase.id);
      
      for (const level of levels) {
        const sessions = await structureRepo.getSessionsByLevelId(level.id);
        
        for (const session of sessions) {
          sessionsToComplete.push({
            sessionId: session.id,
            phaseId: phase.id,
            levelId: level.id,
            sessionNumber: session.sessionNumber,
            title: session.title,
          });
          totalSessions++;
        }
      }
    }

    console.log(`✅ Found ${phases.length} phase(s) with ${totalSessions} total session(s)\n`);

    if (totalSessions === 0) {
      console.error(`❌ No sessions found for course: ${course.title}`);
      process.exit(1);
    }

    // ============================================================================
    // MARK ALL SESSIONS AS COMPLETED
    // ============================================================================
    console.log('📝 Marking all sessions as completed...\n');
    
    let completedCount = 0;
    let createdCount = 0;
    let updatedCount = 0;

    for (const session of sessionsToComplete) {
      try {
        // Get or create progress entry
        const progress = await structureRepo.getOrCreateProgress(
          studentId,
          courseId,
          session.phaseId,
          session.levelId,
          session.sessionId
        );

        // Check if already completed
        const wasCompleted = progress.status === 'completed' && 
                            progress.videoWatched && 
                            progress.sheetPreviewed && 
                            progress.quizCompleted;

        if (wasCompleted) {
          console.log(`   ⏭️  Session ${session.sessionNumber}: "${session.title}" - Already completed`);
          completedCount++;
          continue;
        }

        // Mark as completed
        await structureRepo.updateProgress(progress.id, {
          videoWatched: true,
          sheetPreviewed: true,
          quizCompleted: true,
          quizScore: 100, // Default score
          quizMaxScore: 100,
        });

        // Ensure status is set to completed (updateProgress might not always set it)
        await pool.query(
          `UPDATE student_progress 
           SET status = 'completed',
               video_watched = true,
               video_watched_at = COALESCE(video_watched_at, NOW()),
               sheet_previewed = true,
               sheet_previewed_at = COALESCE(sheet_previewed_at, NOW()),
               quiz_completed = true,
               quiz_completed_at = COALESCE(quiz_completed_at, NOW()),
               is_unlocked = true,
               unlocked_at = COALESCE(unlocked_at, NOW())
           WHERE id = $1`,
          [progress.id]
        );

        if (progress.status === 'not_started' || progress.status === 'locked') {
          createdCount++;
          console.log(`   ✅ Session ${session.sessionNumber}: "${session.title}" - Marked as completed (new)`);
        } else {
          updatedCount++;
          console.log(`   ✅ Session ${session.sessionNumber}: "${session.title}" - Marked as completed (updated)`);
        }
        completedCount++;
      } catch (error: any) {
        console.error(`   ❌ Error completing session ${session.sessionNumber}: "${session.title}"`);
        console.error(`      Error: ${error.message}`);
      }
    }

    // ============================================================================
    // SUMMARY
    // ============================================================================
    console.log('\n🎉 Course Completion Process Completed!');
    console.log('');
    console.log('📊 Summary:');
    console.log(`   Course: ${course.title} (${course.id})`);
    console.log(`   Student ID: ${studentId}`);
    console.log(`   Total Sessions: ${totalSessions}`);
    console.log(`   Completed: ${completedCount}`);
    console.log(`   New Entries: ${createdCount}`);
    console.log(`   Updated Entries: ${updatedCount}`);
    console.log('');

    // Check course progress
    console.log('📈 Checking course progress...');
    const allProgress = await structureRepo.getStudentProgressByCourse(studentId, courseId);
    const completedProgress = allProgress.filter(p => p.status === 'completed');
    const percentage = totalSessions > 0 ? Math.round((completedProgress.length / totalSessions) * 100) : 0;
    
    console.log(`   Progress: ${completedProgress.length}/${totalSessions} sessions (${percentage}%)`);
    console.log('');

    if (completedCount === totalSessions) {
      console.log('✅ All sessions have been marked as completed!');
      console.log('   The course completion notification should be triggered automatically.');
      console.log('   Note: student_course_progress table will be updated via database triggers.');
    } else {
      console.log(`⚠️  Warning: Only ${completedCount} out of ${totalSessions} sessions were completed.`);
    }
    console.log('');

  } catch (error: any) {
    console.error('\n❌ Error completing course:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.end();
      console.log('✅ Database connection closed');
    }
  }
}

// Get command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('❌ Error: Missing required arguments');
  console.error('\nUsage: ts-node scripts/completeCourse.ts <studentId> <courseId>');
  console.error('\nExample:');
  console.error('  ts-node scripts/completeCourse.ts "123e4567-e89b-12d3-a456-426614174000" "123e4567-e89b-12d3-a456-426614174001"');
  process.exit(1);
}

const [studentId, courseId] = args;

// Run the script
completeCourse(studentId, courseId).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
