/**
 * Script to create a Robotics Course with full structure
 * 
 * Run this script to create:
 * - Course: Robotics Fundamentals
 * - 3 Phases: Introduction, Advanced Concepts, Mastery
 * - 3 Levels per Phase: Foundation, Development, Mastery
 * - 10 Sessions per Level (30 sessions per phase, 90 total)
 */

// Load environment variables using the shared config (same as services)
// This automatically finds and loads .env file from parent directories
import "@kodingcaravan/shared/config";

import { initPostgres, getPostgresPool } from '../src/config/database';
import { createCourseStructureTables } from '../src/models/courseStructure.model';
import { createCoursesTable } from '../src/models/course.model';
import { CourseRepository } from '../src/models/course.model';
import { CourseStructureRepository } from '../src/models/courseStructure.model';
import type { CreateSessionInput } from '../src/models/courseStructure.model';

async function createRoboticsCourse() {
  let pool;
  try {
    // Debug: Show what environment variables are loaded
    console.log('🔍 Checking environment variables...');
    console.log('   POSTGRES_URI:', process.env.POSTGRES_URI ? '✓ Set' : '✗ Not set');
    console.log('   POSTGRES_HOST:', process.env.POSTGRES_HOST || 'Not set');
    console.log('   POSTGRES_USER:', process.env.POSTGRES_USER || 'Not set');
    console.log('   POSTGRES_DB:', process.env.POSTGRES_DB || 'Not set');
    console.log('   POSTGRES_PASSWORD:', process.env.POSTGRES_PASSWORD ? '✓ Set' : '✗ Not set');
    console.log('');

    // Check environment variables
    if (!process.env.POSTGRES_URI && !process.env.POSTGRES_HOST) {
      console.error('\n❌ Database configuration missing!');
      console.error('\n📝 Please set database credentials in your .env file:');
      console.error('   Location: kc-backend/.env');
      console.error('\n   Add one of these:');
      console.error('   POSTGRES_URI=postgresql://postgres:PASSWORD@localhost:5432/DATABASE');
      console.error('   OR');
      console.error('   POSTGRES_HOST=localhost');
      console.error('   POSTGRES_PORT=5432');
      console.error('   POSTGRES_USER=postgres');
      console.error('   POSTGRES_PASSWORD=your_password');
      console.error('   POSTGRES_DB=your_database');
      console.error('\n💡 See scripts/SETUP_GUIDE.md for detailed instructions\n');
      process.exit(1);
    }

    // Initialize PostgreSQL connection only (we don't need MongoDB for this script)
    console.log('🔌 Connecting to PostgreSQL...');
    console.log(`   Host: ${process.env.POSTGRES_HOST || 'from URI'}`);
    console.log(`   Database: ${process.env.POSTGRES_DB || 'from URI'}`);
    console.log(`   User: ${process.env.POSTGRES_USER || 'from URI'}`);
    console.log('');
    
    try {
      await initPostgres();
      pool = getPostgresPool();
      console.log('✅ Database connected successfully!\n');
    } catch (error: any) {
      console.error('\n❌ Database connection failed!');
      console.error('Error:', error.message);
      console.error('\n💡 Please check:');
      console.error('   1. PostgreSQL is running');
      console.error('   2. Database credentials in kc-backend/.env are correct');
      console.error('   3. Database exists');
      console.error('\nSee scripts/SETUP_GUIDE.md for help\n');
      throw error;
    }
    
    // Ensure tables exist
    await createCoursesTable(pool);
    await createCourseStructureTables(pool);
    
    const courseRepo = new CourseRepository(pool);
    const structureRepo = new CourseStructureRepository(pool);

    console.log('🚀 Starting Robotics Course Creation...\n');

    // ============================================================================
    // CREATE COURSE
    // ============================================================================
    console.log('📚 Creating Robotics Course...');
    const course = await courseRepo.create({
      title: 'Robotics Fundamentals',
      description: `A comprehensive course covering the fundamentals of robotics, from basic concepts to advanced applications. Learn to build, program, and control robots through hands-on projects and real-world applications.

This course is designed for students who want to:
- Understand the principles of robotics and automation
- Learn programming for robots
- Build and control physical robots
- Apply robotics concepts to solve real-world problems
- Develop projects from simple to complex robotic systems`,
      shortDescription: 'Master robotics from basics to advanced applications with hands-on projects',
      category: 'STEM',
      subcategory: 'Robotics',
      level: 'beginner',
      price: 2999.00,
      currency: 'INR',
      discountPrice: 1999.00,
      thumbnailUrl: 'https://example.com/robotics-course-thumbnail.jpg',
      duration: 1800, // 30 hours total (90 sessions × 20 min average)
      tags: ['robotics', 'programming', 'electronics', 'arduino', 'sensors', 'automation'],
      language: 'en',
    });

    console.log(`✅ Course created: ${course.id} - ${course.title}\n`);

    // ============================================================================
    // PHASE 1: INTRODUCTION TO ROBOTICS
    // ============================================================================
    console.log('📖 Creating Phase 1: Introduction to Robotics...');
    const phase1 = await structureRepo.createPhase({
      courseId: course.id,
      title: 'Introduction to Robotics',
      description: 'Learn the basics of robotics, including components, sensors, and basic programming concepts.',
      sequence: 1,
    });

    // Phase 1 - Level 1: Foundation
    console.log('  Creating Level 1: Foundation...');
    const phase1Level1 = await structureRepo.createLevel({
      phaseId: phase1.id,
      levelType: 'foundation',
      title: 'Foundation: Robotics Basics',
      description: 'Introduction to robotics components, basic concepts, and getting started with robot building.',
      sequence: 1,
    });

    // Phase 1 - Level 1 Sessions (1-10)
    const phase1Level1Sessions: CreateSessionInput[] = [
      {
        levelId: phase1Level1.id,
        sessionNumber: 1,
        title: 'What is Robotics?',
        description: 'Introduction to robotics, history, and applications in daily life.',
        expertVideoUrl: 'https://example.com/videos/robotics-101-intro.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/robotics-intro.pdf',
        coreActivity: 'Research and present 3 real-world robotics applications',
        keyConcepts: ['Robotics definition', 'History of robotics', 'Modern applications'],
        mcqQuestions: [
          {
            id: 'q1',
            question: 'What is the primary purpose of robotics?',
            options: [
              'To replace humans completely',
              'To assist and automate tasks',
              'To create entertainment only',
              'To eliminate jobs'
            ],
            correctAnswerIndex: 1,
            explanation: 'Robotics aims to assist and automate tasks, making work easier and more efficient.',
            points: 10,
          },
          {
            id: 'q2',
            question: 'Which field does NOT commonly use robotics?',
            options: ['Manufacturing', 'Healthcare', 'Agriculture', 'None of the above'],
            correctAnswerIndex: 3,
            explanation: 'Robotics is used in all these fields and many more.',
            points: 10,
          },
        ],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 2,
        title: 'Robot Components and Parts',
        description: 'Understanding the essential components of a robot: motors, sensors, controllers, and power systems.',
        expertVideoUrl: 'https://example.com/videos/robot-components.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/robot-components.pdf',
        coreActivity: 'Identify and label components in a robot kit',
        keyConcepts: ['Motors', 'Sensors', 'Microcontrollers', 'Power systems'],
        mcqQuestions: [
          {
            id: 'q1',
            question: 'What is the brain of a robot?',
            options: ['Motor', 'Sensor', 'Microcontroller', 'Battery'],
            correctAnswerIndex: 2,
            explanation: 'The microcontroller processes information and controls the robot.',
            points: 10,
          },
        ],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 3,
        title: 'Introduction to Arduino',
        description: 'Getting started with Arduino microcontroller, IDE setup, and basic programming.',
        expertVideoUrl: 'https://example.com/videos/arduino-intro.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/arduino-basics.pdf',
        coreActivity: 'Set up Arduino IDE and upload your first program',
        keyConcepts: ['Arduino board', 'IDE setup', 'Basic syntax', 'Uploading code'],
        mcqQuestions: [
          {
            id: 'q1',
            question: 'What is Arduino?',
            options: [
              'A programming language',
              'An open-source electronics platform',
              'A robot',
              'A sensor'
            ],
            correctAnswerIndex: 1,
            explanation: 'Arduino is an open-source electronics platform based on easy-to-use hardware and software.',
            points: 10,
          },
        ],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 4,
        title: 'Basic Programming Concepts',
        description: 'Learning variables, loops, conditionals, and functions in Arduino programming.',
        expertVideoUrl: 'https://example.com/videos/arduino-programming.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/programming-basics.pdf',
        coreActivity: 'Write programs using variables, loops, and conditionals',
        keyConcepts: ['Variables', 'Loops', 'Conditionals', 'Functions'],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 5,
        title: 'Understanding Sensors',
        description: 'Introduction to different types of sensors: ultrasonic, infrared, temperature, and light sensors.',
        expertVideoUrl: 'https://example.com/videos/sensors-intro.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/sensors-basics.pdf',
        coreActivity: 'Connect and test different sensors with Arduino',
        keyConcepts: ['Sensor types', 'Analog vs Digital', 'Sensor calibration'],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 6,
        title: 'Motors and Actuators',
        description: 'Learning about DC motors, servo motors, stepper motors, and how to control them.',
        expertVideoUrl: 'https://example.com/videos/motors-actuators.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/motors.pdf',
        coreActivity: 'Control different types of motors with Arduino',
        keyConcepts: ['DC motors', 'Servo motors', 'Stepper motors', 'Motor control'],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 7,
        title: 'Building Your First Robot',
        description: 'Step-by-step guide to building a simple line-following robot.',
        expertVideoUrl: 'https://example.com/videos/first-robot.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/build-robot.pdf',
        coreActivity: 'Build and test a line-following robot',
        keyConcepts: ['Robot assembly', 'Wiring', 'Testing', 'Troubleshooting'],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 8,
        title: 'Robot Movement and Control',
        description: 'Programming robot movement: forward, backward, turning, and speed control.',
        expertVideoUrl: 'https://example.com/videos/robot-movement.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/movement-control.pdf',
        coreActivity: 'Program robot to navigate a simple course',
        keyConcepts: ['Movement algorithms', 'Speed control', 'Turning mechanisms'],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 9,
        title: 'Obstacle Detection',
        description: 'Using ultrasonic sensors to detect and avoid obstacles.',
        expertVideoUrl: 'https://example.com/videos/obstacle-detection.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/obstacle-avoidance.pdf',
        coreActivity: 'Build an obstacle-avoiding robot',
        keyConcepts: ['Ultrasonic sensors', 'Distance calculation', 'Avoidance algorithms'],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 10,
        title: 'Foundation Project: Simple Robot',
        description: 'Complete project: Build a robot that can move and avoid obstacles.',
        expertVideoUrl: 'https://example.com/videos/foundation-project.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/foundation-project.pdf',
        coreActivity: 'Complete foundation level project',
        keyConcepts: ['Project planning', 'Integration', 'Testing', 'Documentation'],
      },
    ];

    for (const session of phase1Level1Sessions) {
      try {
        await structureRepo.createSession(session);
      } catch (error: any) {
        console.error(`❌ Error creating session ${session.sessionNumber}:`, error.message);
        throw error;
      }
    }
    console.log(`  ✅ Created 10 sessions for Foundation level\n`);

    // Phase 1 - Level 2: Development
    console.log('  Creating Level 2: Development...');
    const phase1Level2 = await structureRepo.createLevel({
      phaseId: phase1.id,
      levelType: 'development',
      title: 'Development: Intermediate Robotics',
      description: 'Advanced programming, sensor integration, and building more complex robots.',
      sequence: 2,
    });

    // Create 10 sessions for Development level (simplified for brevity)
    for (let i = 1; i <= 10; i++) {
      await structureRepo.createSession({
        levelId: phase1Level2.id,
        sessionNumber: i,
        title: `Development Session ${i}`,
        description: `Advanced robotics concepts and applications - Session ${i}`,
        expertVideoUrl: `https://example.com/videos/dev-session-${i}.mp4`,
        learningSheetPdfUrl: `https://example.com/sheets/dev-session-${i}.pdf`,
        coreActivity: `Complete development activity ${i}`,
        keyConcepts: [`Concept ${i}-1`, `Concept ${i}-2`, `Concept ${i}-3`],
      });
    }
    console.log(`  ✅ Created 10 sessions for Development level\n`);

    // Phase 1 - Level 3: Mastery
    console.log('  Creating Level 3: Mastery...');
    const phase1Level3 = await structureRepo.createLevel({
      phaseId: phase1.id,
      levelType: 'mastery',
      title: 'Mastery: Advanced Robotics',
      description: 'Master advanced robotics concepts, AI integration, and complex robot systems.',
      sequence: 3,
    });

    for (let i = 1; i <= 10; i++) {
      try {
        await structureRepo.createSession({
          levelId: phase1Level3.id,
          sessionNumber: i,
          title: `Mastery Session ${i}`,
          description: `Master-level robotics concepts and applications - Session ${i}`,
          expertVideoUrl: `https://example.com/videos/mastery-session-${i}.mp4`,
          learningSheetPdfUrl: `https://example.com/sheets/mastery-session-${i}.pdf`,
          coreActivity: `Complete mastery activity ${i}`,
          keyConcepts: [`Advanced Concept ${i}-1`, `Advanced Concept ${i}-2`],
        });
      } catch (error: any) {
        console.error(`❌ Error creating Mastery session ${i}:`, error.message);
        throw error;
      }
    }
    console.log(`  ✅ Created 10 sessions for Mastery level\n`);

    // ============================================================================
    // PHASE 2: ADVANCED CONCEPTS
    // ============================================================================
    console.log('📖 Creating Phase 2: Advanced Concepts...');
    const phase2 = await structureRepo.createPhase({
      courseId: course.id,
      title: 'Advanced Robotics Concepts',
      description: 'Deep dive into advanced robotics: AI, computer vision, navigation, and autonomous systems.',
      sequence: 2,
    });

    // Create 3 levels for Phase 2 (Foundation, Development, Mastery)
    for (let levelSeq = 1; levelSeq <= 3; levelSeq++) {
      const levelType = levelSeq === 1 ? 'foundation' : levelSeq === 2 ? 'development' : 'mastery';
      const levelTitle = levelSeq === 1 ? 'Foundation' : levelSeq === 2 ? 'Development' : 'Mastery';
      
      const level = await structureRepo.createLevel({
        phaseId: phase2.id,
        levelType: levelType as 'foundation' | 'development' | 'mastery',
        title: `${levelTitle}: Advanced Concepts`,
        description: `${levelTitle} level of advanced robotics concepts`,
        sequence: levelSeq,
      });

      for (let i = 1; i <= 10; i++) {
        await structureRepo.createSession({
          levelId: level.id,
          sessionNumber: i,
          title: `Phase 2 ${levelTitle} Session ${i}`,
          description: `Advanced robotics concepts - ${levelTitle} level - Session ${i}`,
          expertVideoUrl: `https://example.com/videos/phase2-${levelType}-${i}.mp4`,
          learningSheetPdfUrl: `https://example.com/sheets/phase2-${levelType}-${i}.pdf`,
          coreActivity: `Complete ${levelTitle} activity ${i}`,
          keyConcepts: [`Advanced ${levelTitle} Concept ${i}`],
        });
      }
      console.log(`  ✅ Created 10 sessions for ${levelTitle} level`);
    }
    console.log(`✅ Phase 2 created with 30 sessions\n`);

    // ============================================================================
    // PHASE 3: MASTERY AND APPLICATIONS
    // ============================================================================
    console.log('📖 Creating Phase 3: Mastery and Applications...');
    const phase3 = await structureRepo.createPhase({
      courseId: course.id,
      title: 'Mastery and Real-World Applications',
      description: 'Master robotics through real-world projects, competitions, and advanced applications.',
      sequence: 3,
    });

    // Create 3 levels for Phase 3
    for (let levelSeq = 1; levelSeq <= 3; levelSeq++) {
      const levelType = levelSeq === 1 ? 'foundation' : levelSeq === 2 ? 'development' : 'mastery';
      const levelTitle = levelSeq === 1 ? 'Foundation' : levelSeq === 2 ? 'Development' : 'Mastery';
      
      const level = await structureRepo.createLevel({
        phaseId: phase3.id,
        levelType: levelType as 'foundation' | 'development' | 'mastery',
        title: `${levelTitle}: Real-World Applications`,
        description: `${levelTitle} level focusing on real-world robotics applications`,
        sequence: levelSeq,
      });

      for (let i = 1; i <= 10; i++) {
        try {
          await structureRepo.createSession({
            levelId: level.id,
            sessionNumber: i,
            title: `Phase 3 ${levelTitle} Session ${i}`,
            description: `Real-world applications - ${levelTitle} level - Session ${i}`,
            expertVideoUrl: `https://example.com/videos/phase3-${levelType}-${i}.mp4`,
            learningSheetPdfUrl: `https://example.com/sheets/phase3-${levelType}-${i}.pdf`,
            coreActivity: `Complete ${levelTitle} real-world project ${i}`,
            keyConcepts: [`Real-world ${levelTitle} Application ${i}`],
          });
        } catch (error: any) {
          console.error(`❌ Error creating Phase 3 ${levelTitle} session ${i}:`, error.message);
          throw error;
        }
      }
      console.log(`  ✅ Created 10 sessions for ${levelTitle} level`);
    }
    console.log(`✅ Phase 3 created with 30 sessions\n`);

    console.log('🎉 Robotics Course Created Successfully!');
    console.log(`\n📊 Summary:`);
    console.log(`   Course ID: ${course.id}`);
    console.log(`   Course: ${course.title}`);
    console.log(`   Phases: 3`);
    console.log(`   Levels: 9 (3 per phase)`);
    console.log(`   Sessions: 90 (10 per level)`);
    console.log(`\n✅ Course is ready for students to enroll!`);

  } catch (error: any) {
    console.error('\n❌ Error creating robotics course!');
    console.error('═══════════════════════════════════════════════════════');
    if (error instanceof Error) {
      console.error('Error Type:', error.constructor.name);
      console.error('Error Message:', error.message);
      if (error.stack) {
        console.error('\nStack Trace:');
        console.error(error.stack);
      }
    } else {
      console.error('Error:', JSON.stringify(error, null, 2));
    }
    console.error('═══════════════════════════════════════════════════════\n');
    throw error;
  } finally {
    if (pool) {
      try {
        await pool.end();
      } catch (e) {
        // Ignore pool close errors
      }
    }
  }
}

// Run the script
if (require.main === module) {
  // Ensure output is flushed
  process.stdout.write('🚀 Starting Robotics Course Creation Script...\n\n');
  
  createRoboticsCourse()
    .then(() => {
      console.log('\n✅ Script completed successfully');
      process.stdout.write('\n');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Script failed!');
      console.error('═══════════════════════════════════════════════════════');
      if (error instanceof Error) {
        console.error('Error Type:', error.constructor.name);
        console.error('Error Message:', error.message);
        if (error.stack) {
          console.error('\nStack Trace:');
          console.error(error.stack);
        }
      } else {
        console.error('Error:', error);
      }
      console.error('═══════════════════════════════════════════════════════\n');
      process.exit(1);
    });
}

export { createRoboticsCourse };

