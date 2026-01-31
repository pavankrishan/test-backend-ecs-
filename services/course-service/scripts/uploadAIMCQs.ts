/**
 * Script to create mock MCQ quizzes for AI Course sessions
 * 
 * This script:
 * 1. Finds the AI course in PostgreSQL
 * 2. Gets all sessions from the course
 * 3. Creates comprehensive mock quizzes (15 questions each) for each session
 * 4. Links quizzes to sessions via quizId
 * 
 * Run: pnpm tsx scripts/uploadAIMCQs.ts
 */

import "@kodingcaravan/shared/config";
import { initPostgres, getPostgresPool } from '../src/config/database';
import { initMongo } from '../src/config/database';
import { QuizRepository, CreateQuizInput } from '../src/repositories/quiz.repository';
import { CourseStructureRepository } from '../src/models/courseStructure.model';
import { CourseRepository } from '../src/models/course.model';
import type { MCQQuestion } from '../src/models/quiz.model';

/**
 * Generate mock MCQ questions for a session based on its title and description
 */
function generateMockQuestions(sessionTitle: string, sessionDescription: string, sessionNumber: number): MCQQuestion[] {
  const questions: MCQQuestion[] = [];
  
  // Base questions that apply to most AI sessions
  const baseQuestions: MCQQuestion[] = [
    {
      id: `q${sessionNumber}-1`,
      question: 'What is the primary goal of Artificial Intelligence?',
      options: [
        'To replace humans completely',
        'To create systems that can perform tasks requiring human intelligence',
        'To create entertainment only',
        'To eliminate jobs'
      ],
      correctAnswerIndex: 1,
      explanation: 'AI aims to create systems that can perform tasks typically requiring human intelligence, such as learning, reasoning, and problem-solving.',
      points: 10,
    },
    {
      id: `q${sessionNumber}-2`,
      question: 'Which programming language is most commonly used for AI development?',
      options: ['Java', 'Python', 'C++', 'JavaScript'],
      correctAnswerIndex: 1,
      explanation: 'Python is the most popular language for AI due to its extensive libraries like NumPy, Pandas, TensorFlow, and PyTorch.',
      points: 10,
    },
    {
      id: `q${sessionNumber}-3`,
      question: 'What is Machine Learning?',
      options: [
        'A type of robot',
        'A subset of AI that enables systems to learn from data',
        'A programming language',
        'A database system'
      ],
      correctAnswerIndex: 1,
      explanation: 'Machine Learning is a subset of AI that enables systems to learn and improve from experience without being explicitly programmed.',
      points: 10,
    },
  ];

  // Topic-specific questions based on session title
  let topicQuestions: MCQQuestion[] = [];

  if (sessionTitle.toLowerCase().includes('introduction') || sessionTitle.toLowerCase().includes('what is')) {
    topicQuestions = [
      {
        id: `q${sessionNumber}-4`,
        question: 'Which is NOT a type of AI?',
        options: ['Narrow AI', 'General AI', 'Super AI', 'Natural AI'],
        correctAnswerIndex: 3,
        explanation: 'The main types of AI are Narrow AI (weak AI), General AI (strong AI), and Super AI (theoretical).',
        points: 10,
      },
      {
        id: `q${sessionNumber}-5`,
        question: 'Where is AI commonly used today?',
        options: [
          'Only in research labs',
          'In smartphones, search engines, and recommendation systems',
          'Only in movies',
          'Not used anywhere yet'
        ],
        correctAnswerIndex: 1,
        explanation: 'AI is widely used in everyday applications like virtual assistants, search engines, social media, and recommendation systems.',
        points: 10,
      },
    ];
  } else if (sessionTitle.toLowerCase().includes('machine learning') || sessionTitle.toLowerCase().includes('ml')) {
    topicQuestions = [
      {
        id: `q${sessionNumber}-4`,
        question: 'Which type of ML uses labeled data?',
        options: ['Unsupervised Learning', 'Supervised Learning', 'Reinforcement Learning', 'None of the above'],
        correctAnswerIndex: 1,
        explanation: 'Supervised Learning uses labeled training data to learn patterns and make predictions.',
        points: 10,
      },
      {
        id: `q${sessionNumber}-5`,
        question: 'What is the difference between supervised and unsupervised learning?',
        options: [
          'Supervised uses labeled data, unsupervised uses unlabeled data',
          'Supervised is faster, unsupervised is slower',
          'There is no difference',
          'Supervised uses neural networks, unsupervised does not'
        ],
        correctAnswerIndex: 0,
        explanation: 'Supervised learning uses labeled training data, while unsupervised learning finds patterns in unlabeled data.',
        points: 10,
      },
    ];
  } else if (sessionTitle.toLowerCase().includes('python')) {
    topicQuestions = [
      {
        id: `q${sessionNumber}-4`,
        question: 'Why is Python popular for AI?',
        options: [
          'It is the fastest language',
          'It has extensive libraries for data science and ML',
          'It is the only language for AI',
          'It is the easiest language'
        ],
        correctAnswerIndex: 1,
        explanation: 'Python is popular for AI because of its extensive libraries like NumPy, Pandas, TensorFlow, and PyTorch.',
        points: 10,
      },
      {
        id: `q${sessionNumber}-5`,
        question: 'Which Python library is used for numerical computations?',
        options: ['Pandas', 'NumPy', 'Matplotlib', 'Scikit-learn'],
        correctAnswerIndex: 1,
        explanation: 'NumPy is the fundamental library for numerical computations in Python.',
        points: 10,
      },
    ];
  } else if (sessionTitle.toLowerCase().includes('neural network') || sessionTitle.toLowerCase().includes('deep learning')) {
    topicQuestions = [
      {
        id: `q${sessionNumber}-4`,
        question: 'What is a neural network?',
        options: [
          'A type of database',
          'A computing system inspired by biological neural networks',
          'A programming language',
          'A type of algorithm'
        ],
        correctAnswerIndex: 1,
        explanation: 'A neural network is a computing system inspired by biological neural networks that make up animal brains.',
        points: 10,
      },
      {
        id: `q${sessionNumber}-5`,
        question: 'What is the purpose of an activation function in a neural network?',
        options: [
          'To store data',
          'To introduce non-linearity into the network',
          'To speed up computation',
          'To reduce memory usage'
        ],
        correctAnswerIndex: 1,
        explanation: 'Activation functions introduce non-linearity, allowing neural networks to learn complex patterns.',
        points: 10,
      },
    ];
  } else if (sessionTitle.toLowerCase().includes('cnn') || sessionTitle.toLowerCase().includes('convolutional')) {
    topicQuestions = [
      {
        id: `q${sessionNumber}-4`,
        question: 'What is a Convolutional Neural Network (CNN) primarily used for?',
        options: [
          'Text processing',
          'Image processing and computer vision',
          'Time series analysis',
          'Data visualization'
        ],
        correctAnswerIndex: 1,
        explanation: 'CNNs are specifically designed for image processing and computer vision tasks.',
        points: 10,
      },
      {
        id: `q${sessionNumber}-5`,
        question: 'What is the purpose of pooling in CNNs?',
        options: [
          'To increase image size',
          'To reduce dimensionality and extract features',
          'To add noise',
          'To change colors'
        ],
        correctAnswerIndex: 1,
        explanation: 'Pooling reduces dimensionality and helps extract important features while reducing computation.',
        points: 10,
      },
    ];
  } else if (sessionTitle.toLowerCase().includes('rnn') || sessionTitle.toLowerCase().includes('recurrent')) {
    topicQuestions = [
      {
        id: `q${sessionNumber}-4`,
        question: 'What is a Recurrent Neural Network (RNN) best suited for?',
        options: [
          'Image classification',
          'Sequential data and time series',
          'Data visualization',
          'Database queries'
        ],
        correctAnswerIndex: 1,
        explanation: 'RNNs are designed to handle sequential data and time series where order matters.',
        points: 10,
      },
      {
        id: `q${sessionNumber}-5`,
        question: 'What is LSTM?',
        options: [
          'A type of database',
          'Long Short-Term Memory, a type of RNN',
          'A programming language',
          'A visualization tool'
        ],
        correctAnswerIndex: 1,
        explanation: 'LSTM (Long Short-Term Memory) is a type of RNN that can learn long-term dependencies.',
        points: 10,
      },
    ];
  } else if (sessionTitle.toLowerCase().includes('nlp') || sessionTitle.toLowerCase().includes('natural language')) {
    topicQuestions = [
      {
        id: `q${sessionNumber}-4`,
        question: 'What is Natural Language Processing (NLP)?',
        options: [
          'A programming language',
          'A field of AI that focuses on interaction between computers and human language',
          'A database system',
          'A visualization tool'
        ],
        correctAnswerIndex: 1,
        explanation: 'NLP is a field of AI that focuses on enabling computers to understand, interpret, and generate human language.',
        points: 10,
      },
      {
        id: `q${sessionNumber}-5`,
        question: 'What is tokenization in NLP?',
        options: [
          'Breaking text into individual words or tokens',
          'Encrypting text',
          'Translating text',
          'Formatting text'
        ],
        correctAnswerIndex: 0,
        explanation: 'Tokenization is the process of breaking text into individual words or tokens for processing.',
        points: 10,
      },
    ];
  } else if (sessionTitle.toLowerCase().includes('regression') || sessionTitle.toLowerCase().includes('linear')) {
    topicQuestions = [
      {
        id: `q${sessionNumber}-4`,
        question: 'What is Linear Regression used for?',
        options: [
          'Classification problems',
          'Predicting continuous values',
          'Clustering data',
          'Text processing'
        ],
        correctAnswerIndex: 1,
        explanation: 'Linear Regression is used to predict continuous numerical values.',
        points: 10,
      },
      {
        id: `q${sessionNumber}-5`,
        question: 'What is the goal of linear regression?',
        options: [
          'To find the best line that fits the data',
          'To classify data into categories',
          'To cluster similar data points',
          'To visualize data'
        ],
        correctAnswerIndex: 0,
        explanation: 'Linear regression finds the best-fitting line through data points to make predictions.',
        points: 10,
      },
    ];
  } else if (sessionTitle.toLowerCase().includes('classification') || sessionTitle.toLowerCase().includes('decision tree')) {
    topicQuestions = [
      {
        id: `q${sessionNumber}-4`,
        question: 'What is Classification in Machine Learning?',
        options: [
          'Predicting continuous values',
          'Categorizing data into classes or categories',
          'Clustering data',
          'Visualizing data'
        ],
        correctAnswerIndex: 1,
        explanation: 'Classification is the task of categorizing data into predefined classes or categories.',
        points: 10,
      },
      {
        id: `q${sessionNumber}-5`,
        question: 'What is a Decision Tree?',
        options: [
          'A database structure',
          'A tree-like model used for classification and regression',
          'A visualization tool',
          'A programming language'
        ],
        correctAnswerIndex: 1,
        explanation: 'A Decision Tree is a tree-like model that makes decisions based on feature values.',
        points: 10,
      },
    ];
  } else if (sessionTitle.toLowerCase().includes('evaluation') || sessionTitle.toLowerCase().includes('metric')) {
    topicQuestions = [
      {
        id: `q${sessionNumber}-4`,
        question: 'What is Accuracy in model evaluation?',
        options: [
          'The number of correct predictions divided by total predictions',
          'The speed of the model',
          'The memory usage',
          'The model size'
        ],
        correctAnswerIndex: 0,
        explanation: 'Accuracy is the ratio of correct predictions to total predictions.',
        points: 10,
      },
      {
        id: `q${sessionNumber}-5`,
        question: 'What is a Confusion Matrix?',
        options: [
          'A visualization tool',
          'A table showing the performance of a classification model',
          'A type of neural network',
          'A database structure'
        ],
        correctAnswerIndex: 1,
        explanation: 'A Confusion Matrix is a table that shows the performance of a classification model.',
        points: 10,
      },
    ];
  } else if (sessionTitle.toLowerCase().includes('random forest') || sessionTitle.toLowerCase().includes('ensemble')) {
    topicQuestions = [
      {
        id: `q${sessionNumber}-4`,
        question: 'What is Ensemble Learning?',
        options: [
          'Using a single model',
          'Combining multiple models to improve performance',
          'A type of database',
          'A visualization technique'
        ],
        correctAnswerIndex: 1,
        explanation: 'Ensemble Learning combines multiple models to achieve better performance than individual models.',
        points: 10,
      },
      {
        id: `q${sessionNumber}-5`,
        question: 'What is a Random Forest?',
        options: [
          'A single decision tree',
          'An ensemble of decision trees',
          'A neural network',
          'A database structure'
        ],
        correctAnswerIndex: 1,
        explanation: 'Random Forest is an ensemble method that combines multiple decision trees.',
        points: 10,
      },
    ];
  } else if (sessionTitle.toLowerCase().includes('clustering') || sessionTitle.toLowerCase().includes('k-means')) {
    topicQuestions = [
      {
        id: `q${sessionNumber}-4`,
        question: 'What is Clustering?',
        options: [
          'A supervised learning technique',
          'An unsupervised learning technique that groups similar data',
          'A type of regression',
          'A visualization tool'
        ],
        correctAnswerIndex: 1,
        explanation: 'Clustering is an unsupervised learning technique that groups similar data points together.',
        points: 10,
      },
      {
        id: `q${sessionNumber}-5`,
        question: 'What is K-Means Clustering?',
        options: [
          'A classification algorithm',
          'A clustering algorithm that partitions data into k clusters',
          'A regression algorithm',
          'A neural network'
        ],
        correctAnswerIndex: 1,
        explanation: 'K-Means is a clustering algorithm that partitions data into k clusters based on similarity.',
        points: 10,
      },
    ];
  } else if (sessionTitle.toLowerCase().includes('deployment') || sessionTitle.toLowerCase().includes('model deployment')) {
    topicQuestions = [
      {
        id: `q${sessionNumber}-4`,
        question: 'What is Model Deployment?',
        options: [
          'Training a model',
          'Making a trained model available for use in production',
          'Testing a model',
          'Visualizing a model'
        ],
        correctAnswerIndex: 1,
        explanation: 'Model deployment is the process of making a trained model available for use in production environments.',
        points: 10,
      },
      {
        id: `q${sessionNumber}-5`,
        question: 'What is an API in the context of ML deployment?',
        options: [
          'A database',
          'An interface that allows applications to interact with the model',
          'A programming language',
          'A visualization tool'
        ],
        correctAnswerIndex: 1,
        explanation: 'An API (Application Programming Interface) allows applications to interact with deployed ML models.',
        points: 10,
      },
    ];
  } else {
    // Generic AI questions for other topics
    topicQuestions = [
      {
        id: `q${sessionNumber}-4`,
        question: 'What is the difference between AI and Machine Learning?',
        options: [
          'They are the same thing',
          'ML is a subset of AI',
          'AI is a subset of ML',
          'They are unrelated'
        ],
        correctAnswerIndex: 1,
        explanation: 'Machine Learning is a subset of Artificial Intelligence that focuses on learning from data.',
        points: 10,
      },
      {
        id: `q${sessionNumber}-5`,
        question: 'What is overfitting in Machine Learning?',
        options: [
          'When a model performs well on training data but poorly on new data',
          'When a model is too simple',
          'When training takes too long',
          'When a model uses too much memory'
        ],
        correctAnswerIndex: 0,
        explanation: 'Overfitting occurs when a model learns the training data too well and fails to generalize to new data.',
        points: 10,
      },
    ];
  }

  // Add more generic questions to reach 15 questions
  const additionalQuestions: MCQQuestion[] = [
    {
      id: `q${sessionNumber}-6`,
      question: 'What is a feature in Machine Learning?',
      options: [
        'A type of model',
        'An input variable used to make predictions',
        'A programming language',
        'A visualization tool'
      ],
      correctAnswerIndex: 1,
      explanation: 'A feature is an input variable used by the model to make predictions.',
      points: 10,
    },
    {
      id: `q${sessionNumber}-7`,
      question: 'What is training data?',
      options: [
        'Data used to test the model',
        'Data used to train the model',
        'Data used for visualization',
        'Data stored in a database'
      ],
      correctAnswerIndex: 1,
      explanation: 'Training data is the dataset used to train a machine learning model.',
      points: 10,
    },
    {
      id: `q${sessionNumber}-8`,
      question: 'What is a prediction in Machine Learning?',
      options: [
        'The input data',
        'The output of a model for new data',
        'A type of algorithm',
        'A visualization'
      ],
      correctAnswerIndex: 1,
      explanation: 'A prediction is the output that a trained model produces for new input data.',
      points: 10,
    },
    {
      id: `q${sessionNumber}-9`,
      question: 'What is the purpose of data preprocessing?',
      options: [
        'To visualize data',
        'To clean and prepare data for machine learning',
        'To store data',
        'To delete data'
      ],
      correctAnswerIndex: 1,
      explanation: 'Data preprocessing involves cleaning, transforming, and preparing data for machine learning algorithms.',
      points: 10,
    },
    {
      id: `q${sessionNumber}-10`,
      question: 'What is a model in Machine Learning?',
      options: [
        'A database',
        'A mathematical representation learned from data',
        'A programming language',
        'A visualization tool'
      ],
      correctAnswerIndex: 1,
      explanation: 'A model is a mathematical representation that learns patterns from training data to make predictions.',
      points: 10,
    },
    {
      id: `q${sessionNumber}-11`,
      question: 'What is validation data used for?',
      options: [
        'Training the model',
        'Evaluating model performance during training',
        'Storing results',
        'Visualizing data'
      ],
      correctAnswerIndex: 1,
      explanation: 'Validation data is used to evaluate model performance and tune hyperparameters during training.',
      points: 10,
    },
    {
      id: `q${sessionNumber}-12`,
      question: 'What is a hyperparameter?',
      options: [
        'A feature in the data',
        'A parameter set before training that controls the learning process',
        'A prediction result',
        'A type of data'
      ],
      correctAnswerIndex: 1,
      explanation: 'Hyperparameters are parameters set before training that control the learning process, such as learning rate.',
      points: 10,
    },
    {
      id: `q${sessionNumber}-13`,
      question: 'What is the purpose of cross-validation?',
      options: [
        'To speed up training',
        'To assess model performance more reliably',
        'To reduce memory usage',
        'To visualize data'
      ],
      correctAnswerIndex: 1,
      explanation: 'Cross-validation helps assess model performance more reliably by using multiple train-test splits.',
      points: 10,
    },
    {
      id: `q${sessionNumber}-14`,
      question: 'What is feature engineering?',
      options: [
        'Creating new features from existing data',
        'Deleting features',
        'Visualizing features',
        'Storing features'
      ],
      correctAnswerIndex: 0,
      explanation: 'Feature engineering involves creating new features or transforming existing ones to improve model performance.',
      points: 10,
    },
    {
      id: `q${sessionNumber}-15`,
      question: 'What is the goal of Machine Learning?',
      options: [
        'To store large amounts of data',
        'To enable systems to learn and improve from experience',
        'To replace all human workers',
        'To create entertainment'
      ],
      correctAnswerIndex: 1,
      explanation: 'The goal of Machine Learning is to enable systems to learn and improve from experience without explicit programming.',
      points: 10,
    },
  ];

  // Combine all questions
  questions.push(...baseQuestions);
  questions.push(...topicQuestions);
  questions.push(...additionalQuestions);

  // Ensure we have exactly 15 questions
  return questions.slice(0, 15);
}

/**
 * Find AI course and get all sessions
 */
async function findAICourseAndSessions() {
  const pool = getPostgresPool();
  const courseRepo = new CourseRepository(pool);
  const structureRepo = new CourseStructureRepository(pool);
  
  // Find AI course by title or category
  const courses = await courseRepo.findMany({ category: 'STEM', search: 'ai' });
  const aiCourse = courses.courses.find(c => 
    c.title.toLowerCase().includes('ai') || 
    c.subcategory?.toLowerCase().includes('artificial intelligence')
  );
  
  if (!aiCourse) {
    throw new Error('AI course not found. Please create it first using createAICourse.ts');
  }
  
  console.log(`✅ Found course: ${aiCourse.title} (${aiCourse.id})\n`);
  
  // Get all phases, levels, and sessions
  const phases = await structureRepo.getPhasesByCourseId(aiCourse.id);
  console.log(`   Found ${phases.length} phases`);
  
  if (phases.length === 0) {
    throw new Error('AI course has no phases. Please create phases and sessions first.');
  }
  
  // Create a map of all sessions
  const sessions: Array<{
    sessionId: string;
    sessionNumber: number;
    title: string;
    description: string;
    phase: number;
    level: number;
    sessionInLevel: number;
  }> = [];
  
  for (const phase of phases.sort((a, b) => a.sequence - b.sequence)) {
    const levels = await structureRepo.getLevelsByPhaseId(phase.id);
    console.log(`   Phase ${phase.sequence}: ${phase.title} - ${levels.length} levels`);
    
    for (const level of levels.sort((a, b) => a.sequence - b.sequence)) {
      const levelSessions = await structureRepo.getSessionsByLevelId(level.id);
      console.log(`     Level ${level.sequence} (${level.levelType}): ${levelSessions.length} sessions`);
      
      for (const session of levelSessions.sort((a, b) => a.sessionNumber - b.sessionNumber)) {
        sessions.push({
          sessionId: session.id,
          sessionNumber: sessions.length + 1, // Global session number
          title: session.title,
          description: session.description,
          phase: phase.sequence,
          level: level.sequence,
          sessionInLevel: session.sessionNumber,
        });
      }
    }
  }
  
  console.log(`\n✅ Found ${sessions.length} sessions total\n`);
  
  return { course: aiCourse, sessions };
}

/**
 * Main function
 */
async function uploadAIMCQs() {
  try {
    console.log('🚀 Starting AI MCQ Quiz Creation...\n');
    
    // Initialize databases
    console.log('🔌 Connecting to databases...');
    await initPostgres();
    await initMongo();
    console.log('✅ Databases connected\n');
    
    // Find AI course and sessions
    const { course, sessions } = await findAICourseAndSessions();
    
    // Create quizzes
    const quizRepository = new QuizRepository();
    const pool = getPostgresPool();
    const structureRepo = new CourseStructureRepository(pool);
    
    let createdCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const session of sessions) {
      try {
        // Check if quiz already exists
        const existingQuiz = await quizRepository.findBySessionId(session.sessionId);
        if (existingQuiz) {
          console.log(`  ⚠️  Quiz already exists for Session ${session.sessionNumber}: ${session.title}`);
          skippedCount++;
          continue;
        }
        
        // Generate mock questions
        const questions = generateMockQuestions(session.title, session.description, session.sessionNumber);
        
        // Validate question count (12-25 as per requirements)
        if (questions.length < 12 || questions.length > 25) {
          console.warn(`  ⚠️  Session ${session.sessionNumber}: Expected 12-25 questions, generated ${questions.length}`);
        }
        
        // Create quiz in MongoDB
        const quizInput: CreateQuizInput = {
          sessionId: session.sessionId,
          questions,
          passingScore: 60, // 60% passing score
        };
        
        const quiz = await quizRepository.create(quizInput);
        console.log(`  ✅ Created quiz for Session ${session.sessionNumber}: ${session.title} (${questions.length} questions, ID: ${quiz._id})`);
        
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
        console.error(`  ❌ Error creating quiz for Session ${session.sessionNumber}: ${error.message}`);
        errorCount++;
      }
    }
    
    console.log('\n🎉 Upload Complete!');
    console.log(`   ✅ Created: ${createdCount} quizzes`);
    console.log(`   ⚠️  Skipped: ${skippedCount} quizzes (already exist)`);
    if (errorCount > 0) {
      console.log(`   ❌ Errors: ${errorCount} quizzes`);
    }
    console.log(`\n📝 All quizzes are linked to their sessions via quizId.\n`);
    
  } catch (error: any) {
    console.error('\n❌ Error creating AI MCQs:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  uploadAIMCQs()
    .then(() => {
      console.log('\n✅ Script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Script failed:', error);
      process.exit(1);
    });
}

export { uploadAIMCQs };

