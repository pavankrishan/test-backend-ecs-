/**
 * Script to create an App Development Course with full structure
 * 
 * Run this script to create:
 * - Course: App Development
 * - 1 Phase: Growth Cycle 1
 * - 3 Levels: Foundation (Sessions 1-10), Development (Sessions 11-20), Mastery (Sessions 21-30)
 * - 30 Sessions total (10 per level)
 * 
 * Note: Growth Cycles 2 and 3 will be added later
 * 
 * This script uses the NEW refactored structure:
 * - Uses 'difficulty' instead of 'level' for course
 * - Uses S3 keys instead of public URLs
 * - Quizzes are stored separately in MongoDB (created separately)
 */

import "@kodingcaravan/shared/config";

import { initPostgres, getPostgresPool } from '../src/config/database';
import { createCourseStructureTables } from '../src/models/courseStructure.model';
import { createCoursesTable } from '../src/models/course.model';
import { CourseRepository } from '../src/models/course.model';
import { CourseStructureRepository } from '../src/models/courseStructure.model';
import type { CreateSessionInput } from '../src/models/courseStructure.model';

async function createAppDevelopmentCourse() {
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

    // Ensure tables exist
    await createCoursesTable(pool);
    await createCourseStructureTables(pool);

    const courseRepo = new CourseRepository(pool);
    const structureRepo = new CourseStructureRepository(pool);

    console.log('🚀 Starting App Development Course Creation...\n');

    // ============================================================================
    // CREATE COURSE
    // ============================================================================
    console.log('📚 Creating App Development Course...');
    const course = await courseRepo.create({
      title: 'App Development',
      description: `A comprehensive course on building mobile applications using MIT App Inventor. This course covers everything from basic app development concepts to advanced game development and real-world applications.

This course is designed for students who want to:
- Learn mobile app development from scratch
- Master MIT App Inventor platform
- Build interactive apps and games
- Understand app design principles
- Create real-world applications
- Develop problem-solving skills through projects

The course uses a hands-on, project-based approach with 30 sessions covering Text-to-Speech apps, games, calculators, location services, and more.`,
      shortDescription: 'Learn mobile app development using MIT App Inventor - from basics to advanced games and real-world applications',
      category: 'Coding',
      difficulty: 'beginner',
      price: 8999.00,
      currency: 'INR',
      thumbnailUrl: 'https://example.com/app-development-course-thumbnail.jpg',
      duration: 600, // 30 sessions × 20 min average = 10 hours
      tags: ['app-development', 'mit-app-inventor', 'mobile-apps', 'game-development', 'beginner', 'block-programming', 'projects'],
      language: 'en',
    });

    console.log(`✅ Course created: ${course.id} - ${course.title}\n`);

    // ============================================================================
    // PHASE 1: GROWTH CYCLE 1
    // ============================================================================
    console.log('📖 Creating Phase 1: Growth Cycle 1...');
    const phase1 = await structureRepo.createPhase({
      courseId: course.id,
      title: 'Growth Cycle 1',
      description: 'First growth cycle covering Foundation (Sessions 1-10), Development (Sessions 11-20), and Mastery (Sessions 21-30) levels. Learn app development from basics to advanced applications.',
      sequence: 1,
    });

    // ============================================================================
    // LEVEL 1: FOUNDATION (Sessions 1-10)
    // ============================================================================
    console.log('  Creating Level 1: Foundation (Sessions 1-10)...');
    const level1Foundation = await structureRepo.createLevel({
      phaseId: phase1.id,
      levelType: 'foundation',
      title: 'Foundation: App Development Basics',
      description: 'Introduction to MIT App Inventor, basic components, and building simple interactive apps. Sessions 1-10.',
      sequence: 1,
    });

    // Foundation Sessions (1-10)
    const foundationSessions: CreateSessionInput[] = [
      {
        levelId: level1Foundation.id,
        sessionNumber: 1,
        title: 'Text to Speech',
        description: 'Introduction to app development & TTS. Create a Text-to-Speech app using TextBox and Button components.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_1_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_1_Sheet.pdf',
        coreActivity: 'Create Text-to-Speech app',
        keyConcepts: ['TextBox', 'Button', 'TTS'],
      },
      {
        levelId: level1Foundation.id,
        sessionNumber: 2,
        title: 'Introduction to MIT',
        description: 'Learn MIT App Inventor & Designer. Explore the interface and understand the Designer and Blocks editor.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_2_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_2_Sheet.pdf',
        coreActivity: 'Explore interface',
        keyConcepts: ['Designer', 'Blocks'],
      },
      {
        levelId: level1Foundation.id,
        sessionNumber: 3,
        title: 'Blocks & Components',
        description: 'Learn screens and components. Identify visible and non-visible components in app design.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_3_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_3_Sheet.pdf',
        coreActivity: 'Identify visible & non-visible components',
        keyConcepts: ['Screens', 'Components'],
      },
      {
        levelId: level1Foundation.id,
        sessionNumber: 4,
        title: 'Run App',
        description: 'Learn 3 ways to run app. Test app on mobile/emulator using AI Companion and Emulator.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_4_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_4_Sheet.pdf',
        coreActivity: 'Test app on mobile/emulator',
        keyConcepts: ['AI Companion', 'Emulator'],
      },
      {
        levelId: level1Foundation.id,
        sessionNumber: 5,
        title: 'Digital Doodle',
        description: 'Draw on screen with finger drawing and shake to erase functionality using Canvas and Accelerometer.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_5_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_5_Sheet.pdf',
        coreActivity: 'Finger drawing & shake to erase',
        keyConcepts: ['Canvas', 'Accelerometer'],
      },
      {
        levelId: level1Foundation.id,
        sessionNumber: 6,
        title: 'Logic Blocks',
        description: 'Learn conditions & loops. Apply IF, ELSE, and FOR statements in app logic.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_6_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_6_Sheet.pdf',
        coreActivity: 'Apply IF, ELSE, FOR',
        keyConcepts: ['Logic', 'Events'],
      },
      {
        levelId: level1Foundation.id,
        sessionNumber: 7,
        title: 'Language Translator',
        description: 'Build English to Hindi translator app using API, TextBox, and Label components.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_7_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_7,8_Sheet.pdf',
        coreActivity: 'Build API translator app',
        keyConcepts: ['TextBox', 'Label', 'API'],
      },
      {
        levelId: level1Foundation.id,
        sessionNumber: 8,
        title: 'Theory Exam',
        description: 'Check learning with block-based test. Review key concepts covered so far.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_8_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_7,8_Sheet.pdf',
        coreActivity: 'Block-based test',
        keyConcepts: ['Concepts review'],
      },
      {
        levelId: level1Foundation.id,
        sessionNumber: 9,
        title: 'Mini Project',
        description: 'Apply knowledge by creating a student app. Focus on creativity and problem-solving.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_9_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_9,10_Sheet_SP_1.pdf',
        coreActivity: 'Student app',
        keyConcepts: ['Creativity'],
      },
      {
        levelId: level1Foundation.id,
        sessionNumber: 10,
        title: 'Mini Project',
        description: 'Strengthen skills with another student app project. Focus on problem-solving and applying learned concepts.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_10_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_9,10_Sheet_SP_1.pdf',
        coreActivity: 'Student app',
        keyConcepts: ['Problem solving'],
      },
    ];

    console.log(`  Creating ${foundationSessions.length} sessions for Foundation level...`);
    for (const session of foundationSessions) {
      await structureRepo.createSession(session);
    }
    console.log('  ✅ Foundation level sessions created\n');

    // ============================================================================
    // LEVEL 2: DEVELOPMENT (Sessions 11-20)
    // ============================================================================
    console.log('  Creating Level 2: Development (Sessions 11-20)...');
    const level2Development = await structureRepo.createLevel({
      phaseId: phase1.id,
      levelType: 'development',
      title: 'Development: Interactive Applications',
      description: 'Build interactive apps using variables, functions, math operations, and game development basics. Sessions 11-20.',
      sequence: 2,
    });

    // Development Sessions (11-20)
    const developmentSessions: CreateSessionInput[] = [
      {
        levelId: level2Development.id,
        sessionNumber: 1,
        title: 'Set, Get, Call',
        description: 'Learn block operations. Use SET, GET, and CALL blocks for variables and functions.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_11_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_11_Sheet.pdf',
        coreActivity: 'Use SET, GET, CALL',
        keyConcepts: ['Variables', 'Functions'],
      },
      {
        levelId: level2Development.id,
        sessionNumber: 2,
        title: 'Calculator',
        description: 'Build calculator app with add, subtract, and multiply operations using Math blocks and TextBox.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_12_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_12_Sheet.pdf',
        coreActivity: 'Add, subtract, multiply',
        keyConcepts: ['Math', 'TextBox'],
      },
      {
        levelId: level2Development.id,
        sessionNumber: 3,
        title: 'Blind Navigator',
        description: 'Assist visually impaired users with object detection and voice feedback using Proximity sensor and TTS.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_13_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_13_Sheet.pdf',
        coreActivity: 'Object detection with voice',
        keyConcepts: ['Proximity', 'TTS'],
      },
      {
        levelId: level2Development.id,
        sessionNumber: 4,
        title: 'Snake Game',
        description: 'Learn game basics with snake movement using Canvas and Sprite components.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_14_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_14,15,16_Sheet.pdf',
        coreActivity: 'Snake movement',
        keyConcepts: ['Canvas', 'Sprite'],
      },
      {
        levelId: level2Development.id,
        sessionNumber: 5,
        title: 'Snake Game',
        description: 'Improve gameplay by adding controls and speed adjustments using Buttons and game logic.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_15_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_14,15,16_Sheet.pdf',
        coreActivity: 'Add controls',
        keyConcepts: ['Buttons', 'Speed'],
      },
      {
        levelId: level2Development.id,
        sessionNumber: 6,
        title: 'Snake Game',
        description: 'Advanced play with score system and restart functionality using Logic and Variables.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_16_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_14,15,16_Sheet.pdf',
        coreActivity: 'Score & restart',
        keyConcepts: ['Logic', 'Variables'],
      },
      {
        levelId: level2Development.id,
        sessionNumber: 7,
        title: 'Bouncing Ball',
        description: 'Learn physics and ball movement with speed and direction controls for bouncing effects.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_17_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_17_Sheet.pdf',
        coreActivity: 'Ball bounce',
        keyConcepts: ['Speed', 'Direction'],
      },
      {
        levelId: level2Development.id,
        sessionNumber: 8,
        title: 'Camera App',
        description: 'Use mobile camera to capture and store photos using Camera component and TinyDB for storage.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_18_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_18_Sheet.pdf',
        coreActivity: 'Capture & store photo',
        keyConcepts: ['Camera', 'TinyDB'],
      },
      {
        levelId: level2Development.id,
        sessionNumber: 9,
        title: 'Theory Exam',
        description: 'Evaluate knowledge with block-based test. Review and revise concepts learned.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_19_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_19,20_Sheet_SP_2.pdf',
        coreActivity: 'Block-based test',
        keyConcepts: ['Revision'],
      },
      {
        levelId: level2Development.id,
        sessionNumber: 10,
        title: 'Project',
        description: 'Build a real app project. Apply all learned concepts in app design and development.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_20_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_19,20_Sheet_SP_2.pdf',
        coreActivity: 'Student project',
        keyConcepts: ['App design'],
      },
    ];

    console.log(`  Creating ${developmentSessions.length} sessions for Development level...`);
    for (const session of developmentSessions) {
      await structureRepo.createSession(session);
    }
    console.log('  ✅ Development level sessions created\n');

    // ============================================================================
    // LEVEL 3: MASTERY (Sessions 21-30)
    // ============================================================================
    console.log('  Creating Level 3: Mastery (Sessions 21-30)...');
    const level3Mastery = await structureRepo.createLevel({
      phaseId: phase1.id,
      levelType: 'mastery',
      title: 'Mastery: Advanced Applications',
      description: 'Build advanced games, quizzes, location-based apps, and complete real-world applications. Sessions 21-30.',
      sequence: 3,
    });

    // Mastery Sessions (21-30)
    const masterySessions: CreateSessionInput[] = [
      {
        levelId: level3Mastery.id,
        sessionNumber: 1,
        title: 'Mole Mash',
        description: 'Reaction game where you tap mole to score points using Sprite and Clock components.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_21_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_21,22_Sheet.pdf',
        coreActivity: 'Tap mole to score',
        keyConcepts: ['Sprite', 'Clock'],
      },
      {
        levelId: level3Mastery.id,
        sessionNumber: 2,
        title: 'Mole Mash',
        description: 'Improve game with score system and event handling for better gameplay.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_22_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_21,22_Sheet.pdf',
        coreActivity: 'Score system',
        keyConcepts: ['Events'],
      },
      {
        levelId: level3Mastery.id,
        sessionNumber: 3,
        title: 'Advanced Mole Mash',
        description: 'Add time limit and miss tracking to create challenging gameplay with Timer and Score logic.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_23_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_23,24_Sheet.pdf',
        coreActivity: 'Add time & misses',
        keyConcepts: ['Timer', 'Score'],
      },
      {
        levelId: level3Mastery.id,
        sessionNumber: 4,
        title: 'Advanced Mole Mash',
        description: 'Complete game with game over system and final score display using Conditions and game logic.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_24_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_23,24_Sheet.pdf',
        coreActivity: 'Game over system',
        keyConcepts: ['Conditions'],
      },
      {
        levelId: level3Mastery.id,
        sessionNumber: 5,
        title: 'Maths Quiz',
        description: 'Learn quiz logic to solve math problems dynamically using Random numbers and IF conditions.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_25_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_25,26_Sheet.pdf',
        coreActivity: 'Solve math problems',
        keyConcepts: ['Random', 'IF'],
      },
      {
        levelId: level3Mastery.id,
        sessionNumber: 6,
        title: 'Maths Quiz',
        description: 'Improve quiz with notifications and feedback system using Notifier component.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_26_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_25,26_Sheet.pdf',
        coreActivity: 'Notifications',
        keyConcepts: ['Notifier'],
      },
      {
        levelId: level3Mastery.id,
        sessionNumber: 7,
        title: 'Location App',
        description: 'Learn GPS functionality to show current location using LocationSensor component.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_27_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_27,28_Sheet.pdf',
        coreActivity: 'Show current location',
        keyConcepts: ['LocationSensor'],
      },
      {
        levelId: level3Mastery.id,
        sessionNumber: 8,
        title: 'Location App',
        description: 'Improve map display by showing location on interactive map using Maps component.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_28_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_27,28_Sheet.pdf',
        coreActivity: 'Display on map',
        keyConcepts: ['Maps'],
      },
      {
        levelId: level3Mastery.id,
        sessionNumber: 9,
        title: 'Theory Exam',
        description: 'Final test with block-based exam covering all concepts learned throughout the course.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_29_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_29,30_Sheet_MP_1.pdf',
        coreActivity: 'Block-based exam',
        keyConcepts: ['Full revision'],
      },
      {
        levelId: level3Mastery.id,
        sessionNumber: 10,
        title: 'Final Project',
        description: 'Build real app of student choice. Integrate all learned concepts to create a complete application.',
        expertVideoS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Videos/KC_App_Dev_Cycle_1_Session_30_Video.mp4',
        learningSheetPdfS3Key: 'Courses/App_Development/App_Dev_Growth_Cycle_1/Learning_Sheet/KC_App_Dev_Cycle_1_Session_29,30_Sheet_MP_1.pdf',
        coreActivity: 'Student choice',
        keyConcepts: ['Integration', 'CREATE App'],
      },
    ];

    console.log(`  Creating ${masterySessions.length} sessions for Mastery level...`);
    for (const session of masterySessions) {
      await structureRepo.createSession(session);
    }
    console.log('  ✅ Mastery level sessions created\n');

    console.log('✅ Growth Cycle 1 completed!\n');

    // ============================================================================
    // SUMMARY
    // ============================================================================
    console.log('🎉 App Development Course Created Successfully!');
    console.log('');
    console.log('📊 Course Summary:');
    console.log(`   Course ID: ${course.id}`);
    console.log(`   Course Title: ${course.title}`);
    console.log(`   Category: ${course.category}`);
    console.log(`   Difficulty: ${course.difficulty || 'Not set'}`);
    console.log(`   Price: ${course.currency} ${course.price}`);
    console.log('');
    console.log('📚 Course Structure:');
    console.log('   1 Phase: Growth Cycle 1');
    console.log('   3 Levels: Foundation (1-10), Development (11-20), Mastery (21-30)');
    console.log('   30 Sessions total');
    console.log('');
    console.log('📝 Note: Growth Cycles 2 and 3 will be added later');
    console.log('');
    console.log('📝 Next Steps:');
    console.log('   1. Upload video and PDF files to S3 and update S3 keys');
    console.log('   2. Create quizzes in MongoDB and update quizId in sessions');
    console.log('   3. Update thumbnail URL with actual image');
    console.log('   4. Test course creation and session access');
    console.log('');

  } catch (error: any) {
    console.error('\n❌ Error creating App Development course:', error);
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
createAppDevelopmentCourse().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
