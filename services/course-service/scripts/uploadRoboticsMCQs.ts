/**
 * Script to upload MCQ questions from PDF files to MongoDB
 * 
 * This script:
 * 1. Reads MCQ PDF files from the specified directory
 * 2. Extracts questions from PDFs (requires text-extraction)
 * 3. Creates Quiz documents in MongoDB
 * 4. Links quizzes to robotics course sessions via quizId
 * 
 * Note: PDF parsing requires a library like pdf-parse or pdfjs-dist
 * This script provides a framework - you may need to adjust parsing logic
 * based on your PDF format.
 */

import "@kodingcaravan/shared/config";
import * as fs from 'fs';
import * as path from 'path';
import { initPostgres, getPostgresPool } from '../src/config/database';
import { initMongo } from '../src/config/database';
import { QuizRepository, CreateQuizInput } from '../src/repositories/quiz.repository';
import { CourseStructureRepository } from '../src/models/courseStructure.model';
import { CourseRepository } from '../src/models/course.model';
import type { MCQQuestion } from '../src/models/quiz.model';

// PDF parsing - install pdf-parse: pnpm add -D pdf-parse @types/pdf-parse
let pdfParse: any = null;
try {
  // pdf-parse v2.x exports the function directly in CommonJS
  pdfParse = require('pdf-parse');
} catch (e) {
  console.warn('⚠️  pdf-parse not installed. Install with: pnpm add -D pdf-parse @types/pdf-parse');
  console.warn('   Or use pdfjs-dist: pnpm add -D pdfjs-dist');
}

interface PDFQuestion {
  sessionNumber: number;
  questions: MCQQuestion[];
}

/**
 * Extract text from PDF file
 */
async function extractTextFromPDF(filePath: string): Promise<string> {
  if (!pdfParse) {
    throw new Error('PDF parsing library not available. Please install pdf-parse or pdfjs-dist');
  }

  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text;
}

/**
 * Parse MCQ questions from PDF text
 * This is a template - adjust based on your PDF format
 */
function parseQuestionsFromText(text: string, sessionNumber: number): MCQQuestion[] {
  const questions: MCQQuestion[] = [];
  
  // Example parsing patterns (adjust based on your PDF format)
  // Common formats:
  // 1. "Q1. Question text\nA) Option1\nB) Option2\nC) Option3\nD) Option4\nAnswer: B"
  // 2. "Question 1: Question text\n(a) Option1\n(b) Option2..."
  
  // Split by question markers (adjust regex based on your format)
  const questionBlocks = text.split(/(?:Q\d+\.|Question\s+\d+[:\\.])/i);
  
  questionBlocks.forEach((block, index) => {
    if (!block.trim()) return;
    
    // Extract question text (first line or until options start)
    const lines = block.trim().split('\n').filter(l => l.trim());
    if (lines.length < 5) return; // Need at least question + 4 options
    
    const questionText = lines[0].trim();
    if (!questionText) return;
    
    // Extract options (typically 4 options: A, B, C, D or a, b, c, d or 1, 2, 3, 4)
    const options: string[] = [];
    let correctAnswerIndex = -1;
    let explanation = '';
    
    // Look for options (patterns like "A)", "a)", "1)", "(A)", etc.)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      const optionMatch = line.match(/^([(]?)([A-Da-d1-4])([)\\.])/);
      
      if (optionMatch) {
        const optionText = line.replace(/^[(]?[A-Da-d1-4][)\\.]\s*/, '').trim();
        if (optionText) {
          options.push(optionText);
        }
      }
      
      // Look for answer indicators
      if (line.match(/^(Answer|Correct Answer|Ans)[:\\.]\s*([A-Da-d1-4])/i)) {
        const answerMatch = line.match(/([A-Da-d1-4])/i);
        if (answerMatch) {
          const answerChar = answerMatch[1].toUpperCase();
          correctAnswerIndex = answerChar.charCodeAt(0) - 'A'.charCodeAt(0);
          if (correctAnswerIndex < 0 || correctAnswerIndex >= options.length) {
            // Try numeric
            const numAnswer = parseInt(answerChar);
            if (!isNaN(numAnswer) && numAnswer >= 1 && numAnswer <= 4) {
              correctAnswerIndex = numAnswer - 1;
            }
          }
        }
      }
      
      // Look for explanation
      if (line.match(/^(Explanation|Explain|Reason)[:\\.]/i)) {
        explanation = lines.slice(i).join(' ').replace(/^(Explanation|Explain|Reason)[:\\.]\s*/i, '').trim();
        break;
      }
    }
    
    // Only add if we have valid question, options, and answer
    if (questionText && options.length >= 4 && correctAnswerIndex >= 0 && correctAnswerIndex < options.length) {
      questions.push({
        id: `q${index + 1}`,
        question: questionText,
        options: options.slice(0, 4), // Take first 4 options
        correctAnswerIndex,
        explanation: explanation || undefined,
        points: 10, // Default points
      });
    }
  });
  
  return questions;
}

/**
 * Process a single PDF file and extract questions
 */
async function processPDFFile(filePath: string): Promise<PDFQuestion | null> {
  try {
    const fileName = path.basename(filePath);
    console.log(`  📄 Processing: ${fileName}`);
    
    // Extract session number from filename (e.g., Session1, Session26)
    const sessionMatch = fileName.match(/Session(\d+)/i);
    if (!sessionMatch) {
      console.warn(`    ⚠️  Could not extract session number from filename: ${fileName}`);
      return null;
    }
    
    const sessionNumber = parseInt(sessionMatch[1]);
    
    // Extract text from PDF
    const text = await extractTextFromPDF(filePath);
    
    // Parse questions
    const questions = parseQuestionsFromText(text, sessionNumber);
    
    if (questions.length === 0) {
      console.warn(`    ⚠️  No questions extracted from ${fileName}`);
      return null;
    }
    
    console.log(`    ✅ Extracted ${questions.length} questions`);
    return { sessionNumber, questions };
    
  } catch (error: any) {
    console.error(`    ❌ Error processing ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Find robotics course and map sessions
 */
async function findRoboticsCourseAndSessions() {
  const pool = getPostgresPool();
  const courseRepo = new CourseRepository(pool);
  const structureRepo = new CourseStructureRepository(pool);
  
  // Find robotics course by title
  const courses = await courseRepo.findMany({ category: 'STEM', search: 'robotics' });
  const roboticsCourse = courses.courses.find(c => 
    c.title.toLowerCase().includes('robotics')
  );
  
  if (!roboticsCourse) {
    throw new Error('Robotics course not found. Please create it first.');
  }
  
  console.log(`✅ Found course: ${roboticsCourse.title} (${roboticsCourse.id})\n`);
  
  // Get all phases, levels, and sessions
  const phases = await structureRepo.getPhasesByCourseId(roboticsCourse.id);
  console.log(`   Found ${phases.length} phases`);
  
  if (phases.length === 0) {
    throw new Error('Robotics course has no phases. Please create phases and sessions first.');
  }
  
  // Create a map of session numbers to session IDs
  // Note: Session numbers are 1-10 within each level
  // We need to map global session number to actual session
  const sessionMap = new Map<number, { sessionId: string; phase: number; level: number; sessionInLevel: number }>();
  
  let globalSessionNumber = 1;
  
  for (const phase of phases.sort((a, b) => a.sequence - b.sequence)) {
    const levels = await structureRepo.getLevelsByPhaseId(phase.id);
    console.log(`   Phase ${phase.sequence}: ${phase.title} - ${levels.length} levels`);
    
    for (const level of levels.sort((a, b) => a.sequence - b.sequence)) {
      const sessions = await structureRepo.getSessionsByLevelId(level.id);
      console.log(`     Level ${level.sequence} (${level.levelType}): ${sessions.length} sessions`);
      
      for (const session of sessions.sort((a, b) => a.sessionNumber - b.sessionNumber)) {
        sessionMap.set(globalSessionNumber, {
          sessionId: session.id,
          phase: phase.sequence,
          level: level.sequence,
          sessionInLevel: session.sessionNumber,
        });
        globalSessionNumber++;
      }
    }
  }
  
  console.log(`\n✅ Mapped ${sessionMap.size} sessions (expected: 90 for full course)\n`);
  
  if (sessionMap.size < 22) {
    console.warn(`⚠️  Warning: Only ${sessionMap.size} sessions found, but you have 22 PDF files.`);
    console.warn(`   Some PDFs may not be matched. Consider creating all sessions first.\n`);
  }
  
  return { course: roboticsCourse, sessionMap };
}

/**
 * Main function
 */
async function uploadRoboticsMCQs() {
  try {
    console.log('🚀 Starting MCQ Upload Process...\n');
    
    // Initialize databases
    console.log('🔌 Connecting to databases...');
    await initPostgres();
    await initMongo();
    console.log('✅ Databases connected\n');
    
    // PDF directory - can be overridden with environment variable
    const pdfDirectory = process.env.MCQ_PDF_DIRECTORY || 'e:\\Robotics_Growth_Cycle_1\\MCQS';
    
    if (!fs.existsSync(pdfDirectory)) {
      throw new Error(`PDF directory not found: ${pdfDirectory}`);
    }
    
    console.log(`📁 Reading PDF files from: ${pdfDirectory}\n`);
    
    // Read all PDF files
    const files = fs.readdirSync(pdfDirectory)
      .filter(file => file.toLowerCase().endsWith('.pdf'))
      .map(file => path.join(pdfDirectory, file))
      .sort();
    
    console.log(`Found ${files.length} PDF files\n`);
    
    if (files.length === 0) {
      throw new Error('No PDF files found in directory');
    }
    
    // Find robotics course and sessions
    const { course, sessionMap } = await findRoboticsCourseAndSessions();
    
    // Process PDFs and extract questions
    const quizRepository = new QuizRepository();
    const pool = getPostgresPool();
    const structureRepo = new CourseStructureRepository(pool);
    
    let uploadedCount = 0;
    let skippedCount = 0;
    
    for (const filePath of files) {
      const pdfData = await processPDFFile(filePath);
      
      if (!pdfData) {
        skippedCount++;
        continue;
      }
      
      const { sessionNumber, questions } = pdfData;
      
      // Find corresponding session
      const sessionInfo = sessionMap.get(sessionNumber);
      if (!sessionInfo) {
        console.warn(`  ⚠️  Session ${sessionNumber} not found in course structure`);
        skippedCount++;
        continue;
      }
      
      // Validate question count (12-25 as per requirements)
      if (questions.length < 12 || questions.length > 25) {
        console.warn(`  ⚠️  Session ${sessionNumber}: Expected 12-25 questions, found ${questions.length}`);
        // Continue anyway, but warn
      }
      
      // Check if quiz already exists
      const existingQuiz = await quizRepository.findBySessionId(sessionInfo.sessionId);
      if (existingQuiz) {
        console.log(`  ⚠️  Quiz already exists for Session ${sessionNumber}, skipping...`);
        skippedCount++;
        continue;
      }
      
      // Create quiz in MongoDB
      try {
        const quizInput: CreateQuizInput = {
          sessionId: sessionInfo.sessionId,
          questions,
          passingScore: 60, // 60% passing score (adjust as needed)
        };
        
        const quiz = await quizRepository.create(quizInput);
        console.log(`  ✅ Created quiz for Session ${sessionNumber} (${questions.length} questions, ID: ${quiz._id})`);
        
        // Update session with quizId in PostgreSQL
        try {
          await structureRepo.updateSessionQuizId(sessionInfo.sessionId, quiz._id.toString());
          console.log(`  ✅ Linked quiz to session\n`);
        } catch (linkError: any) {
          console.warn(`  ⚠️  Created quiz but failed to link to session: ${linkError.message}`);
          console.log(`     Quiz ID: ${quiz._id.toString()}`);
          console.log(`     Session ID: ${sessionInfo.sessionId}`);
          console.log(`     You can link manually with: UPDATE course_sessions SET quiz_id = '${quiz._id.toString()}' WHERE id = '${sessionInfo.sessionId}';\n`);
        }
        
        uploadedCount++;
      } catch (error: any) {
        console.error(`  ❌ Error creating quiz for Session ${sessionNumber}:`, error.message);
        skippedCount++;
      }
    }
    
    console.log('\n🎉 Upload Complete!');
    console.log(`   ✅ Uploaded: ${uploadedCount} quizzes`);
    console.log(`   ⚠️  Skipped: ${skippedCount} files`);
    console.log(`\n📝 Note: You may need to update session.quizId fields in PostgreSQL`);
    console.log(`   to link sessions to their quizzes.\n`);
    
  } catch (error: any) {
    console.error('\n❌ Error uploading MCQs:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  uploadRoboticsMCQs()
    .then(() => {
      console.log('\n✅ Script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Script failed:', error);
      process.exit(1);
    });
}

export { uploadRoboticsMCQs };

