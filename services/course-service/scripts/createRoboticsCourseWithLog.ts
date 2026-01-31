/**
 * Script to create a Robotics Course with full structure
 * This version writes output to a log file for debugging
 */

import "@kodingcaravan/shared/config";
import { initPostgres, getPostgresPool } from '../src/config/database';
import { createCourseStructureTables } from '../src/models/courseStructure.model';
import { createCoursesTable } from '../src/models/course.model';
import { CourseRepository } from '../src/models/course.model';
import { CourseStructureRepository } from '../src/models/courseStructure.model';
import type { CreateSessionInput } from '../src/models/courseStructure.model';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

// Create a logger that writes to both console and file
const logFile = resolve(__dirname, 'createRoboticsCourse.log');
const logs: string[] = [];

function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  logs.push(logMessage);
  console.log(message);
}

function logError(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ERROR: ${message}`;
  logs.push(logMessage);
  console.error(message);
}

// Write logs to file on exit
process.on('exit', (code) => {
  try {
    writeFileSync(logFile, logs.join('\n') + `\n\nExit code: ${code}\n`);
    if (code === 0) {
      console.log(`\n📝 Full log saved to: ${logFile}`);
    }
  } catch (e) {
    // Ignore file write errors
  }
});

async function createRoboticsCourse() {
  let pool;
  try {
    log('🔍 Checking environment variables...');
    log(`   POSTGRES_URI: ${process.env.POSTGRES_URI ? '✓ Set' : '✗ Not set'}`);
    log(`   POSTGRES_HOST: ${process.env.POSTGRES_HOST || 'Not set'}`);
    log(`   POSTGRES_USER: ${process.env.POSTGRES_USER || 'Not set'}`);
    log(`   POSTGRES_DB: ${process.env.POSTGRES_DB || 'Not set'}`);
    log(`   POSTGRES_PASSWORD: ${process.env.POSTGRES_PASSWORD ? '✓ Set' : '✗ Not set'}`);
    log('');

    // Check environment variables
    if (!process.env.POSTGRES_URI && !process.env.POSTGRES_HOST) {
      logError('Database configuration missing!');
      logError('Please set POSTGRES_URI or POSTGRES_HOST in kc-backend/.env');
      process.exit(1);
    }

    // Initialize PostgreSQL connection
    log('🔌 Connecting to PostgreSQL...');
    try {
      await initPostgres();
      pool = getPostgresPool();
      log('✅ Database connected successfully!\n');
    } catch (error: any) {
      logError(`Database connection failed: ${error.message}`);
      throw error;
    }
    
    // Ensure tables exist
    log('📋 Creating database tables...');
    await createCoursesTable(pool);
    await createCourseStructureTables(pool);
    log('✅ Tables created/verified\n');
    
    const courseRepo = new CourseRepository(pool);
    const structureRepo = new CourseStructureRepository(pool);

    log('🚀 Starting Robotics Course Creation...\n');

    // Create course
    log('📚 Creating Robotics Course...');
    const course = await courseRepo.create({
      title: 'Robotics Fundamentals',
      description: `A comprehensive course covering the fundamentals of robotics, from basic concepts to advanced applications.`,
      shortDescription: 'Master robotics from basics to advanced applications with hands-on projects',
      category: 'STEM',
      subcategory: 'Robotics',
      level: 'beginner',
      price: 2999.00,
      currency: 'INR',
      discountPrice: 1999.00,
      thumbnailUrl: 'https://example.com/robotics-course-thumbnail.jpg',
      duration: 1800,
      tags: ['robotics', 'programming', 'electronics', 'arduino', 'sensors', 'automation'],
      language: 'en',
    });
    log(`✅ Course created: ${course.id} - ${course.title}\n`);

    // Create phases, levels, and sessions (simplified for testing)
    log('📖 Creating Phase 1: Introduction to Robotics...');
    const phase1 = await structureRepo.createPhase({
      courseId: course.id,
      title: 'Introduction to Robotics',
      description: 'Learn the basics of robotics',
      sequence: 1,
    });

    log('  Creating Level 1: Foundation...');
    const phase1Level1 = await structureRepo.createLevel({
      phaseId: phase1.id,
      levelType: 'foundation',
      title: 'Foundation: Robotics Basics',
      description: 'Introduction to robotics',
      sequence: 1,
    });

    // Create first session as test
    log('  Creating test session...');
    await structureRepo.createSession({
      levelId: phase1Level1.id,
      sessionNumber: 1,
      title: 'What is Robotics?',
      description: 'Introduction to robotics',
      expertVideoUrl: 'https://example.com/videos/robotics-intro.mp4',
      learningSheetPdfUrl: 'https://example.com/sheets/robotics-intro.pdf',
      coreActivity: 'Research robotics applications',
      keyConcepts: ['Robotics definition', 'History', 'Applications'],
    });
    log('✅ Test session created successfully!\n');

    log('🎉 Robotics Course Created Successfully!');
    log(`\n📊 Summary:`);
    log(`   Course ID: ${course.id}`);
    log(`   Course: ${course.title}`);
    log(`   Phase 1 created`);
    log(`   Level 1 created`);
    log(`   Session 1 created`);
    log(`\n✅ Course structure is ready!`);

  } catch (error: any) {
    logError(`Error creating robotics course: ${error.message}`);
    if (error.stack) {
      logError(`Stack: ${error.stack}`);
    }
    throw error;
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

// Run the script
if (require.main === module) {
  createRoboticsCourse()
    .then(() => {
      log('\n✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logError(`\n❌ Script failed: ${error.message}`);
      if (error.stack) {
        logError(error.stack);
      }
      process.exit(1);
    });
}

export { createRoboticsCourse };

