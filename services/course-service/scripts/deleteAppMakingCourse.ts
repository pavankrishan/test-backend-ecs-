/**
 * Script to delete the old "App Making" course and all its related data
 * 
 * This will delete:
 * - The course itself
 * - All phases (cascades)
 * - All levels (cascades)
 * - All sessions (cascades)
 * 
 * WARNING: This will permanently delete the course and all its data!
 * Make sure you have a backup if needed.
 */

import "@kodingcaravan/shared/config";

import { initPostgres, getPostgresPool } from '../src/config/database';
import { CourseRepository } from '../src/models/course.model';

async function deleteAppMakingCourse() {
  let pool;
  try {
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

    const courseRepo = new CourseRepository(pool);

    console.log('🔍 Searching for "App Making" course...\n');

    // Find course by title
    const courses = await pool.query(
      "SELECT id, title, created_at FROM courses WHERE title ILIKE '%app making%' OR title ILIKE '%App Making%'"
    );

    if (courses.rows.length === 0) {
      console.log('✅ No "App Making" course found. Nothing to delete.\n');
      return;
    }

    console.log(`📚 Found ${courses.rows.length} course(s) with "App Making" in title:\n`);
    courses.rows.forEach((course, index) => {
      console.log(`   ${index + 1}. ID: ${course.id}`);
      console.log(`      Title: ${course.title}`);
      console.log(`      Created: ${course.created_at}`);
      console.log('');
    });

    // Delete each course (CASCADE will delete phases, levels, sessions automatically)
    for (const course of courses.rows) {
      console.log(`🗑️  Deleting course: ${course.title} (${course.id})...`);
      
      const deleted = await courseRepo.delete(course.id);
      
      if (deleted) {
        console.log(`✅ Course deleted successfully!\n`);
        console.log('   Note: All related phases, levels, and sessions were automatically deleted (CASCADE).\n');
      } else {
        console.log(`⚠️  Course not found or already deleted.\n`);
      }
    }

    console.log('🎉 Cleanup completed!\n');
    console.log('📝 You can now run createAppDevelopmentCourse.ts to create the new "App Development" course.\n');

  } catch (error: any) {
    console.error('\n❌ Error deleting App Making course:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.end();
      console.log('✅ Database connection closed');
    }
  }
}

// Run the script
deleteAppMakingCourse().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
