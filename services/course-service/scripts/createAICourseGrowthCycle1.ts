/**
 * Script to create an AI Course with full structure
 * 
 * Run this script to create:
 * - Course: AI
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

async function createAICourseGrowthCycle1() {
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

    console.log('🚀 Starting AI Course Creation...\n');

    // ============================================================================
    // CREATE COURSE
    // ============================================================================
    console.log('📚 Creating AI Course...');
    const course = await courseRepo.create({
      title: 'AI',
      description: `A comprehensive course on Artificial Intelligence covering fundamentals, computer vision, machine learning, and real-world applications. This course uses PictoBlox to teach AI concepts through hands-on projects and activities.

This course is designed for students who want to:
- Understand artificial intelligence and its applications
- Learn computer vision and image recognition
- Master machine learning concepts
- Build AI-powered projects using PictoBlox
- Create face detection, speech recognition, and pose classification systems
- Develop ethical understanding of AI

The course uses a hands-on, project-based approach with 30 sessions covering AI fundamentals, computer vision, face detection, OCR, speech recognition, machine learning, and capstone projects.`,
      shortDescription: 'Learn Artificial Intelligence from basics to advanced machine learning with PictoBlox - hands-on projects and real-world applications',
      category: 'STEM',
      subcategory: 'Artificial Intelligence',
      difficulty: 'beginner',
      price: 8999.00,
      currency: 'INR',
      thumbnailUrl: 'https://example.com/ai-course-thumbnail.jpg',
      duration: 600, // 30 sessions × 20 min average = 10 hours
      tags: ['artificial-intelligence', 'machine-learning', 'computer-vision', 'pictoblox', 'ai-fundamentals', 'beginner', 'face-detection', 'ocr', 'speech-recognition'],
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
      description: 'First growth cycle covering Foundation (Sessions 1-10), Development (Sessions 11-20), and Mastery (Sessions 21-30) levels. Learn AI from basics to advanced machine learning and capstone projects.',
      sequence: 1,
    });

    // ============================================================================
    // LEVEL 1: FOUNDATION (Sessions 1-10)
    // ============================================================================
    console.log('  Creating Level 1: Foundation (Sessions 1-10)...');
    const level1Foundation = await structureRepo.createLevel({
      phaseId: phase1.id,
      levelType: 'foundation',
      title: 'Foundation: AI Basics',
      description: 'Introduction to AI, PictoBlox interface, computer vision basics, and building first AI projects. Sessions 1-10.',
      sequence: 1,
    });

    // Foundation Sessions (1-10)
    const foundationSessions: CreateSessionInput[] = [
      {
        levelId: level1Foundation.id,
        sessionNumber: 1,
        title: 'MEET TO AI WORLD',
        description: 'Introduction to intelligence and artificial intelligence. Discuss real-life examples of intelligent machines.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_1_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_1_Sheet.pdf',
        coreActivity: 'Intelligence, AI, Learning, Decision Making',
        keyConcepts: ['Intelligence', 'AI', 'Learning', 'Decision Making'],
      },
      {
        levelId: level1Foundation.id,
        sessionNumber: 2,
        title: 'HISTORY & APPLICATIONS OF AI',
        description: 'Understand evolution and applications of AI. Identify AI used in daily life.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_2_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_2_Sheet.pdf',
        coreActivity: 'Identify AI used in daily life',
        keyConcepts: ['History of AI', 'AI Applications'],
      },
      {
        levelId: level1Foundation.id,
        sessionNumber: 3,
        title: 'INTRODUCTION TO PICTOBLOX & INTERFACE',
        description: 'Learn PictoBlox software and interface. Install PictoBlox and explore interface.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_3_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_3_Sheet.pdf',
        coreActivity: 'Install PictoBlox and explore interface',
        keyConcepts: ['PictoBlox', 'Stage', 'Sprite', 'Blocks'],
      },
      {
        levelId: level1Foundation.id,
        sessionNumber: 4,
        title: 'ACTIVITY – ANIMATION IN PICTOBLOX',
        description: 'Create animations using block coding. Animate a sprite using motion blocks.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_4_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_4_Sheet.pdf',
        coreActivity: 'Animate a sprite using motion blocks',
        keyConcepts: ['Animation', 'Events', 'Loops'],
      },
      {
        levelId: level1Foundation.id,
        sessionNumber: 5,
        title: 'INTRODUCTION TO COMPUTER VISION',
        description: 'Understand how computers interpret images. Observe object recognition examples.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_5_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_5_Sheet.pdf',
        coreActivity: 'Observe object recognition examples',
        keyConcepts: ['Computer Vision', 'Image Processing'],
      },
      {
        levelId: level1Foundation.id,
        sessionNumber: 6,
        title: 'AI EXTENSION IN PICTOBLOX',
        description: 'Explore AI tools in PictoBlox. Enable AI extension and test blocks.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_6_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_6_Sheet.pdf',
        coreActivity: 'Enable AI extension and test blocks',
        keyConcepts: ['AI Extension', 'Vision', 'Detection'],
      },
      {
        levelId: level1Foundation.id,
        sessionNumber: 7,
        title: 'ACTIVITY: COMPUTER VISION',
        description: 'Apply computer vision concepts. Recognize landmarks or objects.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_7_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_7_Sheet.pdf',
        coreActivity: 'Recognize landmarks or objects',
        keyConcepts: ['Image Recognition', 'Landmarks'],
      },
      {
        levelId: level1Foundation.id,
        sessionNumber: 8,
        title: 'ACTIVITY: IDENTIFYING & LOCATING OBJECT',
        description: 'Learn object position detection. Draw bounding boxes around objects.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_8_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_8_Sheet.pdf',
        coreActivity: 'Draw bounding boxes around objects',
        keyConcepts: ['Object Detection', 'Coordinates'],
      },
      {
        levelId: level1Foundation.id,
        sessionNumber: 9,
        title: 'ACTIVITY – Make Logo Quiz Using the Artificial Intelligence Extension in PictoBlox',
        description: 'Build an AI-based quiz. Create a logo quiz game.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_9_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_9_Sheet.pdf',
        coreActivity: 'Create a logo quiz game',
        keyConcepts: ['Brand Recognition', 'Conditions'],
      },
      {
        levelId: level1Foundation.id,
        sessionNumber: 10,
        title: 'MINIPROJECT – Celebrity, Brand, Landmarks Recognition Using Artificial Intelligence',
        description: 'Apply AI concepts in a project. Develop recognition mini project.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_10_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_10_SP_Sheet.pdf',
        coreActivity: 'Develop recognition mini project',
        keyConcepts: ['Computer Vision', 'AI Integration'],
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
      title: 'Development: Advanced AI Concepts',
      description: 'Learn face detection, OCR, speech recognition, and machine learning basics. Sessions 11-20.',
      sequence: 2,
    });

    // Development Sessions (11-20)
    const developmentSessions: CreateSessionInput[] = [
      {
        levelId: level2Development.id,
        sessionNumber: 1,
        title: 'INTRODUCTION TO FACE DETECTION',
        description: 'Learn how AI detects human faces in images and videos. Detect faces using camera or images.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_11_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_11_Sheet.pdf',
        coreActivity: 'Detect faces using camera or images',
        keyConcepts: ['Face Detection', 'Facial Features'],
      },
      {
        levelId: level2Development.id,
        sessionNumber: 2,
        title: 'MAKING AN EXPRESSION DETECTOR',
        description: 'Understand how AI identifies facial expressions. Detect emotions like happy or sad.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_12_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_12_Sheet.pdf',
        coreActivity: 'Detect emotions like happy or sad',
        keyConcepts: ['Emotion Detection', 'Expressions'],
      },
      {
        levelId: level2Development.id,
        sessionNumber: 3,
        title: 'HOW FACIAL RECOGNITION WORKS',
        description: 'Learn the working of facial recognition systems. Identify a person using face data.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_13_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_13_Sheet.pdf',
        coreActivity: 'Identify a person using face data',
        keyConcepts: ['Facial Recognition', 'Biometrics'],
      },
      {
        levelId: level2Development.id,
        sessionNumber: 4,
        title: 'RECOGNIZING TEXT FROM IMAGE',
        description: 'Understand how AI reads text from images. Extract text from printed images.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_14_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_14_Sheet.pdf',
        coreActivity: 'Extract text from printed images',
        keyConcepts: ['OCR', 'Text Recognition'],
      },
      {
        levelId: level2Development.id,
        sessionNumber: 5,
        title: 'ACTIVITY: POSTMAN',
        description: 'Apply OCR to real-life delivery scenario. Deliver gift based on name recognition.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_15_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_15_Sheet.pdf',
        coreActivity: 'Deliver gift based on name recognition',
        keyConcepts: ['OCR Application', 'Automation'],
      },
      {
        levelId: level2Development.id,
        sessionNumber: 6,
        title: 'HOW SPEECH RECOGNITION WORKS',
        description: 'Learn how AI converts speech into text. Convert spoken words into text.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_16_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_16_Sheet.pdf',
        coreActivity: 'Convert spoken words into text',
        keyConcepts: ['Speech Recognition', 'Audio Processing'],
      },
      {
        levelId: level2Development.id,
        sessionNumber: 7,
        title: 'ACTIVITY: MAKE YOUR OWN ALEXA',
        description: 'Create a simple voice assistant. Control actions using voice commands.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_17_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_17_Sheet.pdf',
        coreActivity: 'Control actions using voice commands',
        keyConcepts: ['Voice Commands', 'Speech-to-Text'],
      },
      {
        levelId: level2Development.id,
        sessionNumber: 8,
        title: 'Introduction of MACHINE LEARNING',
        description: 'Understand basics of machine learning. Observe learning from data examples.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_18_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_18_Sheet.pdf',
        coreActivity: 'Observe learning from data examples',
        keyConcepts: ['Machine Learning', 'Training Data'],
      },
      {
        levelId: level2Development.id,
        sessionNumber: 9,
        title: 'Ml Environment models',
        description: 'Explore ML environment and models in PictoBlox. Create and train ML models.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_19_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_19_Sheet.pdf',
        coreActivity: 'Create and train ML models',
        keyConcepts: ['ML Models', 'Training', 'Testing'],
      },
      {
        levelId: level2Development.id,
        sessionNumber: 10,
        title: 'Miniproject-Toy Recognition Using Machine Learning in PictoBlox',
        description: 'Apply ML concepts to recognize toys. Build a toy recognition project.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_20_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_20_SP_Sheet.pdf',
        coreActivity: 'Build a toy recognition project',
        keyConcepts: ['Image Classification', 'ML Project'],
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
      title: 'Mastery: Advanced ML and Capstone',
      description: 'Master advanced machine learning, pose classification, AI ethics, and build capstone projects. Sessions 21-30.',
      sequence: 3,
    });

    // Mastery Sessions (21-30)
    const masterySessions: CreateSessionInput[] = [
      {
        levelId: level3Mastery.id,
        sessionNumber: 1,
        title: 'CAT VS DOG: IMAGE CLASSIFIER IN PICTOBLOX',
        description: 'Use a trained ML model to classify images. Classify cat and dog images using PictoBlox.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_21_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_21_Sheet.pdf',
        coreActivity: 'Classify cat and dog images using PictoBlox',
        keyConcepts: ['Image Classification', 'ML Model'],
      },
      {
        levelId: level3Mastery.id,
        sessionNumber: 2,
        title: 'ROCK PAPER SCISSORS WITH AI – PART I',
        description: 'Create training data for hand pose recognition. Collect hand pose data for Rock, Paper, Scissors.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_22_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_22_Sheet.pdf',
        coreActivity: 'Collect hand pose data for Rock, Paper, Scissors',
        keyConcepts: ['Hand Pose', 'Training Data'],
      },
      {
        levelId: level3Mastery.id,
        sessionNumber: 3,
        title: 'ROCK PAPER SCISSORS WITH AI – PART II',
        description: 'Build game logic using AI predictions. Generate player and AI moves.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_23_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_23_Sheet.pdf',
        coreActivity: 'Generate player and AI moves',
        keyConcepts: ['Game Logic', 'Variables'],
      },
      {
        levelId: level3Mastery.id,
        sessionNumber: 4,
        title: 'ROCK PAPER SCISSORS WITH AI – PART III',
        description: 'Decide winner and scoring logic. Display game results and winner.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_24_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_24_Sheet.pdf',
        coreActivity: 'Display game results and winner',
        keyConcepts: ['Conditions', 'Score System'],
      },
      {
        levelId: level3Mastery.id,
        sessionNumber: 5,
        title: 'IMPORTANCE OF TRAINING DATA & POSE CLASSIFIER',
        description: 'Understand why quality data is important. Compare correct vs incorrect pose training.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_25_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_25_Sheet.pdf',
        coreActivity: 'Compare correct vs incorrect pose training',
        keyConcepts: ['Training Data', 'Accuracy'],
      },
      {
        levelId: level3Mastery.id,
        sessionNumber: 6,
        title: 'ACTIVITY – Howdy Tobi!',
        description: 'Create a pose-based greeting system. Make Tobi greet based on pose.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_26_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_26_Sheet.pdf',
        coreActivity: 'Make Tobi greet based on pose',
        keyConcepts: ['Pose Classifier', 'ML Activity'],
      },
      {
        levelId: level3Mastery.id,
        sessionNumber: 7,
        title: 'ETHICS IN ARTIFICIAL INTELLIGENCE',
        description: 'Learn responsible and fair use of AI. Discuss bias, trust, and fairness.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_27_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_27_Sheet.pdf',
        coreActivity: 'Discuss bias, trust, and fairness',
        keyConcepts: ['AI Ethics', 'Bias'],
      },
      {
        levelId: level3Mastery.id,
        sessionNumber: 8,
        title: 'HOW AI IS SHAPING SMART CITIES',
        description: 'Understand AI applications in smart cities. Explore traffic, waste, and energy systems.',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_28_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_28_Sheet.pdf',
        coreActivity: 'Explore traffic, waste, and energy systems',
        keyConcepts: ['Smart Cities', 'AI Applications'],
      },
      {
        levelId: level3Mastery.id,
        sessionNumber: 9,
        title: 'CAPSTONE PROJECT – Make Your Own Face Filters in PictoBlox Using Face Detection',
        description: 'Apply face detection concepts in a project. Create interactive face filter application. (Part 1 of 2)',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_29_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_29_MP_Sheet.pdf',
        coreActivity: 'Create interactive face filter application',
        keyConcepts: ['Face Detection', 'Capstone Project'],
      },
      {
        levelId: level3Mastery.id,
        sessionNumber: 10,
        title: 'CAPSTONE PROJECT – Make Your Own Face Filters in PictoBlox Using Face Detection',
        description: 'Apply face detection concepts in a project. Complete interactive face filter application. (Part 2 of 2)',
        expertVideoS3Key: 'Courses/AI/AI_Growth_Cycle_1/Videos/KC_AI_Cycle_1_Session_30_Video.mp4',
        learningSheetPdfS3Key: 'Courses/AI/AI_Growth_Cycle_1/Learning_Sheet/KC_AI_Cycle_1_Session_30_Sheet.pdf',
        coreActivity: 'Complete interactive face filter application',
        keyConcepts: ['Face Detection', 'Capstone Project', 'Integration'],
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
    console.log('🎉 AI Course Created Successfully!');
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
    console.log('📝 Special Session Files:');
    console.log('   Session 10: KC_AI_Cycle_1_Session_10_SP_Sheet.pdf (Special Project)');
    console.log('   Session 20: KC_AI_Cycle_1_Session_20_SP_Sheet.pdf (Special Project)');
    console.log('   Session 29: KC_AI_Cycle_1_Session_29_MP_Sheet.pdf (Mini Project/Capstone)');
    console.log('');
    console.log('📝 Next Steps:');
    console.log('   1. Upload video and PDF files to S3 and update S3 keys');
    console.log('   2. Create quizzes in MongoDB and update quizId in sessions');
    console.log('   3. Update thumbnail URL with actual image');
    console.log('   4. Test course creation and session access');
    console.log('');

  } catch (error: any) {
    console.error('\n❌ Error creating AI course:', error);
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
createAICourseGrowthCycle1().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
