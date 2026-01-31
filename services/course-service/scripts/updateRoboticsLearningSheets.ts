/**
 * Script to update Robotics Course with Learning Sheet PDFs
 * 
 * This script:
 * 1. Finds or creates the Robotics Fundamentals course
 * 2. Creates sessions 1-26 if they don't exist
 * 3. Updates learningSheetPdfS3Key for each session with corresponding PDF
 * 
 * PDF files should be in: V:\Robotics_Growth_Cycle_1\Learning_Sheet
 * File naming: KC_Level_1_Session_X.pdf (where X is 1-26)
 * 
 * Note: Sessions 27-30 will be added later
 */

import "@kodingcaravan/shared/config";
import * as fs from 'fs';
import * as path from 'path';
import { initPostgres, getPostgresPool } from '../src/config/database';
import { CourseRepository } from '../src/models/course.model';
import { CourseStructureRepository } from '../src/models/courseStructure.model';
import type { CreateSessionInput } from '../src/models/courseStructure.model';

// PDF directory - can be overridden with environment variable
const PDF_DIRECTORY = process.env.ROBOTICS_LEARNING_SHEET_DIR || 'V:\\Robotics_Growth_Cycle_1\\Learning_Sheet';

/**
 * Map global session number (1-26) to phase, level, and session within level
 * Structure: Phase 1 has 3 levels, 10 sessions each
 * - Sessions 1-10: Phase 1, Level 1 (Foundation)
 * - Sessions 11-20: Phase 1, Level 2 (Development)  
 * - Sessions 21-26: Phase 1, Level 3 (Mastery) - only 6 sessions for now
 */
function mapSessionNumber(sessionNum: number): {
  phaseSequence: number;
  levelSequence: number;
  levelType: 'foundation' | 'development' | 'mastery';
  sessionInLevel: number;
} {
  if (sessionNum >= 1 && sessionNum <= 10) {
    return {
      phaseSequence: 1,
      levelSequence: 1,
      levelType: 'foundation',
      sessionInLevel: sessionNum,
    };
  } else if (sessionNum >= 11 && sessionNum <= 20) {
    return {
      phaseSequence: 1,
      levelSequence: 2,
      levelType: 'development',
      sessionInLevel: sessionNum - 10,
    };
  } else if (sessionNum >= 21 && sessionNum <= 26) {
    return {
      phaseSequence: 1,
      levelSequence: 3,
      levelType: 'mastery',
      sessionInLevel: sessionNum - 20,
    };
  } else {
    throw new Error(`Session number ${sessionNum} is out of range (1-26)`);
  }
}

/**
 * Extract session number from filename
 * Handles formats like:
 * - KC_Level_1_Session_1.pdf
 * - KC_Level_1_Session _1.pdf (with space)
 * - KC_Level_1_Session1.pdf
 */
function extractSessionNumber(fileName: string): number | null {
  // Try different patterns
  const patterns = [
    /Session[_\s]*(\d+)/i,
    /Session(\d+)/i,
  ];
  
  for (const pattern of patterns) {
    const match = fileName.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  
  return null;
}

/**
 * Generate S3 key for learning sheet PDF
 */
function generateS3Key(sessionNum: number, fileName: string): string {
  const mapping = mapSessionNumber(sessionNum);
  const levelType = mapping.levelType;
  const sessionInLevel = mapping.sessionInLevel;
  
  // Use the original filename but in S3 structure
  return `courses/robotics/phase-1/${levelType}/session-${sessionInLevel}/learning-sheet.pdf`;
}

async function updateRoboticsLearningSheets() {
  let pool;
  try {
    console.log('🚀 Starting Robotics Learning Sheets Update...\n');
    
    // Initialize database
    console.log('🔌 Connecting to databases...');
    await initPostgres();
    pool = getPostgresPool();
    console.log('✅ PostgreSQL connected\n');
    
    const courseRepo = new CourseRepository(pool);
    const structureRepo = new CourseStructureRepository(pool);
    
    // Find or create robotics course
    console.log('📚 Finding Robotics Course...');
    let courses = await courseRepo.findMany({ category: 'STEM', search: 'robotics' });
    let roboticsCourse = courses.courses.find(c => 
      c.title.toLowerCase().includes('robotics')
    );
    
    if (!roboticsCourse) {
      console.log('   Course not found. Creating new course...');
      roboticsCourse = await courseRepo.create({
        title: 'Robotics Fundamentals',
        description: `A comprehensive course covering the fundamentals of robotics, from basic concepts to advanced applications. Learn to build, program, and control robots through hands-on projects and real-world applications.`,
        shortDescription: 'Master robotics from basics to advanced applications with hands-on projects',
        category: 'STEM',
        subcategory: 'Robotics',
        difficulty: 'beginner',
        price: 2999.00,
        currency: 'INR',
        discountPrice: 1999.00,
        thumbnailUrl: 'https://example.com/robotics-course-thumbnail.jpg',
        duration: 1800,
        tags: ['robotics', 'programming', 'electronics', 'arduino', 'sensors', 'automation'],
        language: 'en',
      });
      console.log(`✅ Created course: ${roboticsCourse.title} (${roboticsCourse.id})\n`);
    } else {
      console.log(`✅ Found course: ${roboticsCourse.title} (${roboticsCourse.id})\n`);
    }
    
    // Get or create Phase 1
    console.log('📖 Setting up Phase 1: Introduction to Robotics...');
    let phases = await structureRepo.getPhasesByCourseId(roboticsCourse.id);
    let phase1 = phases.find(p => p.sequence === 1);
    
    if (!phase1) {
      phase1 = await structureRepo.createPhase({
        courseId: roboticsCourse.id,
        title: 'Introduction to Robotics',
        description: 'Learn the basics of robotics, including components, sensors, and basic programming concepts.',
        sequence: 1,
      });
      console.log(`✅ Created Phase 1: ${phase1.title}\n`);
    } else {
      console.log(`✅ Found Phase 1: ${phase1.title}\n`);
    }
    
    // Get or create levels for Phase 1
    const levelTypes: Array<{ sequence: number; type: 'foundation' | 'development' | 'mastery'; title: string }> = [
      { sequence: 1, type: 'foundation', title: 'Foundation: Robotics Basics' },
      { sequence: 2, type: 'development', title: 'Development: Intermediate Robotics' },
      { sequence: 3, type: 'mastery', title: 'Mastery: Advanced Robotics' },
    ];
    
    const levels: Array<{ id: string; sequence: number; type: string }> = [];
    
    for (const levelDef of levelTypes) {
      let levelsInPhase = await structureRepo.getLevelsByPhaseId(phase1.id);
      let level = levelsInPhase.find(l => l.sequence === levelDef.sequence);
      
      if (!level) {
        level = await structureRepo.createLevel({
          phaseId: phase1.id,
          levelType: levelDef.type,
          title: levelDef.title,
          description: `${levelDef.type} level of robotics concepts`,
          sequence: levelDef.sequence,
        });
        console.log(`✅ Created Level ${levelDef.sequence}: ${levelDef.title}`);
      } else {
        console.log(`✅ Found Level ${levelDef.sequence}: ${level.title}`);
      }
      
      levels.push({ id: level.id, sequence: levelDef.sequence, type: levelDef.type });
    }
    console.log('');
    
    // Read PDF files
    console.log(`📁 Reading PDF files from: ${PDF_DIRECTORY}`);
    if (!fs.existsSync(PDF_DIRECTORY)) {
      throw new Error(`PDF directory not found: ${PDF_DIRECTORY}`);
    }
    
    const files = fs.readdirSync(PDF_DIRECTORY)
      .filter(file => file.toLowerCase().endsWith('.pdf'))
      .map(file => ({
        fileName: file,
        filePath: path.join(PDF_DIRECTORY, file),
        sessionNumber: extractSessionNumber(file),
      }))
      .filter(file => file.sessionNumber !== null && file.sessionNumber >= 1 && file.sessionNumber <= 26)
      .sort((a, b) => (a.sessionNumber || 0) - (b.sessionNumber || 0));
    
    console.log(`✅ Found ${files.length} valid PDF files (sessions 1-26)\n`);
    
    if (files.length === 0) {
      throw new Error('No valid PDF files found. Expected files like: KC_Level_1_Session_1.pdf');
    }
    
    // Process each PDF file
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    
    for (const file of files) {
      const sessionNum = file.sessionNumber!;
      const mapping = mapSessionNumber(sessionNum);
      const level = levels.find(l => l.sequence === mapping.levelSequence);
      
      if (!level) {
        console.error(`  ❌ Could not find level for session ${sessionNum}`);
        skippedCount++;
        continue;
      }
      
      // Check if session exists
      const existingSessions = await structureRepo.getSessionsByLevelId(level.id);
      let session = existingSessions.find(s => s.sessionNumber === mapping.sessionInLevel);
      
      const s3Key = generateS3Key(sessionNum, file.fileName);
      
      if (!session) {
        // Create new session
        const sessionInput: CreateSessionInput = {
          levelId: level.id,
          sessionNumber: mapping.sessionInLevel,
          title: `Session ${sessionNum}: Robotics Fundamentals`,
          description: `Robotics fundamentals session ${sessionNum} - ${mapping.levelType} level`,
          learningSheetPdfS3Key: s3Key,
          coreActivity: `Complete robotics activity for session ${sessionNum}`,
          keyConcepts: ['Robotics fundamentals', 'Hands-on learning', 'Practical application'],
        };
        
        session = await structureRepo.createSession(sessionInput);
        console.log(`  ✅ Created Session ${sessionNum} (Level ${mapping.levelSequence}, Session ${mapping.sessionInLevel})`);
        createdCount++;
      } else {
        // Update existing session with learning sheet S3 key
        const result = await pool.query(
          `UPDATE course_sessions 
           SET learning_sheet_pdf_s3_key = $1, updated_at = NOW()
           WHERE id = $2
           RETURNING *`,
          [s3Key, session.id]
        );
        
        if (result.rows.length > 0) {
          console.log(`  ✅ Updated Session ${sessionNum} (Level ${mapping.levelSequence}, Session ${mapping.sessionInLevel})`);
          updatedCount++;
        } else {
          console.warn(`  ⚠️  Could not update Session ${sessionNum}`);
          skippedCount++;
        }
      }
    }
    
    console.log('\n🎉 Update Complete!');
    console.log(`   ✅ Created: ${createdCount} sessions`);
    console.log(`   ✅ Updated: ${updatedCount} sessions`);
    console.log(`   ⚠️  Skipped: ${skippedCount} files`);
    console.log('\n📝 Note: Learning sheet PDFs are stored as S3 keys.');
    console.log('   Upload the actual PDF files to S3 using these keys:');
    console.log('   Format: courses/robotics/phase-1/{levelType}/session-{num}/learning-sheet.pdf');
    console.log('\n📝 Sessions 27-30 will be added later as mentioned.\n');
    
  } catch (error: any) {
    console.error('\n❌ Error updating learning sheets:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

// Run the script
if (require.main === module) {
  updateRoboticsLearningSheets()
    .then(() => {
      console.log('✅ Script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Script failed:', error);
      process.exit(1);
    });
}

export { updateRoboticsLearningSheets };

