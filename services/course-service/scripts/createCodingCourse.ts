/**
 * Script to create a Coding Course with full structure
 * 
 * Run this script to create:
 * - Course: Coding Fundamentals
 * - 3 Phases: Introduction, Intermediate Programming, Advanced Development
 * - 3 Levels per Phase: Foundation, Development, Mastery
 * - 10 Sessions per Level (30 sessions per phase, 90 total)
 * 
 * Note: This script uses the NEW refactored structure:
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

async function createCodingCourse() {
  let pool;
  try {
    // Check environment variables
    console.log('🔍 Checking environment variables...');
    console.log('   POSTGRES_URI:', process.env.POSTGRES_URI ? '✓ Set' : '✗ Not set');
    console.log('   POSTGRES_HOST:', process.env.POSTGRES_HOST || 'Not set');
    console.log('');

    if (!process.env.POSTGRES_URI && !process.env.POSTGRES_HOST) {
      console.error('\n❌ Database configuration missing!');
      console.error('\n📝 Please set database credentials in your .env file: kc-backend/.env\n');
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

    console.log('🚀 Starting Coding Course Creation...\n');

    // ============================================================================
    // CREATE COURSE
    // ============================================================================
    console.log('📚 Creating Coding Course...');
    const course = await courseRepo.create({
      title: 'Coding Fundamentals',
      description: `A comprehensive coding course designed for beginners to learn programming from scratch. This course covers fundamental programming concepts, problem-solving skills, and hands-on coding practice.

This course is designed for students who want to:
- Learn programming fundamentals from scratch
- Understand core programming concepts and logic
- Build real-world projects
- Develop problem-solving skills
- Prepare for advanced programming courses
- Build a strong foundation in software development

The course uses a hands-on approach with practical exercises, coding challenges, and project-based learning to ensure you master the fundamentals of programming.`,
      shortDescription: 'Learn programming fundamentals from scratch with hands-on projects and real-world applications',
      category: 'Coding', // Direct category (not STEM)
      // subcategory is optional - omitting for direct category
      difficulty: 'beginner', // Using 'difficulty' instead of 'level'
      price: 2999.00,
      currency: 'INR',
      discountPrice: 1999.00,
      thumbnailUrl: 'https://example.com/coding-course-thumbnail.jpg',
      duration: 1800, // 30 hours total (90 sessions × 20 min average)
      tags: ['coding', 'programming', 'python', 'javascript', 'fundamentals', 'beginner', 'algorithms', 'problem-solving'],
      language: 'en',
    });

    console.log(`✅ Course created: ${course.id} - ${course.title}\n`);

    // ============================================================================
    // PHASE 1: INTRODUCTION TO PROGRAMMING
    // ============================================================================
    console.log('📖 Creating Phase 1: Introduction to Programming...');
    const phase1 = await structureRepo.createPhase({
      courseId: course.id,
      title: 'Introduction to Programming',
      description: 'Learn the basics of programming, including variables, data types, control structures, and fundamental programming concepts.',
      sequence: 1,
    });

    // Phase 1 - Level 1: Foundation
    console.log('  Creating Level 1: Foundation...');
    const phase1Level1 = await structureRepo.createLevel({
      phaseId: phase1.id,
      levelType: 'foundation',
      title: 'Foundation: Programming Basics',
      description: 'Introduction to programming concepts, setting up development environment, and writing your first programs.',
      sequence: 1,
    });

    // Phase 1 - Level 1 Sessions (1-10)
    // Note: Using S3 keys instead of URLs (placeholder keys - update with actual S3 keys)
    // Note: quizId will be set after creating quizzes in MongoDB (separate step)
    const phase1Level1Sessions: CreateSessionInput[] = [
      {
        levelId: phase1Level1.id,
        sessionNumber: 1,
        title: 'What is Programming?',
        description: 'Introduction to programming, what programmers do, and why programming is important in today\'s world.',
        expertVideoS3Key: 'courses/coding/foundation/session-1/expert-video.mp4', // S3 key, not URL
        learningSheetPdfS3Key: 'courses/coding/foundation/session-1/learning-sheet.pdf',
        coreActivity: 'Write a simple "Hello, World!" program and run it',
        keyConcepts: ['Programming definition', 'Programming languages', 'What programmers do', 'Real-world applications'],
        // quizId will be set after creating quiz in MongoDB
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 2,
        title: 'Setting Up Your Development Environment',
        description: 'Learn how to set up a code editor, install necessary tools, and prepare your workspace for coding.',
        expertVideoS3Key: 'courses/coding/foundation/session-2/expert-video.mp4',
        learningSheetPdfS3Key: 'courses/coding/foundation/session-2/learning-sheet.pdf',
        coreActivity: 'Install and configure a code editor, create your first project folder',
        keyConcepts: ['Code editors', 'IDE setup', 'Project structure', 'File organization'],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 3,
        title: 'Variables and Data Types',
        description: 'Understanding variables, different data types, and how to store and manipulate data in programs.',
        expertVideoS3Key: 'courses/coding/foundation/session-3/expert-video.mp4',
        learningSheetPdfS3Key: 'courses/coding/foundation/session-3/learning-sheet.pdf',
        coreActivity: 'Create variables of different types and perform basic operations',
        keyConcepts: ['Variables', 'Data types', 'Integers', 'Strings', 'Booleans'],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 4,
        title: 'Input and Output',
        description: 'Learn how to get input from users and display output in your programs.',
        expertVideoS3Key: 'courses/coding/foundation/session-4/expert-video.mp4',
        learningSheetPdfS3Key: 'courses/coding/foundation/session-4/learning-sheet.pdf',
        coreActivity: 'Create a program that takes user input and displays personalized output',
        keyConcepts: ['Input functions', 'Output functions', 'User interaction', 'Console I/O'],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 5,
        title: 'Operators and Expressions',
        description: 'Working with arithmetic, comparison, and logical operators to perform calculations and make decisions.',
        expertVideoS3Key: 'courses/coding/foundation/session-5/expert-video.mp4',
        learningSheetPdfS3Key: 'courses/coding/foundation/session-5/learning-sheet.pdf',
        coreActivity: 'Write programs using various operators to solve mathematical problems',
        keyConcepts: ['Arithmetic operators', 'Comparison operators', 'Logical operators', 'Operator precedence'],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 6,
        title: 'Conditional Statements',
        description: 'Learn to make decisions in your code using if, else, and else-if statements.',
        expertVideoS3Key: 'courses/coding/foundation/session-6/expert-video.mp4',
        learningSheetPdfS3Key: 'courses/coding/foundation/session-6/learning-sheet.pdf',
        coreActivity: 'Build decision-making programs using conditionals',
        keyConcepts: ['If statements', 'Else statements', 'Conditional logic', 'Decision making'],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 7,
        title: 'Loops - Part 1: For Loops',
        description: 'Introduction to loops, understanding for loops, and using them to repeat code.',
        expertVideoS3Key: 'courses/coding/foundation/session-7/expert-video.mp4',
        learningSheetPdfS3Key: 'courses/coding/foundation/session-7/learning-sheet.pdf',
        coreActivity: 'Use for loops to solve repetitive problems',
        keyConcepts: ['For loops', 'Loop iteration', 'Range', 'Iteration'],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 8,
        title: 'Loops - Part 2: While Loops',
        description: 'Understanding while loops and when to use them instead of for loops.',
        expertVideoS3Key: 'courses/coding/foundation/session-8/expert-video.mp4',
        learningSheetPdfS3Key: 'courses/coding/foundation/session-8/learning-sheet.pdf',
        coreActivity: 'Implement while loops for conditional repetition',
        keyConcepts: ['While loops', 'Loop conditions', 'Infinite loops', 'Loop control'],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 9,
        title: 'Functions - Part 1: Basics',
        description: 'Introduction to functions, why they are useful, and how to create and call functions.',
        expertVideoS3Key: 'courses/coding/foundation/session-9/expert-video.mp4',
        learningSheetPdfS3Key: 'courses/coding/foundation/session-9/learning-sheet.pdf',
        coreActivity: 'Create and use functions to organize your code',
        keyConcepts: ['Functions', 'Function definition', 'Function calls', 'Code reusability'],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 10,
        title: 'Functions - Part 2: Parameters and Returns',
        description: 'Advanced function concepts: passing parameters, returning values, and function scope.',
        expertVideoS3Key: 'courses/coding/foundation/session-10/expert-video.mp4',
        learningSheetPdfS3Key: 'courses/coding/foundation/session-10/learning-sheet.pdf',
        coreActivity: 'Create functions with parameters and return values',
        keyConcepts: ['Parameters', 'Return values', 'Function scope', 'Arguments'],
      },
    ];

    console.log(`  Creating ${phase1Level1Sessions.length} sessions for Foundation level...`);
    for (const session of phase1Level1Sessions) {
      await structureRepo.createSession(session);
    }
    console.log('  ✅ Foundation level sessions created\n');

    // Phase 1 - Level 2: Development
    console.log('  Creating Level 2: Development...');
    const phase1Level2 = await structureRepo.createLevel({
      phaseId: phase1.id,
      levelType: 'development',
      title: 'Development: Building Programs',
      description: 'Apply foundational concepts to build more complex programs with multiple functions and logic.',
      sequence: 2,
    });

    const phase1Level2Sessions: CreateSessionInput[] = Array.from({ length: 10 }, (_, i) => ({
      levelId: phase1Level2.id,
      sessionNumber: i + 1,
      title: `Session ${i + 1}: Intermediate Concepts`,
      description: `Building on foundation concepts to create more complex programs.`,
      expertVideoS3Key: `courses/coding/development/session-${i + 1}/expert-video.mp4`,
      learningSheetPdfS3Key: `courses/coding/development/session-${i + 1}/learning-sheet.pdf`,
      coreActivity: `Complete intermediate programming exercises for session ${i + 1}`,
      keyConcepts: ['Intermediate programming', 'Code organization', 'Problem solving'],
    }));

    console.log(`  Creating ${phase1Level2Sessions.length} sessions for Development level...`);
    for (const session of phase1Level2Sessions) {
      await structureRepo.createSession(session);
    }
    console.log('  ✅ Development level sessions created\n');

    // Phase 1 - Level 3: Mastery
    console.log('  Creating Level 3: Mastery...');
    const phase1Level3 = await structureRepo.createLevel({
      phaseId: phase1.id,
      levelType: 'mastery',
      title: 'Mastery: Advanced Programming',
      description: 'Master advanced programming concepts and build sophisticated programs.',
      sequence: 3,
    });

    const phase1Level3Sessions: CreateSessionInput[] = Array.from({ length: 10 }, (_, i) => ({
      levelId: phase1Level3.id,
      sessionNumber: i + 1,
      title: `Session ${i + 1}: Advanced Concepts`,
      description: `Master advanced programming techniques and build complex applications.`,
      expertVideoS3Key: `courses/coding/mastery/session-${i + 1}/expert-video.mp4`,
      learningSheetPdfS3Key: `courses/coding/mastery/session-${i + 1}/learning-sheet.pdf`,
      coreActivity: `Complete advanced programming projects for session ${i + 1}`,
      keyConcepts: ['Advanced programming', 'Complex algorithms', 'Software design'],
    }));

    console.log(`  Creating ${phase1Level3Sessions.length} sessions for Mastery level...`);
    for (const session of phase1Level3Sessions) {
      await structureRepo.createSession(session);
    }
    console.log('  ✅ Mastery level sessions created\n');

    console.log('✅ Phase 1 completed!\n');

    // ============================================================================
    // PHASE 2: INTERMEDIATE PROGRAMMING
    // ============================================================================
    console.log('📖 Creating Phase 2: Intermediate Programming...');
    const phase2 = await structureRepo.createPhase({
      courseId: course.id,
      title: 'Intermediate Programming',
      description: 'Learn intermediate programming concepts including data structures, algorithms, and object-oriented programming basics.',
      sequence: 2,
    });

    // Create all 3 levels with 10 sessions each for Phase 2
    for (let levelSeq = 1; levelSeq <= 3; levelSeq++) {
      const levelType = levelSeq === 1 ? 'foundation' : levelSeq === 2 ? 'development' : 'mastery';
      const levelTitle = levelSeq === 1 
        ? 'Foundation: Data Structures Basics' 
        : levelSeq === 2 
        ? 'Development: Intermediate Data Structures'
        : 'Mastery: Advanced Data Structures';

      console.log(`  Creating Level ${levelSeq}: ${levelTitle}...`);
      const level = await structureRepo.createLevel({
        phaseId: phase2.id,
        levelType,
        title: levelTitle,
        description: `Learn ${levelType} concepts in intermediate programming.`,
        sequence: levelSeq,
      });

      const sessions: CreateSessionInput[] = Array.from({ length: 10 }, (_, i) => ({
        levelId: level.id,
        sessionNumber: i + 1,
        title: `Session ${i + 1}: ${levelTitle}`,
        description: `Intermediate programming concepts for ${levelType} level.`,
        expertVideoS3Key: `courses/coding/phase2/${levelType}/session-${i + 1}/expert-video.mp4`,
        learningSheetPdfS3Key: `courses/coding/phase2/${levelType}/session-${i + 1}/learning-sheet.pdf`,
        coreActivity: `Complete ${levelType} level exercises for session ${i + 1}`,
        keyConcepts: ['Data structures', 'Algorithms', 'Problem solving'],
      }));

      for (const session of sessions) {
        await structureRepo.createSession(session);
      }
      console.log(`  ✅ Level ${levelSeq} sessions created\n`);
    }

    console.log('✅ Phase 2 completed!\n');

    // ============================================================================
    // PHASE 3: ADVANCED DEVELOPMENT
    // ============================================================================
    console.log('📖 Creating Phase 3: Advanced Development...');
    const phase3 = await structureRepo.createPhase({
      courseId: course.id,
      title: 'Advanced Development',
      description: 'Master advanced programming concepts including advanced algorithms, software architecture, and building real-world applications.',
      sequence: 3,
    });

    // Create all 3 levels with 10 sessions each for Phase 3
    for (let levelSeq = 1; levelSeq <= 3; levelSeq++) {
      const levelType = levelSeq === 1 ? 'foundation' : levelSeq === 2 ? 'development' : 'mastery';
      const levelTitle = levelSeq === 1 
        ? 'Foundation: Advanced Algorithms' 
        : levelSeq === 2 
        ? 'Development: Software Architecture'
        : 'Mastery: Building Real-World Applications';

      console.log(`  Creating Level ${levelSeq}: ${levelTitle}...`);
      const level = await structureRepo.createLevel({
        phaseId: phase3.id,
        levelType,
        title: levelTitle,
        description: `Learn ${levelType} concepts in advanced development.`,
        sequence: levelSeq,
      });

      const sessions: CreateSessionInput[] = Array.from({ length: 10 }, (_, i) => ({
        levelId: level.id,
        sessionNumber: i + 1,
        title: `Session ${i + 1}: ${levelTitle}`,
        description: `Advanced development concepts for ${levelType} level.`,
        expertVideoS3Key: `courses/coding/phase3/${levelType}/session-${i + 1}/expert-video.mp4`,
        learningSheetPdfS3Key: `courses/coding/phase3/${levelType}/session-${i + 1}/learning-sheet.pdf`,
        coreActivity: `Complete ${levelType} level projects for session ${i + 1}`,
        keyConcepts: ['Advanced algorithms', 'Software design', 'Real-world applications'],
      }));

      for (const session of sessions) {
        await structureRepo.createSession(session);
      }
      console.log(`  ✅ Level ${levelSeq} sessions created\n`);
    }

    console.log('✅ Phase 3 completed!\n');

    // ============================================================================
    // SUMMARY
    // ============================================================================
    console.log('🎉 Coding Course Created Successfully!');
    console.log('');
    console.log('📊 Course Summary:');
    console.log(`   Course ID: ${course.id}`);
    console.log(`   Course Title: ${course.title}`);
    console.log(`   Category: ${course.category}`);
    console.log(`   Difficulty: ${course.difficulty || 'Not set'}`);
    console.log(`   Price: ${course.currency} ${course.price}`);
    console.log('');
    console.log('📚 Course Structure:');
    console.log('   3 Phases');
    console.log('   9 Levels (3 per phase)');
    console.log('   90 Sessions (10 per level)');
    console.log('');
    console.log('📝 Next Steps:');
    console.log('   1. Upload video and PDF files to S3 and update S3 keys');
    console.log('   2. Create quizzes in MongoDB and update quizId in sessions');
    console.log('   3. Update thumbnail URL with actual image');
    console.log('   4. Test course creation and session access');
    console.log('');

  } catch (error: any) {
    console.error('\n❌ Error creating coding course:', error);
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
createCodingCourse().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

