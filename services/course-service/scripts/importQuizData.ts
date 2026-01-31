/**
 * Script to import quiz questions for AI Course (Growth Cycle 1)
 * 
 * This script:
 * 1. Finds the AI course and Growth Cycle 1 sessions
 * 2. Parses quiz data from the provided format
 * 3. Creates quiz documents in MongoDB with questions
 * 4. Links quizzes to sessions in PostgreSQL
 * 
 * Run: pnpm tsx scripts/importQuizData.ts
 */

import "@kodingcaravan/shared/config";
import { initPostgres, getPostgresPool } from '../src/config/database';
import { initMongo } from '../src/config/database';
import { QuizRepository, CreateQuizInput } from '../src/repositories/quiz.repository';
import { CourseStructureRepository } from '../src/models/courseStructure.model';
import { CourseRepository } from '../src/models/course.model';
import type { MCQQuestion } from '../src/models/quiz.model';

/**
 * Quiz data structure for a session
 */
interface SessionQuizData {
  sessionNumber: number;
  questions: Array<{
    questionNumber: number;
    question: string;
    questionImageUrl?: string;
    options: string[];
    optionImageUrls?: string[];
    correctAnswer: string; // 'A', 'B', 'C', or 'D'
    explanation?: string;
  }>;
}

/**
 * Parse quiz data from text format
 * Format:
 * SESSION X
 * 1. Question text
 * A. Option A
 * B. Option B
 * C. Option C
 * D. Option D
 * ✅ Answer: X
 */
function parseQuizData(text: string): SessionQuizData[] {
  const sessions: SessionQuizData[] = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  let currentSession: SessionQuizData | null = null;
  let currentQuestion: any = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check for session header
    const sessionMatch = line.match(/^SESSION\s+(\d+)$/i);
    if (sessionMatch) {
      // Save previous session if exists
      if (currentSession && currentQuestion) {
        currentSession.questions.push(currentQuestion);
      }
      if (currentSession) {
        sessions.push(currentSession);
      }
      
      currentSession = {
        sessionNumber: parseInt(sessionMatch[1]),
        questions: [],
      };
      currentQuestion = null;
      continue;
    }
    
    // Check for question number
    const questionMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (questionMatch) {
      // Save previous question if exists
      if (currentQuestion) {
        currentSession!.questions.push(currentQuestion);
      }
      
      currentQuestion = {
        questionNumber: parseInt(questionMatch[1]),
        question: questionMatch[2],
        options: [],
        optionImageUrls: [],
      };
      continue;
    }
    
    // Check for option (A, B, C, D)
    const optionMatch = line.match(/^([A-D])\.\s+(.+)$/i);
    if (optionMatch && currentQuestion) {
      const optionText = optionMatch[2];
      currentQuestion.options.push(optionText);
      currentQuestion.optionImageUrls = currentQuestion.optionImageUrls || [];
      currentQuestion.optionImageUrls.push(undefined); // Placeholder, will be filled if image exists
      continue;
    }
    
    // Check for answer (handle both ✅ emoji and text)
    // Matches: "✅ Answer: B" or "Answer: B"
    const answerMatch = line.match(/(?:✅\s*)?Answer:\s*([A-D])/i);
    if (answerMatch && currentQuestion) {
      currentQuestion.correctAnswer = answerMatch[1].toUpperCase();
      continue;
    }
    
    // Check for explanation (starts with explanation text)
    if (currentQuestion && !currentQuestion.correctAnswer && line.length > 0) {
      // Might be continuation of question or explanation
      // For now, skip lines that don't match patterns
    }
  }
  
  // Add last question and session
  if (currentQuestion && currentSession) {
    currentSession.questions.push(currentQuestion);
  }
  if (currentSession) {
    sessions.push(currentSession);
  }
  
  return sessions;
}

/**
 * Convert parsed quiz data to MCQQuestion format
 */
function convertToMCQQuestions(sessionData: SessionQuizData): MCQQuestion[] {
  return sessionData.questions
    .filter(q => {
      // Filter out incomplete questions
      const hasCorrectAnswer = q.correctAnswer && q.correctAnswer.length === 1;
      const hasEnoughOptions = q.options && q.options.length >= 2;
      const hasQuestion = q.question && q.question.trim().length > 0;
      
      if (!hasCorrectAnswer || !hasEnoughOptions || !hasQuestion) {
        console.warn(`  ⚠️  Skipping incomplete question ${q.questionNumber} in Session ${sessionData.sessionNumber}`);
        return false;
      }
      return true;
    })
    .map((q, idx) => {
      const correctAnswerIndex = q.correctAnswer.charCodeAt(0) - 'A'.charCodeAt(0);
      
      // Validate correctAnswerIndex is within bounds
      if (correctAnswerIndex < 0 || correctAnswerIndex >= q.options.length) {
        throw new Error(`Invalid correctAnswer '${q.correctAnswer}' for question ${q.questionNumber} in Session ${sessionData.sessionNumber}. Options count: ${q.options.length}`);
      }
      
      return {
        id: `session-${sessionData.sessionNumber}-q${q.questionNumber}`,
        question: q.question,
        questionImageUrl: q.questionImageUrl,
        options: q.options,
        optionImageUrls: q.optionImageUrls && q.optionImageUrls.length === q.options.length && q.optionImageUrls.some(url => url)
          ? q.optionImageUrls 
          : undefined,
        correctAnswerIndex,
        explanation: q.explanation,
        points: 10, // Default points per question
      };
    });
}

/**
 * Find AI course and all sessions from Growth Cycle 1
 */
async function findAICourseAndSessions() {
  const pool = getPostgresPool();
  const courseRepo = new CourseRepository(pool);
  const structureRepo = new CourseStructureRepository(pool);
  
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
  
  // Get Growth Cycle 1 phase
  const phases = await structureRepo.getPhasesByCourseId(aiCourse.id);
  const growthCycle1 = phases.find(p => 
    p.title.toLowerCase().includes('growth cycle 1') ||
    p.title.toLowerCase().includes('cycle 1')
  );
  
  if (!growthCycle1) {
    throw new Error('Growth Cycle 1 phase not found. Please create it first.');
  }
  
  console.log(`✅ Found phase: ${growthCycle1.title}\n`);
  
  // Get all sessions from Growth Cycle 1
  const sessions: Array<{
    sessionId: string;
    sessionNumber: number;
    title: string;
  }> = [];
  
  const levels = await structureRepo.getLevelsByPhaseId(growthCycle1.id);
  
  for (const level of levels.sort((a, b) => a.sequence - b.sequence)) {
    const levelSessions = await structureRepo.getSessionsByLevelId(level.id);
    console.log(`   Level ${level.sequence} (${level.levelType}): ${levelSessions.length} sessions`);
    
    for (const session of levelSessions.sort((a, b) => a.sessionNumber - b.sessionNumber)) {
      sessions.push({
        sessionId: session.id,
        sessionNumber: sessions.length + 1, // Global session number (1-30)
        title: session.title,
      });
    }
  }
  
  console.log(`\n✅ Found ${sessions.length} sessions in Growth Cycle 1\n`);
  
  return { course: aiCourse, phase: growthCycle1, sessions };
}

/**
 * Quiz data for sessions 1-4
 * TODO: Add quiz data for sessions 5-25 when available
 */
const QUIZ_DATA_TEXT = `
SESSION 1
1. In the story of “Rex, the Curious Robot”, Rex learns by seeing sunny and cloudy images. What type of
learning is shown here?
A. Learning by memorizing rules
B. Learning from examples
C. Learning by guessing
D. Learning by copying humans
✅ Answer: B

2. The concept of “Intelligence” is defined in the session. Which ability best represents intelligence?
A. Running fast
B. Learning, understanding, and solving problems
C. Storing data only
D. Following commands without thinking
✅ Answer: B

3. The idea “AI = Artificial + Intelligence” mainly focuses on machines being able to:
A. Replace humans completely
B. Think and act smartly
C. Work without electricity
D. Store large files
✅ Answer: B

4. In Session 1, learning from experience means:
A. Forgetting past actions
B. Remembering and improving from past situations
C. Learning only once
D. Copying others
✅ Answer: B

5. The ability to understand information refers to:
A. Seeing images only
B. Making sense of what is seen, heard, or read
C. Speaking loudly
D. Writing programs
✅ Answer: B

6. The concept “solve problems” in intelligence involves:
A. Choosing answers randomly
B. Finding solutions creatively and logically
C. Asking others every time
D. Avoiding difficult tasks
✅ Answer: B

7. The idea of “make smart choices” in intelligence means:
A. Acting without thinking
B. Using judgment to choose what is best
C. Always choosing the fastest option
D. Following instructions blindly
✅ Answer: B

8. In the comparison of humans and animals, animals are described as:
A. Not intelligent at all
B. More intelligent than humans
C. Intelligent but limited mainly to survival needs
D. Unable to learn
✅ Answer: C

9. Dolphins are mentioned as intelligent animals because they:
A. Live underwater only
B. Are colorful
C. Adapt to the environment and share knowledge
D. Are very fast swimmers
✅ Answer: C

10. Elephants are considered intelligent mainly due to their:
A. Speed
B. Strong legs
C. Large brain, emotions, and excellent memory
D. Ability to climb trees
✅ Answer: C

11. What is intelligence best described as in the session?
A. Ability to store information

B. Ability to learn, understand, and make decisions
C. Ability to move fast
D. Ability to follow rules
✅ Answer: B

12. Which of the following is an example of human intelligence mentioned in the lesson?
A. Charging a phone
B. Solving a difficult puzzle quickly
C. Opening an app
D. Clicking photos
✅ Answer: B

13. Which of the following is an example of Artificial Intelligence?
A. Human brain
B. Animal memory
C. A machine learning from images
D. A textbook
✅ Answer: C

14. Why is Rex able to answer “sunny” or “cloudy” correctly after training?
A. He guessed the answer
B. He memorized words
C. He learned patterns from examples
D. He copied a human
✅ Answer: C

15. What is the main goal of Artificial Intelligence according to Session 1?
A. To replace teachers
B. To make machines act smart and learn like humans
C. To control animals
D. To build robots only
✅ Answer: B

SESSION 2
1. The term “AI application” is explained in this session. What does it mainly refer to?
A. Writing AI code
B. How AI is used in real life
C. How AI is invented
D. How AI is stored
✅ Answer: B

2. In the story “Zara and the Helpful AI”, the smart alarm wakes Zara up. Which AI ability does this
show?
A. Image recognition
B. Automation and assistance
C. Gaming intelligence
D. Programming
✅ Answer: B

3. The example of a refrigerator reminding about milk shows AI being used for:
A. Entertainment
B. Household assistance
C. Security systems
D. Gaming
✅ Answer: B

4. The question “Can machines think like humans?” was first asked by Alan Turing in which year?
A. 1940
B. 1950
C. 1956
D. 1960
✅ Answer: B

5. The year 1956 is important in AI history because it marks:
A. The invention of robots
B. The birth of Artificial Intelligence as a field
C. The first smartphone
D. The rise of social media
✅ Answer: B

6. The event where a computer defeated a world chess champion happened in:
A. 1980
B. 1990
C. 1997
D. 2010
✅ Answer: C

7. The period “AI enters daily life” mainly refers to which decade?
A. 1980s
B. 1990s
C. 2000s
D. Around 2010
✅ Answer: D

8. In the application “AI at Home”, voice assistants like Alexa and Siri mainly help users to:
A. Write programs
B. Answer questions and perform tasks
C. Detect faces
D. Play games only
✅ Answer: B

9. The use of AI in recommending videos on platforms like YouTube belongs to which application area?
A. AI in Travel
B. AI in Entertainment
C. AI in Health
D. AI in Security
✅ Answer: B

10. The example of Google Maps suggesting the fastest route shows AI usage in:
A. Shopping
B. Education
C. Travel and Transport
D. Gaming
✅ Answer: C

11. What does the word “application” mean in simple terms?
A. An AI model

B. A machine
C. How something is used in real life
D. A computer program only
✅ Answer: C

12. Which of the following is an AI application used in schools?
A. Manual attendance
B. AI tutors and personalized learning apps
C. Blackboard writing
D. Paper tests
✅ Answer: B

13. Which AI application helps online shoppers see products they might like?
A. Fire detection
B. Product recommendations
C. Self-driving cars
D. Speech recognition
✅ Answer: B

14. AI doctors and fitness apps belong to which domain?
A. Entertainment
B. Shopping
C. Health and Safety
D. Travel
✅ Answer: C

15. What is the main reason AI applications are becoming popular in daily life?
A. They are expensive
B. They make tasks easier, faster, and smarter
C. They replace all humans
D. They work without data
✅ Answer: B

SESSION 3
1. In PictoBlox, the component called “Stage” is used mainly to:
A. Store blocks
B. Display where sprites perform actions
C. Write scripts
D. Install extensions
✅ Answer: B

2. The term “Sprite” in PictoBlox refers to:
A. The background image
B. A tool used for drawing
C. An object or character that performs actions
D. A block category
✅ Answer: C

3. The “Stage Palette” is provided so that users can:
A. Write scripts
B. Control sprite movement
C. Change or edit the stage backdrop
D. Add sound effects
✅ Answer: C

4. The concept of “Blocks” in PictoBlox is best described as:
A. Text-based commands
B. Puzzle-like commands that snap together
C. Image files
D. Hardware components
✅ Answer: B

5. The “Block Palette” is important because it:
A. Shows sprite costumes
B. Contains categorized blocks like Motion and Control
C. Displays the stage
D. Runs the program
✅ Answer: B

6. In PictoBlox, a “Script” is defined as:
A. A single block
B. A background image
C. A sequence of blocks arranged to perform a task
D. A sound file
✅ Answer: C

7. The “Scripting Area” is the place where:
A. Sprites are selected
B. Blocks are arranged to form programs
C. Backdrops are edited
D. Extensions are installed
✅ Answer: B

8. The “Motion Palette” mainly contains blocks used to:
A. Play sounds
B. Control program flow
C. Move and rotate sprites
D. Detect sensors
✅ Answer: C

9. The “Control Palette” is used to:
A. Change sprite costumes
B. Add logic such as loops and conditions
C. Draw on the stage
D. Play music
✅ Answer: B

10. According to the session, PictoBlox is best described as:
A. A text editor
B. A spreadsheet software
C. A Scratch-based programming platform for AI projects
D. A video player
✅ Answer: C

11. Why is PictoBlox suitable for beginners?
A. It uses complex coding

B. It requires no programming knowledge
C. It uses drag-and-drop blocks
D. It works only online
✅ Answer: C

12. Which operating system installer is mentioned for PictoBlox installation?
A. Linux only
B. Windows installer
C. iOS installer
D. Chrome OS installer
✅ Answer: B

13. What file extension is used when saving PictoBlox projects?
A. .exe
B. .txt
C. .sb3
D. .jpg
✅ Answer: C

14. What happens when you click and drag a sprite on the stage?
A. The sprite gets deleted
B. The sprite moves to a new position
C. The script stops
D. The stage changes
✅ Answer: B

15. Which feature allows users to create AI and machine learning projects in PictoBlox?
A. Drawing tools
B. Animation tools
C. Artificial Intelligence extensions
D. Music editor
✅ Answer: C

SESSION 4
1. In animation creation, the block “when green flag clicked” is used. What is its main function?
A. To stop the script
B. To start the program execution
C. To repeat actions
D. To move the sprite
✅ Answer: B

2. The block “forever” is added below the start block. What does it do?
A. Runs the script only once
B. Repeats the blocks inside continuously
C. Stops the program
D. Delays the program
✅ Answer: B

3. In the walking animation, the block “move ( ) steps” is used. What effect does it create?
A. Rotates the sprite
B. Moves the sprite forward
C. Changes costume
D. Hides the sprite
✅ Answer: B

4. The block “wait ( ) seconds” is placed inside the loop. Why is it required?
A. To stop execution
B. To slow down movement and make animation smooth
C. To detect edges
D. To reset the script
✅ Answer: B

5. The block “if on edge, bounce” is used to:
A. Make the sprite disappear
B. Detect the stage edge and change direction
C. Rotate the sprite upside down
D. Stop the animation
✅ Answer: B

6. When the sprite starts rotating incorrectly, the block “set rotation style ( )” is used. Why?
A. To increase speed
B. To control how the sprite rotates
C. To hide the sprite
D. To change the backdrop
✅ Answer: B

7. Selecting “left-right” in the set rotation style block ensures that the sprite:
A. Spins fully
B. Flips only left and right
C. Moves diagonally
D. Stops moving
✅ Answer: B

8. The block “move 10 steps” is placed inside a loop. What happens because of this?
A. The sprite moves once
B. The sprite moves continuously
C. The sprite jumps randomly
D. The sprite stops
✅ Answer: B

9. In the completed animation script, the order of blocks is important because:
A. Blocks work in random order
B. Scripts execute blocks from top to bottom
C. Blocks execute from bottom to top
D. Order does not matter
✅ Answer: B

10. The block “when green flag clicked” is also called a hat block. Why?
A. It looks like a hat
B. It can be placed only at the top of a script
C. It changes costume
D. It controls motion
✅ Answer: B

11. What is animation in PictoBlox?
A. Drawing pictures

B. Making sprites move and act using scripts
C. Writing text
D. Playing videos
✅ Answer: B

12. Why does Tobi go out of the stage before adding edge detection?
A. Because the sprite is too big
B. Because movement continues without boundary control
C. Because the stage is small
D. Because rotation is wrong
✅ Answer: B

13. Which block category mainly controls looping and timing?
A. Motion
B. Looks
C. Control
D. Sound
✅ Answer: C

14. Which action completes the animation and runs the script?
A. Clicking the sprite
B. Clicking the green flag
C. Pressing the space bar
D. Saving the file
✅ Answer: B

15. What is the main learning outcome of Session 4?
A. Installing software
B. Creating AI models
C. Making a sprite walk using animation blocks
D. Recognizing faces
✅ Answer: C

SESSION 5
1. In the human vision process, the step “capture image” refers to:
A. Understanding objects
B. Collecting images using the eyes
C. Making decisions
D. Taking actions
✅ Answer: B

2. During the step “identify objects and features” in human vision, the brain mainly:
A. Stores images permanently
B. Recognizes objects along with size, color, and shape
C. Takes action immediately
D. Ignores past experience
✅ Answer: B

3. The step “extract information” in human vision involves:
A. Capturing light
B. Comparing object features with past knowledge
C. Moving the body
D. Blinking eyes
✅ Answer: B

4. In the final step “act” of human vision, a person:
A. Observes the object
B. Thinks without reacting
C. Responds based on the understood information
D. Forgets the image
✅ Answer: C

5. In computer vision, the step “acquire” is similar to which human vision step?
A. Acting
B. Extracting information
C. Capturing image
D. Identifying features
✅ Answer: C

6. During the “process” stage in computer vision, the system:
A. Takes decisions
B. Detects and lists objects in the image
C. Moves hardware
D. Stores results
✅ Answer: B

7. The “analyze” step in computer vision mainly helps the system to:
A. Capture new images
B. Classify objects and assign higher-level information
C. Delete images
D. Rotate objects
✅ Answer: B

8. In a self-driving car example, the “act” step occurs when the car:
A. Captures road images
B. Identifies objects
C. Stops after detecting a pedestrian
D. Stores image data
✅ Answer: C

9. The computer vision process is similar to human vision because both:
A. Use the same hardware
B. Follow steps of sensing, understanding, and acting
C. Work without memory
D. Ignore past knowledge
✅ Answer: B

10. In computer vision, higher-level information is mainly used to:
A. Increase image size
B. Make decisions and actions
C. Store raw images
D. Improve camera quality
✅ Answer: B

11. Computer Vision is a field of Artificial Intelligence that enables machines to:
A. Hear and speak

B. See, analyze, and understand images and videos
C. Store text files
D. Write programs
✅ Answer: B

12. Which of the following is an example of computer vision mentioned in the lesson?
A. Smart alarm
B. Self-driving car
C. Voice assistant
D. Calculator
✅ Answer: B

13. Why are cameras important in computer vision systems?
A. To play videos
B. To capture images as input data
C. To improve sound quality
D. To store results
✅ Answer: B

14. What makes computer vision systems fast and efficient?
A. Human supervision
B. Eye–brain coordination
C. High-speed processing and algorithms
D. Manual decision making
✅ Answer: C

15. What is the main learning objective of Session 5?
A. Understanding speech recognition
B. Learning how computers see and act like humans
C. Creating animations
D. Recognizing logos
✅ Answer: B

SESSION 6
1. In PictoBlox, the step “Add Extension” is used before starting AI projects. What is its purpose?
A. To save the project
B. To access AI-related blocks
C. To change the sprite
D. To edit the stage
✅ Answer: B

2. The “Artificial Intelligence Extension” allows users to create projects related to:
A. Only animations
B. Only games
C. AI features like vision, text, and speech
D. Hardware control only
✅ Answer: C

3. The step “Sign in to PictoBlox” is required because:
A. It stores files locally
B. AI blocks work only after authentication
C. It changes the interface
D. It improves animation speed
✅ Answer: B

4. In the AI Extension, the category “Computer Vision” is used mainly to:
A. Recognize sounds
B. Identify celebrities, brands, landmarks, and objects in images
C. Convert speech to text
D. Control robot motors
✅ Answer: B

5. The AI Extension feature “Face Recognition” helps in identifying:
A. Objects only
B. Text from images
C. Age, gender, and emotions from faces
D. Landmarks
✅ Answer: C

6. The feature “Optical Character Recognition” in the AI Extension is used to:
A. Detect objects
B. Read text from images
C. Identify faces
D. Generate speech
✅ Answer: B

7. The AI Extension feature “Speech Recognition” allows the system to:
A. Play sounds
B. Convert spoken words into text
C. Detect emotions
D. Recognize objects
✅ Answer: B

8. The step “Select Artificial Intelligence from the extension library” is done to:
A. Add motion blocks
B. Load AI models into PictoBlox
C. Change sprite costumes
D. Add sound effects
✅ Answer: B

9. The instruction “Open a new project” is important before loading the AI Extension because:
A. Old projects cannot be saved
B. AI blocks require a fresh scripting area
C. It resets the computer
D. It removes sprites
✅ Answer: B

10. After loading the AI Extension successfully, the user can:
A. Only draw pictures
B. Use AI blocks in the code area
C. Edit only the stage
D. Play videos
✅ Answer: B

11. Why is the AI Extension important in PictoBlox?
A. It improves graphics quality

B. It enables building AI-based projects easily
C. It replaces block coding
D. It removes sprites
✅ Answer: B

12. Which of the following is NOT a feature of the AI Extension?
A. Computer Vision
B. Face Recognition
C. Optical Character Recognition
D. Motion Control
✅ Answer: D

13. Which requirement is necessary to use AI blocks in PictoBlox?
A. Internet connection and sign-in
B. Printer connection
C. External camera only
D. USB drive
✅ Answer: A

14. Which type of projects can be created after adding the AI Extension?
A. Only drawing projects
B. Only animation projects
C. AI and machine learning projects
D. Text editing projects
✅ Answer: C

15. What is the main learning outcome of Session 6?
A. Creating walking animations
B. Installing PictoBlox
C. Understanding and using AI Extension features
D. Recognizing landmarks
✅ Answer: C

SESSION 7
1. In the landmark activity, the block “when green flag clicked” is used first. What is its purpose?
A. To analyze images
B. To start the program execution
C. To display text
D. To add extensions
✅ Answer: B

2. The step “Add the Artificial Intelligence Extension” is required before using recognition blocks
because:
A. It improves graphics
B. Recognition blocks are available only after loading the AI extension
C. It changes sprite costumes
D. It saves the project
✅ Answer: B

3. In the landmark project, the block “recognize landmark in image from backdrop” is used. What does
this block do?
A. Detects faces
B. Identifies famous places in the backdrop image
C. Counts objects
D. Reads text
✅ Answer: B

4. The block “say ( )” is added after landmark recognition. Why is this block used?
A. To save results
B. To display the recognized landmark name
C. To change the backdrop
D. To stop the script
✅ Answer: B

5. In the celebrity recognition activity, the step “upload an image on the stage” is important because:
A. AI works only with videos
B. Celebrity recognition analyzes the stage image
C. It increases animation speed
D. It hides the sprite
✅ Answer: B

6. The block “recognize celebrities in image from stage” is used mainly to:
A. Detect objects
B. Identify famous people in the image
C. Count faces
D. Detect emotions
✅ Answer: B

7. In the celebrity project, the block “recognized celebrity 1 name” returns:
A. Image resolution
B. Confidence value
C. Name of the detected celebrity
D. Number of faces
✅ Answer: C

8. The instruction “sign in to PictoBlox” is required in this session because:
A. It saves files online
B. Celebrity and landmark recognition work only after sign-in
C. It enables motion blocks
D. It improves stage quality
✅ Answer: B

9. In both landmark and celebrity projects, the say block is placed after recognition blocks because:
A. Scripts must end with say blocks
B. Recognition results must be displayed after analysis
C. Say blocks trigger AI
D. Say blocks store data
✅ Answer: B

10. The correct order of blocks in both activities is important because:
A. Blocks work randomly
B. Image analysis must happen before displaying results
C. Say blocks start the program
D. Order does not matter
✅ Answer: B

11. What is landmark recognition used for?

A. Identifying people
B. Identifying famous places from images
C. Reading text
D. Detecting emotions
✅ Answer: B

12. Which condition is necessary for accurate celebrity recognition?
A. Dark image
B. Side-facing face
C. Clear and front-facing image
D. Cartoon image
✅ Answer: C

13. Which of the following is an example of a landmark mentioned in the session?
A. Statue of Liberty
B. Taj Mahal
C. Eiffel Tower
D. Charminar
✅ Answer: B

14. Celebrity recognition is an application of which AI field?
A. Speech Recognition
B. Computer Vision
C. Text Recognition
D. Robotics
✅ Answer: B

15. What is the main learning outcome of Session 7?
A. Creating animations
B. Installing PictoBlox
C. Using AI blocks to recognize landmarks and celebrities
D. Training machine learning models
✅ Answer: C

SESSION 8
1. In the object identification project, the block “recognize ( ) in image from ( )” is used first. What is its
main purpose?
A. To draw a box
B. To analyze the image and detect objects
C. To move the sprite
D. To save the project
✅ Answer: B

2. The block “recognized ( ) count” is used in the script. What information does it provide?
A. Size of objects
B. Number of detected objects
C. Object position
D. Confidence level
✅ Answer: B

3. In the object locating process, the variable “Object” is created. Why is this variable needed?
A. To store image size
B. To loop through each detected object
C. To control sprite color
D. To store sound files
✅ Answer: B

4. The block “repeat until ( )” is used with the object count. What does this loop ensure?
A. Objects are detected only once
B. Each detected object is processed one by one
C. The program stops immediately
D. The sprite moves randomly
✅ Answer: B

5. The block “create clone of ( )” is used in the project to:
A. Delete the sprite
B. Make copies of the sprite for each object
C. Change the backdrop
D. Stop the script
✅ Answer: B

6. When drawing the bounding box, the block “recognized ( ) ( ) ( )” is used. Which information can this
block return?
A. Only object name
B. Only object color
C. X position, Y position, width, height, and confidence
D. Background details
✅ Answer: C

7. The block “set size to ( ) %” is used while drawing bounding boxes. Why?
A. To resize the stage
B. To match the box size with the detected object width
C. To hide the sprite
D. To change the object name
✅ Answer: B

8. The blocks “set x to ( )” and “set y to ( )” are important because they:
A. Move the sprite randomly
B. Position the bounding box over the detected object
C. Change the sprite direction
D. Reset the script
✅ Answer: B

9. The block “when I start as a clone” is used so that:
A. The program starts again
B. Each clone runs its own script
C. The sprite disappears
D. The stage resets
✅ Answer: B

10. The block “say ( )” is added at the end of the clone script. What does it display?
A. Image size
B. Object name and confidence
C. Camera resolution
D. Variable value
✅ Answer: B

11. What is the main goal of the “Identifying &amp; Locating Objects” activity?

A. To recognize text
B. To detect objects and show their location
C. To play sounds
D. To animate sprites
✅ Answer: B

12. What is a bounding box in object detection?
A. A decorative frame
B. A box drawn around detected objects
C. A background image
D. A sound effect
✅ Answer: B

13. Why are clones used instead of a single sprite?
A. To increase speed
B. To represent multiple detected objects at the same time
C. To save memory
D. To avoid loops
✅ Answer: B

14. Which parameter indicates how sure the AI is about the detected object?
A. Width
B. Height
C. Confidence
D. Position
✅ Answer: C

15. Which AI field is used in Session 8 to identify and locate objects?
A. Speech Recognition
B. Text Recognition
C. Computer Vision
D. Robotics
✅ Answer: C

SESSION 9

1. In the Logo Quiz project, the block “when green flag clicked” is used. What is its purpose?
A. To display logos
B. To start the quiz program
C. To change costumes
D. To end the game
✅ Answer: B

2. The step “Add the Artificial Intelligence Extension” is necessary in this project because:
A. It improves sprite animation
B. Logo recognition works only with AI blocks
C. It adds sound effects
D. It stores variables
✅ Answer: B

3. In the Logo Quiz, the variable “Score” is created. What is its role?
A. To store logo images
B. To count correct answers
C. To change backgrounds
D. To track hints
✅ Answer: B

4. The variable “Hints” is used in the project mainly to:
A. Store user names
B. Limit the number of hints available
C. Increase the score
D. Control sprite movement
✅ Answer: B

5. The variable “Hint letter” helps the program to:
A. Count the number of logos
B. Display letters of the brand name one by one
C. Change sprite costumes
D. Reset the game
✅ Answer: B

6. The block “recognize image features in image from stage” is used to:
A. Detect faces

B. Recognize brand logos using AI
C. Play sounds
D. Draw shapes
✅ Answer: B

7. In checking the user’s answer, the block “recognized ( ) name” is compared with which input?
A. Sprite name
B. User’s typed answer
C. Image name
D. Background name
✅ Answer: B

8. The block “ask ( ) and wait” is used in the quiz to:
A. Display the score
B. Get the user’s answer
C. Change logo costume
D. End the game
✅ Answer: B

9. The broadcast message “change logo” is used to:
A. End the quiz
B. Move to the next logo
C. Increase score
D. Stop hints
✅ Answer: B

10. When the number of hints becomes less than zero, the block “stop all” is executed. What does this
indicate?
A. The user won the game
B. The quiz ends due to no hints left
C. The score resets
D. A new logo appears
✅ Answer: B

11. What is the main objective of the Logo Quiz project?
A. To draw logos
B. To create a quiz that identifies brand logos using AI

C. To play music
D. To detect faces
✅ Answer: B

12. Which AI capability is mainly used in the Logo Quiz project?
A. Speech Recognition
B. Text Recognition
C. Brand Recognition (Computer Vision)
D. Face Recognition
✅ Answer: C

13. Why are multiple logo images added as costumes to the same sprite?
A. To increase memory
B. To change logos without adding new sprites
C. To improve AI accuracy
D. To reduce coding
✅ Answer: B

14. What happens when the user gives a correct answer?
A. The game ends
B. The score increases and the next logo appears
C. A hint is given
D. The program stops
✅ Answer: B

15. What message is displayed when the game ends due to no hints remaining?
A. “Correct Answer!”
B. “Next Logo”
C. “Game Over!”
D. “Try Again”
✅ Answer: C

SESSION 11
1. In PictoBlox, the block “analyse image from ( )” is used. What is the main purpose of this block?

A. To turn the camera ON
B. To analyze an image and extract face information
C. To draw landmarks automatically
D. To store images online
✅ Answer: B

2. The block “turn ( ) video on stage with ( ) % transparency” is mainly used to:
A. Detect expressions
B. Control how the camera feed appears on the stage
C. Count the number of faces
D. Export face data
✅ Answer: B

3. After analyzing an image, the block “get # faces” is used. What does it report?
A. Total landmarks
B. Number of detected faces
C. Face width
D. Face expressions
✅ Answer: B

4. The block “get expression of face ( )” returns which type of information?
A. Face position
B. Recognized facial emotion
C. Camera state
D. Landmark number
✅ Answer: B

5. The block “get ( ) of face ( )” can be used to obtain which of the following details?
A. Only facial emotion
B. X position, Y position, width, and height of the face
C. Number of faces
D. Camera transparency
✅ Answer: B

6. What is face detection?
A. Identifying a person’s name
B. Locating human faces in an image

C. Recognizing emotions
D. Tracking body movement
✅ Answer: B

7. Why is face detection considered a complex task?
A. Faces are always the same
B. Images are always clear
C. Human faces vary in pose, expression, lighting, and orientation
D. Cameras cannot capture faces
✅ Answer: C

8. Face detection is an important part of which technology?
A. Game design
B. Face recognition
C. Audio processing
D. Text recognition
✅ Answer: B

9. Which of the following is a face detection method discussed in the lesson?
A. Rule-free detection
B. Knowledge-based detection
C. Random detection
D. Color-based detection
✅ Answer: B

10. Knowledge-based face detection mainly depends on:
A. Deep learning models
B. Random sampling
C. Rules based on human knowledge
D. Audio signals
✅ Answer: C

11. Which facial features are commonly used in knowledge-based detection?
A. Hair and ears
B. Eyes, nose, and mouth
C. Neck and shoulders
D. Hands and arms

✅ Answer: B

12. What is a major drawback of knowledge-based detection?
A. It is too accurate
B. Rules may produce false positives or miss faces
C. It needs a webcam
D. It works only on videos
✅ Answer: B

13. Feature-based detection mainly uses what to detect faces?
A. Colors
B. Face landmarks
C. Voice patterns
D. Text labels
✅ Answer: B

14. How many predefined facial landmark points are mentioned in the lesson?
A. 20
B. 32
C. 50
D. 68
✅ Answer: D

15. Which is a limitation of feature-based face detection?
A. Cannot detect expressions
B. Difficult to locate features in noisy or complex backgrounds
C. Cannot detect multiple faces
D. Requires manual rules
✅ Answer: B

SESSION 12
1. In the Expression Detector project, the block “when green flag clicked” is used. What is its main role?
A. Detect facial expressions

B. Start and initialize the entire program
C. Move the sprite to the face
D. Display the emotion
✅ Answer: B

2. The block “turn video ON (0% transparency)” is added at the beginning of the script. Why is
transparency set to 0%?
A. To hide the camera feed
B. To reduce memory usage
C. To clearly display live video for detection
D. To stop background animation
✅ Answer: C

3. The block “forever” is used in the Expression Detector. What happens if this block is removed?
A. The program will not start
B. Face detection will occur only once
C. The camera will not turn ON
D. The sprite will disappear
✅ Answer: B

4. The block “analyse image from stage” is responsible for which action?
A. Displaying emotions on screen
B. Turning on the webcam
C. Scanning the live camera image to find faces
D. Moving the sprite
✅ Answer: C

5. When the block “get X position of face” is used, what information does it provide?
A. Vertical location of the face
B. Horizontal location of the face
C. Facial emotion
D. Face size
✅ Answer: B

6. The block “get Y position of face” helps mainly in tracking which movement?
A. Left and right
B. Face expression change

C. Up and down
D. Zoom in and out
✅ Answer: C

7. The block “go to x: ( ) y: ( )” is used after getting face coordinates. What is its purpose?
A. To display text
B. To analyze expressions
C. To move the sprite to the detected face
D. To activate AI
✅ Answer: C

8. The block “get expression of face” returns which type of output?
A. Face width and height
B. Face position values
C. Detected facial emotion
D. Camera resolution
✅ Answer: C

9. In the project, the block “say (expression) for 2 seconds” is used. What does it do?
A. Saves the emotion data
B. Speaks through microphone
C. Shows the detected emotion as text
D. Changes sprite costume
✅ Answer: C

10. Why is the block “analyse image from stage” placed inside a forever loop?
A. To start the camera repeatedly
B. To analyze expressions continuously in real time
C. To stop the program automatically
D. To slow down execution
✅ Answer: B

11. An Expression Detector is an example of which type of system?
A. Manual system
B. Rule-based system
C. Artificial Intelligence–based system
D. Animation-only system

✅ Answer: C

12. Which device is essential for capturing facial expressions in this project?
A. Keyboard
B. Mouse
C. Webcam
D. Speaker
✅ Answer: C

13. Which of the following emotions can be detected in Session 12?
A. Sleeping
B. Running
C. Happy
D. Reading
✅ Answer: C

14. What is the main goal of Session 12?
A. To design games
B. To recognize facial expressions using AI
C. To draw sprites
D. To learn loops only
✅ Answer: B

15. How does the Expression Detector identify emotions?
A. By user clicking buttons
B. By keyboard input
C. By analyzing live camera images using AI
D. By pre-written text
✅ Answer: C

SESSION 13

1. In a face recognition system, the step “capturing” is performed first. What is the main purpose of this
step?
A. To compare faces with stored records
B. To extract facial features
C. To obtain facial images using a camera
D. To generate alerts
✅ Answer: C

2. The step called “extracting” is crucial in facial recognition. What happens during this step?
A. The face image is deleted
B. Facial features and landmarks are identified
C. The face is matched with users
D. Alerts are generated
✅ Answer: B

3. In the face recognition workflow, the step “comparing” helps the system to:
A. Capture new images
B. Improve camera quality
C. Match facial data with stored database records
D. Store raw images only
✅ Answer: C

4. The step known as “matching” allows the system to:
A. Draw face boundaries
B. Decide whether a face is recognized or not
C. Capture multiple images
D. Improve image brightness
✅ Answer: B

5. The step “database storage” is important because it:
A. Displays the face on screen
B. Saves facial patterns for future recognition
C. Removes duplicate faces
D. Controls camera movement
✅ Answer: B

6. What does a face recognition system mainly analyze to identify a person?

A. Hair color
B. Facial landmarks
C. Body posture
D. Voice pattern
✅ Answer: B

7. Which information is obtained when a face is analyzed?
A. Only face color
B. Size, position, and geometrical properties
C. Background details
D. Camera resolution
✅ Answer: B

8. Why are facial patterns stored in a database?
A. To decorate images
B. To improve camera speed
C. To compare with future scanned faces
D. To reduce memory usage
✅ Answer: C

9. Face recognition is widely used in surveillance systems mainly to:
A. Play videos
B. Track and identify people
C. Improve lighting
D. Store photos
✅ Answer: B

10. Which real-world application uses face recognition for security access?
A. Calculator
B. Face unlock in smartphones
C. Music players
D. Alarm clocks
✅ Answer: B

11. Why is face recognition effective in mobile phone cameras?
A. It edits photos automatically
B. It identifies multiple faces in a single frame

C. It increases image size
D. It removes noise
✅ Answer: B

12. Social media platforms use face recognition mainly to:
A. Increase storage
B. Detect and recognize faces in images
C. Improve internet speed
D. Change image colors
✅ Answer: B

13. What happens if a scanned face matches the stored data?
A. The system shuts down
B. The image is deleted
C. The system alerts that a match is found
D. The camera turns off
✅ Answer: C

14. Which type of technology does face recognition belong to?
A. Manual computing
B. Artificial Intelligence
C. Spreadsheet processing
D. Text editing
✅ Answer: B

15. Which Python library is commonly used for face recognition and computer vision tasks?
A. NumPy
B. OpenCV
C. Matplotlib
D. Pandas
✅ Answer: B

SESSION 14
1. In an OCR project, the step “apply filters” is performed before recognizing characters. Why is this step
important?
A. To store text in a database
B. To make characters stand out from the background
C. To merge characters into sentences
D. To convert text into audio
✅ Answer: B

2. During OCR processing, the step “apply contour detection” is mainly used to:
A. Blur the image
B. Detect and separate individual characters
C. Improve font style
D. Translate text into another language
✅ Answer: B

3. In OCR, the step “image classification” helps the system to:
A. Capture the image
B. Identify each character correctly
C. Remove background noise
D. Resize the image
✅ Answer: B

4. The step “merge characters” is required in OCR to:
A. Detect contours
B. Store images
C. Form words and sentences from characters
D. Improve camera resolution
✅ Answer: C

5. In PictoBlox, the block “printed text result” is used after text recognition. What does this block return?
A. Image pixels
B. Character outlines
C. Recognized text in string format
D. Camera feed
✅ Answer: C

6. What does OCR stand for?
A. Optical Code Reader
B. Optical Character Recognition
C. Online Character Recognition
D. Optical Content Reader
✅ Answer: B

7. OCR technology is mainly used to:
A. Edit videos
B. Recognize text inside images
C. Detect faces
D. Play audio files
✅ Answer: B

8. OCR technology became popular during the early 1990s mainly to:
A. Improve gaming graphics
B. Digitize historical newspapers
C. Build mobile applications
D. Detect faces
✅ Answer: B

9. Which type of text can OCR recognize?
A. Only printed text
B. Only handwritten text
C. Printed, handwritten, and typed text
D. Only cursive text
✅ Answer: C

10. Which of the following is a real-world application of OCR?
A. Face unlock
B. License plate recognition
C. Voice assistant
D. Gesture control
✅ Answer: B

11. OCR is commonly used in postal systems to:
A. Track parcels

B. Detect addresses and pincodes from letters
C. Improve stamp quality
D. Print barcodes
✅ Answer: B

12. Which input method can be used to provide images for OCR in PictoBlox?
A. Keyboard input only
B. Mouse clicks
C. Camera feed, URL, or stage image
D. Speaker input
✅ Answer: C

13. Which two types of text can be recognized using OCR blocks in PictoBlox?
A. Large and small text
B. Colored and black text
C. Printed and handwritten text
D. English and regional text
✅ Answer: C

14. Which factor can reduce the accuracy of OCR results?
A. Clear images
B. High contrast text
C. Blurry images
D. Printed text
✅ Answer: C

15. Which of the following is NOT a limitation of OCR?
A. Complex background
B. Artistic fonts
C. Clear and high-quality images
D. Small text size
✅ Answer: C

SESSION 15
1. In the Postman activity, the block “recognize handwritten text in camera image after 2 seconds” is
used. What is its main purpose?
A. To move the gift randomly
B. To detect written text using the camera
C. To store text in a database
D. To resize the image
✅ Answer: B

2. The block “handwritten text result” is used inside a condition. What does this block provide?
A. Image pixels
B. Camera resolution
C. Recognized handwritten text as output
D. Sprite position
✅ Answer: C

3. In the script, the block “if ( ) else” is used after recognizing text. Why is this block required?
A. To repeat the program forever
B. To compare recognized text and make decisions
C. To turn the camera ON
D. To delete sprites
✅ Answer: B

4. The block “glide ( ) secs to ( )” is used after checking the name. What action does it perform?
A. Displays a message
B. Moves the gift smoothly to the correct person
C. Stops the program
D. Captures an image
✅ Answer: B

5. When the block “say ‘Try Again!’ for 2 seconds” is executed, what does it indicate?
A. The gift is delivered successfully
B. The camera is not working
C. The recognized name did not match any receiver
D. The program has ended
✅ Answer: C

6. What is the main goal of the Postman activity?
A. To recognize faces
B. To deliver gifts to the correct person using OCR
C. To animate sprites
D. To play sounds
✅ Answer: B

7. Which technology is used to read the name written on the gift?
A. Face recognition
B. Voice recognition
C. Optical Character Recognition (OCR)
D. Object detection
✅ Answer: C

8. Which sprites are required to be added for this activity?
A. Tobi, Gift, Camera
B. John, Hazel, Gift
C. John, Camera, Stage
D. Hazel, Background, Gift
✅ Answer: B

9. Why is the default sprite Tobi removed in this activity?
A. To improve OCR accuracy
B. Because it is not needed for the gift delivery system
C. To reduce program size
D. To enable camera access
✅ Answer: B

10. Why is handwritten text selected instead of printed text in this project?
A. The names are typed
B. The names are written on paper
C. Printed text is not supported
D. Handwritten text is faster
✅ Answer: B

11. Why is text comparison case-sensitive in this activity?
A. OCR blocks ignore uppercase letters

B. The program treats “John” and “JOHN” as different values
C. Cameras only detect lowercase letters
D. Case sensitivity improves animation
✅ Answer: B

12. What happens when the recognized name matches “John”?
A. The gift disappears
B. The gift glides towards John
C. The program stops
D. Hazel receives the gift
✅ Answer: B

13. What happens if the recognized name matches “Hazel”?
A. The gift moves to Hazel
B. The gift returns to start
C. A warning message appears
D. The camera turns off
✅ Answer: A

14. Which input device is essential for detecting the written name in this project?
A. Keyboard
B. Mouse
C. Camera
D. Speaker
✅ Answer: C

15. Which programming concept is mainly used to decide the gift receiver?
A. Looping
B. Conditional checking
C. Broadcasting
D. Cloning
✅ Answer: B

SESSION 16
1. In PictoBlox, the block “recognize speech for ( ) s in ( )” is used. What is its main function?
A. To play recorded audio
B. To record speech and convert it into text
C. To remove background images
D. To translate text into another language
✅ Answer: B

2. The block “speech recognition result” is mainly used to:
A. Store audio files
B. Display the last recognized speech as text
C. Improve microphone quality
D. Translate spoken words
✅ Answer: B

3. The block “set noise removal threshold to ( ) %” helps in:
A. Increasing volume
B. Filtering background noise from speech input
C. Changing language
D. Recording longer audio
✅ Answer: B

4. When the block “say (speech recognition result) for ( ) seconds” is used, what does it do?
A. Records speech again
B. Displays the recognized speech as text output
C. Converts text into audio
D. Stops the program
✅ Answer: B

5. The block “recognize speech for ( ) s in English” requires which hardware component to work
properly?
A. Camera
B. Speaker
C. Microphone
D. Monitor
✅ Answer: C

6. What is speech recognition?
A. The ability of a machine to recognize images
B. The ability of a machine to identify spoken words and convert them into text
C. The ability to store sound files
D. The ability to translate languages
✅ Answer: B

7. How do humans initially learn a language according to the lesson?
A. By reading text
B. By writing letters
C. By listening to sounds and words repeatedly
D. By memorizing grammar rules
✅ Answer: C

8. Which is the first step in how speech recognition works?
A. Identifying keywords
B. Recording the audio input
C. Translating text
D. Speaking the response
✅ Answer: B

9. After recording speech, the system breaks audio into which basic components?
A. Words and sentences
B. Images and sounds
C. Consonants and vowels
D. Letters and symbols
✅ Answer: C

10. Why does the system use a word database in speech recognition?
A. To store images
B. To match sounds and identify correct words
C. To improve camera quality
D. To reduce memory usage
✅ Answer: B

11. Which technology does Alexa use to understand spoken commands?
A. Image processing

B. Natural Language Processing
C. Face recognition
D. Optical Character Recognition
✅ Answer: B

12. When Alexa hears keywords like “weather,” what action does it perform?
A. Turns off the device
B. Opens the weather-related function
C. Records speech again
D. Ignores the command
✅ Answer: B

13. Why is speech recognition considered complex?
A. It requires cameras
B. It involves many mathematical equations and sound analysis
C. It only works online
D. It needs large screens
✅ Answer: B

14. Which extension must be added in PictoBlox to use speech recognition features?
A. Face Detection
B. Text Recognition
C. Speech Recognition
D. Object Detection
✅ Answer: C

15. What happens after speech is successfully converted into text?
A. The audio is deleted immediately
B. The text can be used for further actions in the program
C. The microphone stops working
D. The program ends automatically
✅ Answer: B

SESSION 17
1. In this project, the block “recognize speech for ( ) s in English” is used at the beginning of the script.
What is its main purpose?
A. To play background music
B. To record voice input and convert it into text
C. To translate text into speech
D. To store audio files
✅ Answer: B

2. The block “speech recognition result” is used inside a condition. What does this block return?
A. The recorded audio file
B. The detected text from the spoken command
C. The speaker volume
D. The microphone status
✅ Answer: B

3. In the script, the block “( ) contains ( ) ?” is used with the speech recognition result. Why is this block
required?
A. To compare numbers
B. To check whether a keyword exists in the spoken command
C. To play sounds automatically
D. To stop speech recognition
✅ Answer: B

4. The block “speak ‘Playing Mario Song!’” is added before playing the sound. What is its role?
A. To display text on screen
B. To give voice feedback to the user
C. To record audio
D. To change background
✅ Answer: B

5. When the block “play sound ( ) until done” is used, what does it ensure?
A. The sound plays partially
B. The sound plays repeatedly
C. The entire sound plays before moving to the next block
D. The sound plays silently
✅ Answer: C

6. What is the main objective of making a personal assistant in this project?
A. To recognize faces
B. To respond to voice commands and perform actions
C. To detect text from images
D. To control sprites using mouse
✅ Answer: B

7. Which two theme songs are used in this project?
A. Batman and Superman
B. Mario and Spider-Man
C. Avengers and Iron Man
D. Pokemon and Naruto
✅ Answer: B

8. Why are sound files added in the Sounds tab at the beginning?
A. To decorate the stage
B. To allow the program to play songs based on commands
C. To improve speech recognition
D. To reduce background noise
✅ Answer: B

9. Why is the default “Grunt” sound deleted from the library?
A. It affects microphone input
B. It is not required for this project
C. It reduces OCR accuracy
D. It slows down the program
✅ Answer: B

10. Which extension is added to make the assistant speak responses?
A. Speech Recognition
B. Text Recognition
C. Text to Speech
D. Face Detection
✅ Answer: C

11. What happens when the spoken command contains the word “mario”?

A. Spider-Man song plays
B. The program stops
C. Mario theme song is played
D. An error message is shown
✅ Answer: C

12. What happens when the spoken command contains the word “spiderman”?
A. Mario song plays
B. The assistant ignores the command
C. Spider-Man theme song is played
D. The program restarts
✅ Answer: C

13. What message is given when the assistant cannot understand the command?
A. “Please repeat”
B. “Try Again”
C. “Sorry, I am unable to understand the command”
D. “Command accepted”
✅ Answer: C

14. Which device component is essential for recognizing voice commands?
A. Camera
B. Speaker
C. Microphone
D. Monitor
✅ Answer: C

15. Which programming concept is mainly used to decide which song to play?
A. Looping
B. Conditional checking
C. Variables
D. Broadcasting
✅ Answer: B

SESSION 18

1. In the Machine Learning model, the step “Input” is the first stage. What does this step mainly involve?
A. Making decisions
B. Providing raw data such as images or sounds to the model
C. Improving accuracy
D. Deploying the model
✅ Answer: B

2. During the “Model” stage of a Machine Learning system, what happens?
A. Data is collected
B. Output is displayed
C. Algorithms process input data to extract meaningful patterns
D. The model is deleted
✅ Answer: C

3. In the “Output” stage of a Machine Learning model, the system mainly:
A. Collects training data
B. Stores images
C. Makes decisions based on processed information
D. Records sound
✅ Answer: C

4. In the Machine Learning life cycle, the step “Explore and Acquire Training Data” is important because:
A. It removes errors
B. The model needs examples to learn patterns
C. It deploys the model
D. It tests the final output
✅ Answer: B

5. The step “Model Training” focuses on which activity?
A. Displaying results
B. Teaching the model using training data and reducing errors
C. Capturing images
D. Labeling the output manually
✅ Answer: B

6. Machine Learning is a subset of which broader field?
A. Robotics

B. Artificial Intelligence
C. Computer Graphics
D. Cyber Security
✅ Answer: B

7. Which statement best describes Machine Learning?
A. Machines follow fixed rules only
B. Machines learn and improve automatically without human intervention
C. Machines store data only
D. Machines perform calculations manually
✅ Answer: B

8. Which of the following is an example of a Machine Learning application?
A. Text editor
B. Calculator
C. Animal classifier
D. Paint tool
✅ Answer: C

9. Humans sense the environment using how many senses?
A. Three
B. Four
C. Five
D. Six
✅ Answer: C

10. Which sense is NOT part of the human learning process?
A. Vision
B. Touch
C. Hearing
D. Calculation
✅ Answer: D

11. What happens during the “Analyze information” step in human learning?
A. Information is ignored
B. Objects are identified using previous knowledge
C. Actions are performed

D. Knowledge is deleted
✅ Answer: B

12. In the “Decide &amp; Act” step, humans:
A. Sense new data
B. Store memories
C. Take actions based on understanding
D. Forget information
✅ Answer: C

13. Why is training data important in Machine Learning?
A. To decorate the interface
B. To help the model learn patterns and make predictions
C. To reduce file size
D. To deploy the model
✅ Answer: B

14. Which type of data is used to train an image classification model for cats and dogs?
A. Audio clips
B. Text files
C. Images of cats and dogs
D. Video games
✅ Answer: C

15. What is the main purpose of deploying a Machine Learning model?
A. To train it again
B. To use it for making predictions on new data
C. To collect raw data
D. To delete training data
✅ Answer: B

Session 19

1. In the ML Environment workflow, the option “Create New Project” is used. What is its main purpose?
A. To upload images directly
B. To start a fresh machine learning project
C. To train an existing model
D. To export a trained model
✅ Answer: B

2. While creating a project, the option “Image Classifier” is selected. What does this choice indicate?
A. The model will recognize sounds
B. The model will classify images into categories
C. The model will detect text
D. The model will analyze numbers
✅ Answer: B

3. In the ML project screen, the concept of “Class” is used. What does a class represent?
A. A training button
B. A category in which similar images are grouped
C. A testing image
D. A prediction result
✅ Answer: B

4. The button “Train Model” is clicked after loading image samples. What happens when this button is
used?
A. Images are deleted
B. The system starts learning patterns from the data
C. The model is exported
D. Testing begins automatically
✅ Answer: B

5. In advanced training settings, the parameter “Epoch” is adjusted. What does this parameter control?
A. Image resolution
B. Number of times the algorithm goes through the training data
C. Number of classes
D. Camera speed
✅ Answer: B

6. What is the ML Environment in PictoBlox mainly used for?

A. Writing text programs
B. Creating machine learning models easily
C. Designing animations
D. Editing images
✅ Answer: B

7. Why is the ML Environment suitable for beginners?
A. It uses complex coding
B. It requires no coding or very little coding
C. It works only with Python
D. It supports games only
✅ Answer: B

8. Which of the following models is used to classify images from files or webcam?
A. Audio model
B. Image model
C. Text model
D. Number model
✅ Answer: B

9. Which two folders are included in the training data for the Cat vs Dog project?
A. Animals and Pets
B. Images and Videos
C. Cats and Dogs
D. Training and Output
✅ Answer: C

10. How many images are initially provided for each class in the training data?
A. 5
B. 10
C. 15
D. 20
✅ Answer: B

11. What is the minimum number of samples required for each class to train the model properly?
A. 10
B. 15

C. 20
D. 25
✅ Answer: C

12. Which option allows images to be added directly from a camera?
A. Upload
B. Webcam
C. Export
D. Preview
✅ Answer: B

13. Which dataset is used to check the performance of the trained model?
A. Training data
B. Testing data
C. Random data
D. Backup data
✅ Answer: B

14. After training is complete, which message confirms successful training?
A. Model Ready
B. Training Started
C. Training Completed
D. Upload Finished
✅ Answer: C

15. Why is the Export Model option used?
A. To retrain the model
B. To delete the project
C. To use the trained model inside PictoBlox
D. To add more images
✅ Answer: C

Session 21

1. In the Cat vs Dog project, the block “analyse image from backdrop” is used. What is its main purpose?
A. To change the stage background
B. To classify the image using the trained model
C. To train the model again
D. To reset the sprite
✅ Answer: B

2. The block “is identified class ( ) ?” is used inside a condition. What does this block check?
A. Whether the image is clear
B. Whether the predicted class matches the given class
C. Whether the camera is ON
D. Whether the score is updated
✅ Answer: B

3. The block “get confidence of class ( )” is mainly used to find:
A. The size of the image
B. How sure the model is about its prediction
C. The number of images used for training
D. The class name
✅ Answer: B

4. In the script, the block “say ( ) for 2 seconds” is used after classification. What does it do?
A. Plays a sound
B. Displays the predicted result
C. Trains the model
D. Stops the program
✅ Answer: B

5. The block “when green flag clicked” is used at the beginning of the script to:
A. End the project
B. Start the image classification process
C. Export the model
D. Switch costumes
✅ Answer: B

6. What is the main objective of the Cat vs Dog Image Classifier project?
A. To animate sprites

B. To classify images into cat or dog
C. To recognize speech
D. To detect text
✅ Answer: B

7. Which type of machine learning model is used in this session?
A. Text classifier
B. Image classifier
C. Audio classifier
D. Pose classifier
✅ Answer: B

8. Which input source is commonly used to test the Cat vs Dog classifier?
A. Keyboard
B. Microphone
C. Image from file or webcam
D. Speaker
✅ Answer: C

9. What does the confidence value represent in image classification?
A. Image brightness
B. Prediction certainty
C. File size
D. Camera quality
✅ Answer: B

10. Which factor most improves the accuracy of the Cat vs Dog model?
A. Sprite size
B. High-quality and varied training images
C. Background color
D. Sound effects
✅ Answer: B

11. How many classes are used in the Cat vs Dog classifier?
A. One
B. Two
C. Three

D. Four
✅ Answer: B

12. Which output does the classifier provide after analysis?
A. Image resolution
B. Class name with confidence
C. Camera feed
D. Training data
✅ Answer: B

13. Machine Learning models learn best when training data is:
A. Random and unclear
B. Small in quantity
C. Clear, labelled, and diverse
D. Unlabelled
✅ Answer: C

14. The Cat vs Dog project is an example of which ML task?
A. Regression
B. Classification
C. Clustering
D. Translation
✅ Answer: B

15. Why is testing the model with new images important?
A. To retrain the model
B. To check how well the model performs on unseen data
C. To increase storage
D. To stop the program
✅ Answer: B

Session 22

1. In the Rock Paper Scissors training activity, the step “Create New Project” is used first. What is its main
purpose?
A. To test the model
B. To start a fresh machine learning project
C. To export the model
D. To open an existing project
✅ Answer: B

2. While creating the project, the option “Image Classifier” is selected. What does this indicate?
A. The model will recognize sounds
B. The model will classify images
C. The model will recognize text
D. The model will detect poses
✅ Answer: B

3. In this session, the step “Add Class” is used multiple times. Why is this step important?
A. To increase training speed
B. To define Rock, Paper, and Scissors categories
C. To store output results
D. To reset the project
✅ Answer: B

4. The button “Train Model” is clicked after collecting samples. What happens when this button is used?
A. Images are deleted
B. The model learns patterns from the training data
C. The camera turns off
D. Testing begins automatically
✅ Answer: B

5. In advanced settings, the parameter “Epoch” is adjusted. What does this parameter control?
A. Number of classes
B. Number of training cycles through the dataset
C. Image resolution
D. Camera speed
✅ Answer: B

6. What is the main objective of Session 22?

A. To animate sprites
B. To train a model to recognize Rock, Paper, and Scissors
C. To recognize speech
D. To detect text
✅ Answer: B

7. How many classes are created in the Rock Paper Scissors training project?
A. One
B. Two
C. Three
D. Four
✅ Answer: C

8. Why should a large number of images be collected for each class?
A. To increase storage
B. To improve the accuracy of the model
C. To slow down training
D. To reduce testing time
✅ Answer: B

9. Which input device is mainly used to collect training samples in this session?
A. Keyboard
B. Mouse
C. Webcam
D. Speaker
✅ Answer: C

10. Training images for each class should ideally be:
A. Identical
B. Clear and taken from different angles
C. Blurry
D. Randomly mixed
✅ Answer: B

11. What happens if very few samples are used for training?
A. The model becomes faster
B. The model accuracy decreases

C. The model stops working
D. The model becomes perfect
✅ Answer: B

12. Which concept allows the model to learn from examples instead of fixed rules?
A. Automation
B. Machine Learning
C. Animation
D. Programming
✅ Answer: B

13. The Rock Paper Scissors training project is an example of which ML task?
A. Regression
B. Classification
C. Translation
D. Clustering
✅ Answer: B

14. When should the model be trained again?
A. After exporting the model
B. After adding or changing training data
C. Before creating classes
D. After testing only
✅ Answer: B

15. What is the final output after successful training in Session 22?
A. Sound output
B. Trained image classification model
C. Text file
D. Animation
✅ Answer: B

SESSION 23
1. In the Rock Paper Scissors game, the block “open recognition window” is used. What is its main
purpose?
A. To hide the stage
B. To show the camera feed and predicted class
C. To train the model
D. To reset variables
✅ Answer: B

2. The block “set AI move to random” is used in the script. Why is this block required?
A. To copy the player’s move
B. To randomly select the computer’s move
C. To increase score
D. To stop the game
✅ Answer: B

3. In the game logic, the block “if ( ) else” is used repeatedly. What is its main role?
A. To repeat the game
B. To make decisions based on conditions
C. To display images
D. To collect training data
✅ Answer: B

4. The block “change score by ( )” is used after comparing moves. What does this block do?
A. Resets the score
B. Updates the player or AI score
C. Displays the score
D. Ends the game
✅ Answer: B

5. The block “broadcast ( )” is used in the project to:
A. Stop the program
B. Communicate game events between sprites
C. Increase animation speed
D. Save results
✅ Answer: B

6. What is the main objective of Session 23?
A. Training the model
B. Building game logic using AI predictions
C. Recognizing text
D. Creating animations
✅ Answer: B

7. How does the AI decide its move in this session?
A. By copying the user
B. By fixed rules
C. By random selection
D. By highest confidence
✅ Answer: C

8. Which programming concept is mainly used to decide the winner?
A. Looping
B. Variables
C. Conditional statements
D. Cloning
✅ Answer: C

9. Which variable is used to store the AI’s selected move?
A. PlayerMove
B. AIMove
C. Score
D. Result
✅ Answer: B

10. What happens when both the player and AI choose the same option?
A. Player wins
B. AI wins
C. Game stops
D. It is a draw
✅ Answer: D

11. Why is a forever loop used in the game script?
A. To train the model

B. To detect player moves continuously
C. To stop the program
D. To reset scores
✅ Answer: B

12. Which input is used to detect the player’s move?
A. Keyboard
B. Mouse
C. Camera
D. Speaker
✅ Answer: C

13. How is fairness maintained in the Rock Paper Scissors game?
A. Player always wins
B. AI always wins
C. AI move is randomly generated
D. Fixed outcomes
✅ Answer: C

14. Which concept allows communication between different sprites?
A. Variables
B. Broadcasting
C. Cloning
D. Loops
✅ Answer: B

15. What happens when the score reaches the winning limit?
A. The model retrains
B. The game ends
C. The camera turns off
D. The score resets
✅ Answer: B

Session 24
1. In the winner-decision logic, the block “if Player Move = AI Move” is used. What does this condition
indicate?
A. Player wins
B. AI wins
C. Game stops
D. The round is a draw
✅ Answer: D

2. The block “set Result to ( )” is used after comparing moves. What is its purpose?
A. To increase score
B. To store the outcome of the round
C. To change sprite costume
D. To restart the game
✅ Answer: B

3. In the logic script, the block “say Result for 2 seconds” is used to:
A. Play a sound
B. Display the winner or draw message
C. Train the model
D. End the program
✅ Answer: B

4. The block “repeat until ( )” is used with the winning score condition. Why is it required?
A. To repeat training
B. To continue rounds until a player reaches the target score
C. To reset variables
D. To display the stage
✅ Answer: B

5. The block “stop all” is executed at the end of the game. What does this block do?
A. Stops only one script
B. Pauses the game temporarily
C. Ends all running scripts and stops the game
D. Resets the score
✅ Answer: C

6. What is the main objective of Session 24?
A. Training the ML model
B. Designing sprites
C. Implementing winner and draw logic
D. Recognizing text
✅ Answer: C

7. When does the player win a round?
A. When AI chooses randomly
B. When Player Move beats AI Move
C. When both choose the same move
D. When score resets
✅ Answer: B

8. Which move defeats “Rock” in the game?
A. Rock
B. Paper
C. Scissors
D. None
✅ Answer: B

9. Which move defeats “Scissors”?
A. Paper
B. Rock
C. Scissors
D. None
✅ Answer: B

10. A round is declared a draw when:
A. Player wins
B. AI wins
C. Both player and AI choose the same move
D. Score reaches zero
✅ Answer: C

11. Why are conditional statements important in this session?
A. To store images

B. To compare moves and decide outcomes
C. To play sounds
D. To move sprites
✅ Answer: B

12. Which variable stores the outcome of each round?
A. Score
B. Result
C. AIMove
D. PlayerMove
✅ Answer: B

13. How is fairness ensured in the Rock Paper Scissors game?
A. Player always starts
B. AI uses random selection
C. Fixed outcomes
D. Same score for both
✅ Answer: B

14. What happens after a winner is declared for a round?
A. The model retrains
B. The score is updated
C. The game ends immediately
D. The camera turns off
✅ Answer: B

15. When does the entire game end?
A. After one round
B. When either player or AI reaches the winning score
C. When the camera turns off
D. When the model retrains
✅ Answer: B

Session 25
1. In model improvement, the step “Add more training samples” is used. What is its main purpose?
A. To reduce file size
B. To improve model accuracy
C. To delete incorrect data
D. To stop training
✅ Answer: B

2. The step “Train Model” is repeated after adding new data. Why is retraining necessary?
A. To increase camera speed
B. To allow the model to learn from the updated dataset
C. To reset the project
D. To export the model
✅ Answer: B

3. The block “get confidence of class ( )” is observed while testing. What does a low confidence value
indicate?
A. High accuracy
B. Unclear or incorrect prediction
C. Large image size
D. Correct output
✅ Answer: B

4. The step “Test Model” is important because it helps to:
A. Add new classes
B. Check model performance on unseen data
C. Increase training samples
D. Change the background
✅ Answer: B

5. The option “Export Model” is used after improvement to:
A. Delete training data
B. Use the trained model inside PictoBlox projects
C. Stop testing
D. Rename classes
✅ Answer: B

6. What is the main goal of improving a machine learning model?
A. To change the interface
B. To increase accuracy and reliability
C. To reduce image size
D. To speed up animation
✅ Answer: B

7. Which factor has the greatest impact on model accuracy?
A. Background color
B. Quality and quantity of training data
C. Sprite size
D. Internet speed
✅ Answer: B

8. Why should training images include different angles and lighting conditions?
A. To increase storage
B. To help the model generalize better
C. To slow down training
D. To reduce testing
✅ Answer: B

9. What is overfitting in machine learning?
A. Model performs well on new data
B. Model memorizes training data but fails on new inputs
C. Model trains very fast
D. Model stops learning
✅ Answer: B

10. Which dataset is used to evaluate model performance?
A. Training dataset
B. Testing dataset
C. Random dataset
D. Backup dataset
✅ Answer: B

11. What happens if a model is trained with too little data?
A. Accuracy improves

B. Predictions become unreliable
C. Training becomes faster and perfect
D. The model stops working
✅ Answer: B

12. Why is testing with unseen images important?
A. To increase memory
B. To check real-world performance
C. To delete incorrect data
D. To retrain the model
✅ Answer: B

13. Which approach helps reduce model bias?
A. Using similar images only
B. Adding diverse and balanced training data
C. Training fewer times
D. Reducing classes
✅ Answer: B

14. When should a model be retrained?
A. Before adding data
B. After adding or modifying training data
C. After exporting
D. After stopping the project
✅ Answer: B

15. Improving a machine learning model is best described as:
A. A one-time task
B. A continuous and iterative process
C. An automatic process only
D. An unnecessary step
✅ Answer: B

Session 26
1. In the pose classification project, the option “Create New Project” is used first. What is its purpose?
A. To test the model
B. To start a fresh pose classifier project
C. To export the model
D. To add sprites
✅ Answer: B

2. The option “Pose Classifier” is selected while creating the project. What does this indicate?
A. The model will classify images
B. The model will recognize body poses
C. The model will recognize text
D. The model will recognize sounds
✅ Answer: B

3. In training the pose model, the step “Add Class” is used repeatedly. Why is this required?
A. To increase accuracy automatically
B. To create different pose categories
C. To store confidence values
D. To reset the model
✅ Answer: B

4. The button “Train Model” is clicked after collecting samples. What happens at this stage?
A. Camera turns off
B. The model learns patterns from body pose data
C. Images are deleted
D. The project ends
✅ Answer: B

5. While testing, the block “get confidence of class ( )” is observed. What does this value show?
A. Camera resolution
B. Certainty of the detected pose
C. Number of samples
D. Pose name
✅ Answer: B

6. What is the main objective of Session 26?
A. To animate sprites
B. To train a model to recognize body poses
C. To recognize text
D. To detect faces
✅ Answer: B

7. Which input device is mainly used to capture pose data?
A. Keyboard
B. Mouse
C. Webcam
D. Speaker
✅ Answer: C

8. What type of information does a pose classifier analyze?
A. Facial expressions
B. Body joints and posture
C. Voice patterns
D. Text shapes
✅ Answer: B

9. Why should multiple samples be collected for each pose?
A. To reduce memory usage
B. To improve model accuracy
C. To speed up animation
D. To reduce camera quality
✅ Answer: B

10. Training images for poses should ideally be taken:
A. From a single angle
B. With the same background only
C. From different angles and positions
D. Without the human body
✅ Answer: C

11. What happens if the pose samples are unclear or inconsistent?
A. Accuracy improves

B. Model predictions become unreliable
C. Training becomes faster
D. Model stops working
✅ Answer: B

12. Pose classification is an application of which AI field?
A. Speech Recognition
B. Text Recognition
C. Computer Vision
D. Robotics
✅ Answer: C

13. Which of the following is an example of a pose class?
A. Smiling
B. Hands Up
C. Loud voice
D. Printed text
✅ Answer: B

14. What should be done after adding new pose samples?
A. Stop the project
B. Retrain the model
C. Export immediately
D. Delete old samples
✅ Answer: B

15. Pose classifier models work best when training data is:
A. Limited and repetitive
B. Clear, varied, and well-labelled
C. Random and noisy
D. Unlabelled
✅ Answer: B

Session 27
1. In the Howdy Tobi project, the block “when green flag clicked” is used. What is its main purpose?
A. To detect pose
B. To start the pose interaction program
C. To export the model
D. To change costume
✅ Answer: B

2. The block “analyse image from camera” is used continuously in the script. Why is this block
important?
A. To train the model
B. To detect body poses using live camera input
C. To save images
D. To change background
✅ Answer: B

3. In this session, the block “is identified class ( ) ?” is used inside a forever loop. What does this help
achieve?
A. Detect pose only once
B. Continuously check the detected pose
C. Reset the score
D. End the program
✅ Answer: B

4. The block “say ( ) for 2 seconds” is used after pose detection. What does this block do?
A. Plays a sound
B. Displays the greeting based on detected pose
C. Trains the model again
D. Stops the camera
✅ Answer: B

5. The block “forever” is used in the script mainly to:
A. Stop the program after one run
B. Continuously detect and respond to poses
C. Delay execution
D. Change the sprite
✅ Answer: B

6. What is the main objective of the Howdy Tobi project?
A. To train a pose classifier
B. To make Tobi respond to body poses with greetings
C. To recognize text
D. To play sounds
✅ Answer: B

7. Which AI capability is mainly used in Session 27?
A. Speech Recognition
B. Text Recognition
C. Pose Classification
D. Face Recognition
✅ Answer: C

8. Which greeting is displayed when the detected pose is “Hands Up”?
A. Hello
B. Welcome
C. Namaste
D. Hi
✅ Answer: C

9. Why is a webcam required in this project?
A. To play sounds
B. To capture body poses
C. To display animations
D. To store images
✅ Answer: B

10. Why is the forever loop important in pose-based interaction?
A. To improve graphics
B. To continuously monitor pose changes
C. To stop the script
D. To save memory
✅ Answer: B

11. What happens if no known pose is detected?

A. The program stops
B. A default or no greeting is shown
C. The model retrains
D. Score increases
✅ Answer: B

12. Pose-based interaction is an example of:
A. Manual control
B. Human–computer interaction using AI
C. Text-based programming
D. Animation only
✅ Answer: B

13. Which factor helps improve pose detection accuracy?
A. Dark lighting
B. Clear camera view and proper body posture
C. Small screen size
D. Fast animation speed
✅ Answer: B

14. The Howdy Tobi project demonstrates how AI can be used for:
A. Entertainment only
B. Interactive and responsive applications
C. Data storage
D. Image editing
✅ Answer: B

15. What is the key learning outcome of Session 27?
A. Creating ML datasets
B. Using pose detection to build interactive AI applications
C. Writing text programs
D. Recognizing brands
✅ Answer: B

Session 28
1. In smart city systems, the step “collect data” is performed first. What does this step mainly involve?
A. Taking decisions
B. Gathering information using sensors and cameras
C. Displaying results
D. Storing predictions
✅ Answer: B

2. The step “analyse data” in AI-based city management is used to:
A. Capture images
B. Find patterns and insights from collected data
C. Store raw data
D. Turn devices ON
✅ Answer: B

3. In traffic management, the step “predict outcome” helps the system to:
A. Display signals randomly
B. Forecast congestion and traffic flow
C. Capture vehicle images
D. Count pedestrians
✅ Answer: B

4. The step “act on prediction” in smart cities refers to:
A. Training models
B. Implementing actions such as changing traffic lights
C. Collecting data again
D. Exporting models
✅ Answer: B

5. The “feedback loop” in AI systems is important because it:
A. Stops the system
B. Allows the system to improve using past results
C. Removes errors completely
D. Deletes old data
✅ Answer: B

6. What is a smart city?
A. A city with more buildings
B. A city that uses AI and technology to improve quality of life
C. A city without traffic
D. A city with robots only
✅ Answer: B

7. Which AI application helps reduce traffic congestion in smart cities?
A. Face recognition
B. Intelligent traffic signal control
C. Speech recognition
D. Text detection
✅ Answer: B

8. AI-based pollution monitoring systems mainly help to:
A. Increase pollution
B. Track and analyze air quality levels
C. Control population
D. Reduce internet usage
✅ Answer: B

9. How is AI used in smart city security systems?
A. Manual patrolling
B. Surveillance and threat detection
C. Playing alarms randomly
D. Storing videos only
✅ Answer: B

10. Which data source is commonly used for smart city applications?
A. Typewriter
B. Sensors and cameras
C. Notebooks
D. Chalkboards
✅ Answer: B

11. AI in waste management is used to:
A. Collect waste manually

B. Optimize waste collection routes
C. Increase garbage
D. Stop recycling
✅ Answer: B

12. Which AI technology helps in managing energy efficiently in smart cities?
A. Manual meters
B. Smart grids powered by AI
C. Traditional bulbs
D. Printed schedules
✅ Answer: B

13. What is one major benefit of using AI in healthcare systems within smart cities?
A. Longer hospital queues
B. Faster diagnosis and monitoring
C. Increased paperwork
D. Manual checkups
✅ Answer: B

14. Why is data important for AI-based smart city solutions?
A. AI works without data
B. Data helps AI make accurate decisions
C. Data increases electricity usage
D. Data is used only for storage
✅ Answer: B

15. The main goal of using AI in real life and smart cities is to:
A. Replace humans
B. Improve efficiency, safety, and quality of life
C. Make systems complex
D. Increase costs
✅ Answer: B

`;

/**
 * Main function to import quiz data
 */
async function importQuizData() {
  try {
    console.log('🚀 Starting Quiz Data Import...\n');
    
    // Initialize databases
    console.log('🔌 Connecting to databases...');
    await initPostgres();
    await initMongo();
    console.log('✅ Databases connected\n');
    
    // Find AI course and sessions
    const { course, phase, sessions } = await findAICourseAndSessions();
    
    // Parse quiz data
    console.log('📝 Parsing quiz data...');
    const parsedSessions = parseQuizData(QUIZ_DATA_TEXT);
    console.log(`✅ Parsed ${parsedSessions.length} sessions with quiz data\n`);
    
    // Create quiz repository
    const quizRepository = new QuizRepository();
    const pool = getPostgresPool();
    const structureRepo = new CourseStructureRepository(pool);
    
    let createdCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    // Process each session
    for (const parsedSession of parsedSessions) {
      // Find matching session
      const session = sessions.find(s => s.sessionNumber === parsedSession.sessionNumber);
      
      if (!session) {
        console.log(`  ⚠️  Session ${parsedSession.sessionNumber} not found in database`);
        skippedCount++;
        continue;
      }
      
      try {
        // Check if quiz already exists
        const existingQuiz = await quizRepository.findBySessionId(session.sessionId);
        if (existingQuiz) {
          console.log(`  ⚠️  Quiz already exists for Session ${parsedSession.sessionNumber}: ${session.title}`);
          skippedCount++;
          continue;
        }
        
        // Convert to MCQQuestion format
        const questions = convertToMCQQuestions(parsedSession);
        
        // Validate question count (must be 12-30 as per model validation)
        if (questions.length < 12 || questions.length > 30) {
          console.error(`  ❌ Session ${parsedSession.sessionNumber}: Invalid question count (${questions.length}). Must be between 12 and 30 questions.`);
          console.error(`     Parsed ${parsedSession.questions.length} questions from text.`);
          errorCount++;
          continue;
        }
        
        // Create quiz in MongoDB
        const quizInput: CreateQuizInput = {
          sessionId: session.sessionId,
          questions,
          passingScore: 60, // 60% passing score
        };
        
        const quiz = await quizRepository.create(quizInput);
        console.log(`  ✅ Created quiz for Session ${parsedSession.sessionNumber}: ${session.title} (${questions.length} questions, ID: ${quiz._id})`);
        
        // Update session with quizId in PostgreSQL
        try {
          await structureRepo.updateSessionQuizId(session.sessionId, quiz._id.toString());
          console.log(`     ✅ Linked quiz to session\n`);
        } catch (linkError: any) {
          console.warn(`     ⚠️  Created quiz but failed to link to session: ${linkError.message}`);
          console.log(`        Quiz ID: ${quiz._id.toString()}`);
          console.log(`        Session ID: ${session.sessionId}`);
          console.log(`        You can link manually with: UPDATE course_sessions SET quiz_id = '${quiz._id.toString()}' WHERE id = '${session.sessionId}';\n`);
        }
        
        createdCount++;
      } catch (error: any) {
        console.error(`  ❌ Error creating quiz for Session ${parsedSession.sessionNumber}: ${error.message}`);
        errorCount++;
      }
    }
    
    console.log('\n🎉 Import Complete!');
    console.log(`   ✅ Created: ${createdCount} quizzes`);
    console.log(`   ⚠️  Skipped: ${skippedCount} quizzes (already exist or session not found)`);
    if (errorCount > 0) {
      console.log(`   ❌ Errors: ${errorCount} quizzes`);
    }
    console.log(`\n📝 All quizzes are linked to their sessions via quizId.\n`);
    console.log(`💡 Note: To add quiz data for sessions 5-25, update the QUIZ_DATA_TEXT constant and run this script again.\n`);
    
  } catch (error: any) {
    console.error('\n❌ Error importing quiz data:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  importQuizData();
}

export { importQuizData };
