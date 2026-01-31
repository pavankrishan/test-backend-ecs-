/**
 * Script to verify and link AI course quizzes to sessions
 * 
 * This script:
 * 1. Finds all AI course sessions
 * 2. Checks if quizzes exist in MongoDB for each session
 * 3. Updates quizId in PostgreSQL if missing
 * 
 * Run: pnpm tsx scripts/verifyAndLinkAIQuizzes.ts
 */

import "@kodingcaravan/shared/config";
import { initPostgres, getPostgresPool } from '../src/config/database';
import { initMongo } from '../src/config/database';
import { QuizRepository } from '../src/repositories/quiz.repository';
import { CourseStructureRepository } from '../src/models/courseStructure.model';
import { CourseRepository } from '../src/models/course.model';

async function verifyAndLinkAIQuizzes() {
  try {
    console.log('🚀 Starting AI Quiz Verification and Linking...\n');
    
    // Initialize databases
    console.log('🔌 Connecting to databases...');
    await initPostgres();
    await initMongo();
    console.log('✅ Databases connected\n');
    
    const pool = getPostgresPool();
    const courseRepo = new CourseRepository(pool);
    const structureRepo = new CourseStructureRepository(pool);
    const quizRepository = new QuizRepository();
    
    // Find AI course - try multiple search strategies
    console.log('🔍 Searching for AI course...');
    
    // Strategy 1: Search with category and search term
    let courses = await courseRepo.findMany({ category: 'STEM', search: 'ai' });
    let aiCourse = courses.courses.find(c => 
      c.title.toLowerCase().includes('ai') || 
      c.subcategory?.toLowerCase().includes('artificial intelligence')
    );
    
    // Strategy 2: If not found, search all courses for 'ai'
    if (!aiCourse) {
      console.log('   Trying broader search...');
      courses = await courseRepo.findMany({ search: 'ai' });
      aiCourse = courses.courses.find(c => 
        c.title.toLowerCase().includes('ai') || 
        c.subcategory?.toLowerCase().includes('artificial intelligence') ||
        c.title.toLowerCase() === 'ai'
      );
    }
    
    // Strategy 3: Get all courses and find exact match
    if (!aiCourse) {
      console.log('   Searching all courses...');
      courses = await courseRepo.findMany({});
      aiCourse = courses.courses.find(c => 
        c.title.toLowerCase().trim() === 'ai' ||
        c.title.toLowerCase().includes('artificial intelligence') ||
        c.subcategory?.toLowerCase().includes('artificial intelligence')
      );
    }
    
    // If still not found, show available courses for debugging
    if (!aiCourse) {
      console.error('\n❌ AI course not found. Available courses in database:');
      if (courses.courses.length === 0) {
        console.error('   No courses found in database.');
      } else {
        courses.courses.forEach((c, idx) => {
          console.error(`   ${idx + 1}. ${c.title} (ID: ${c.id})`);
          console.error(`      Category: ${c.category}, Subcategory: ${c.subcategory || 'N/A'}`);
        });
      }
      throw new Error('AI course not found. Please create it first using createAICourseGrowthCycle1.ts');
    }
    
    console.log(`✅ Found course: ${aiCourse.title} (${aiCourse.id})\n`);
    
    // Get all phases, levels, and sessions
    const phases = await structureRepo.getPhasesByCourseId(aiCourse.id);
    console.log(`   Found ${phases.length} phases\n`);
    
    let totalSessions = 0;
    let linkedCount = 0;
    let missingQuizCount = 0;
    let alreadyLinkedCount = 0;
    
    for (const phase of phases.sort((a, b) => a.sequence - b.sequence)) {
      const levels = await structureRepo.getLevelsByPhaseId(phase.id);
      
      for (const level of levels.sort((a, b) => a.sequence - b.sequence)) {
        const sessions = await structureRepo.getSessionsByLevelId(level.id);
        
        for (const session of sessions.sort((a, b) => a.sessionNumber - b.sessionNumber)) {
          totalSessions++;
          
          // Check if quiz exists in MongoDB
          const quiz = await quizRepository.findBySessionId(session.id);
          
          if (quiz) {
            // Quiz exists in MongoDB
            if (session.quizId) {
              // Already linked
              if (session.quizId === quiz._id.toString()) {
                alreadyLinkedCount++;
                console.log(`  ✓ Session ${session.sessionNumber}: ${session.title} - Already linked`);
              } else {
                // Wrong quizId, update it
                console.log(`  🔄 Session ${session.sessionNumber}: ${session.title} - Updating quizId`);
                await structureRepo.updateSessionQuizId(session.id, quiz._id.toString());
                linkedCount++;
              }
            } else {
              // Not linked, link it
              console.log(`  🔗 Session ${session.sessionNumber}: ${session.title} - Linking quiz`);
              await structureRepo.updateSessionQuizId(session.id, quiz._id.toString());
              linkedCount++;
            }
          } else {
            // No quiz found in MongoDB
            missingQuizCount++;
            console.log(`  ⚠️  Session ${session.sessionNumber}: ${session.title} - No quiz found in MongoDB`);
          }
        }
      }
    }
    
    console.log('\n🎉 Verification Complete!');
    console.log(`   Total sessions: ${totalSessions}`);
    console.log(`   ✅ Already linked: ${alreadyLinkedCount}`);
    console.log(`   🔗 Newly linked: ${linkedCount}`);
    console.log(`   ⚠️  Missing quizzes: ${missingQuizCount}`);
    
    if (missingQuizCount > 0) {
      console.log(`\n💡 Run uploadAIMCQs.ts to create missing quizzes`);
    }
    
    console.log('\n✅ All quizzes are now linked to their sessions!\n');
    
  } catch (error: any) {
    console.error('\n❌ Error:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  verifyAndLinkAIQuizzes()
    .then(() => {
      console.log('\n✅ Script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Script failed:', error);
      process.exit(1);
    });
}

export { verifyAndLinkAIQuizzes };

