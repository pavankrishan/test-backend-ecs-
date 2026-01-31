/**
 * Script to create an AI Course with full structure
 * 
 * Run this script to create:
 * - Course: AI Fundamentals
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

async function createAICourse() {
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

    console.log('🚀 Starting AI Course Creation...\n');

    // ============================================================================
    // CREATE COURSE
    // ============================================================================
    console.log('📚 Creating AI Course...');
    const course = await courseRepo.create({
      title: 'AI Fundamentals',
      description: `A comprehensive course covering the fundamentals of Artificial Intelligence, from basic concepts to advanced machine learning and deep learning applications. Learn to build, train, and deploy AI models through hands-on projects and real-world applications.

This course is designed for students who want to:
- Understand the principles of artificial intelligence and machine learning
- Learn Python programming for AI and data science
- Build and train machine learning models
- Apply AI concepts to solve real-world problems
- Develop projects from simple classifiers to complex neural networks
- Understand deep learning, natural language processing, and computer vision`,
      shortDescription: 'Master AI from basics to advanced machine learning and deep learning with hands-on projects',
      category: 'STEM',
      subcategory: 'Artificial Intelligence',
      level: 'beginner',
      price: 3499.00,
      currency: 'INR',
      discountPrice: 2499.00,
      thumbnailUrl: 'https://example.com/ai-course-thumbnail.jpg',
      duration: 1800, // 30 hours total (90 sessions × 20 min average)
      tags: ['ai', 'machine-learning', 'deep-learning', 'python', 'neural-networks', 'data-science', 'nlp', 'computer-vision'],
      language: 'en',
    });

    console.log(`✅ Course created: ${course.id} - ${course.title}\n`);

    // ============================================================================
    // PHASE 1: INTRODUCTION TO AI
    // ============================================================================
    console.log('📖 Creating Phase 1: Introduction to AI...');
    const phase1 = await structureRepo.createPhase({
      courseId: course.id,
      title: 'Introduction to Artificial Intelligence',
      description: 'Learn the basics of AI, including machine learning concepts, Python programming, and data handling.',
      sequence: 1,
    });

    // Phase 1 - Level 1: Foundation
    console.log('  Creating Level 1: Foundation...');
    const phase1Level1 = await structureRepo.createLevel({
      phaseId: phase1.id,
      levelType: 'foundation',
      title: 'Foundation: AI Basics',
      description: 'Introduction to AI concepts, Python basics, and getting started with machine learning.',
      sequence: 1,
    });

    // Phase 1 - Level 1 Sessions (1-10)
    const phase1Level1Sessions: CreateSessionInput[] = [
      {
        levelId: phase1Level1.id,
        sessionNumber: 1,
        title: 'What is Artificial Intelligence?',
        description: 'Introduction to AI, history, types of AI, and applications in daily life.',
        expertVideoUrl: 'https://example.com/videos/ai-101-intro.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/ai-intro.pdf',
        coreActivity: 'Research and present 3 real-world AI applications',
        keyConcepts: ['AI definition', 'History of AI', 'Types of AI', 'Modern applications'],
        mcqQuestions: [
          {
            id: 'q1',
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
            id: 'q2',
            question: 'Which is NOT a type of AI?',
            options: ['Narrow AI', 'General AI', 'Super AI', 'Natural AI'],
            correctAnswerIndex: 3,
            explanation: 'The main types of AI are Narrow AI (weak AI), General AI (strong AI), and Super AI (theoretical).',
            points: 10,
          },
          {
            id: 'q3',
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
        ],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 2,
        title: 'Introduction to Machine Learning',
        description: 'Understanding what machine learning is, types of ML (supervised, unsupervised, reinforcement), and basic concepts.',
        expertVideoUrl: 'https://example.com/videos/ml-intro.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/ml-basics.pdf',
        coreActivity: 'Identify examples of supervised, unsupervised, and reinforcement learning',
        keyConcepts: ['Machine Learning definition', 'Supervised Learning', 'Unsupervised Learning', 'Reinforcement Learning'],
        mcqQuestions: [
          {
            id: 'q1',
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
          {
            id: 'q2',
            question: 'Which type of ML uses labeled data?',
            options: ['Unsupervised Learning', 'Supervised Learning', 'Reinforcement Learning', 'None of the above'],
            correctAnswerIndex: 1,
            explanation: 'Supervised Learning uses labeled training data to learn patterns and make predictions.',
            points: 10,
          },
        ],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 3,
        title: 'Python Basics for AI',
        description: 'Getting started with Python programming: variables, data types, lists, dictionaries, and basic operations.',
        expertVideoUrl: 'https://example.com/videos/python-basics.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/python-basics.pdf',
        coreActivity: 'Write Python programs using variables, lists, and dictionaries',
        keyConcepts: ['Python syntax', 'Data types', 'Lists and dictionaries', 'Basic operations'],
        mcqQuestions: [
          {
            id: 'q1',
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
        ],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 4,
        title: 'Working with Data',
        description: 'Introduction to data handling: reading CSV files, data cleaning, and basic data analysis with Pandas.',
        expertVideoUrl: 'https://example.com/videos/data-handling.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/data-handling.pdf',
        coreActivity: 'Load and analyze a dataset using Pandas',
        keyConcepts: ['Data loading', 'Data cleaning', 'Pandas basics', 'Data exploration'],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 5,
        title: 'Understanding Data Visualization',
        description: 'Creating visualizations with Matplotlib and Seaborn: plots, charts, and data insights.',
        expertVideoUrl: 'https://example.com/videos/data-visualization.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/visualization.pdf',
        coreActivity: 'Create visualizations to explore dataset patterns',
        keyConcepts: ['Matplotlib', 'Seaborn', 'Plot types', 'Data insights'],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 6,
        title: 'Your First ML Model: Linear Regression',
        description: 'Building your first machine learning model using linear regression to predict continuous values.',
        expertVideoUrl: 'https://example.com/videos/linear-regression.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/linear-regression.pdf',
        coreActivity: 'Build and train a linear regression model',
        keyConcepts: ['Linear Regression', 'Training data', 'Predictions', 'Model evaluation'],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 7,
        title: 'Classification: Decision Trees',
        description: 'Introduction to classification problems and building decision tree classifiers.',
        expertVideoUrl: 'https://example.com/videos/decision-trees.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/decision-trees.pdf',
        coreActivity: 'Build a decision tree classifier for a classification problem',
        keyConcepts: ['Classification', 'Decision Trees', 'Splitting criteria', 'Tree visualization'],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 8,
        title: 'Model Evaluation Metrics',
        description: 'Understanding accuracy, precision, recall, F1-score, and confusion matrices.',
        expertVideoUrl: 'https://example.com/videos/model-evaluation.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/evaluation-metrics.pdf',
        coreActivity: 'Evaluate models using different metrics',
        keyConcepts: ['Accuracy', 'Precision', 'Recall', 'F1-score', 'Confusion Matrix'],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 9,
        title: 'Feature Engineering',
        description: 'Preparing data for ML: feature selection, encoding categorical variables, and scaling features.',
        expertVideoUrl: 'https://example.com/videos/feature-engineering.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/feature-engineering.pdf',
        coreActivity: 'Engineer features for a machine learning model',
        keyConcepts: ['Feature selection', 'Encoding', 'Scaling', 'Feature importance'],
      },
      {
        levelId: phase1Level1.id,
        sessionNumber: 10,
        title: 'Foundation Project: Predict House Prices',
        description: 'Complete project: Build a machine learning model to predict house prices using regression.',
        expertVideoUrl: 'https://example.com/videos/foundation-project.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/foundation-project.pdf',
        coreActivity: 'Complete foundation level project: House price prediction',
        keyConcepts: ['Project planning', 'Data preprocessing', 'Model training', 'Evaluation', 'Documentation'],
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
      title: 'Development: Intermediate Machine Learning',
      description: 'Advanced ML algorithms, ensemble methods, and building more sophisticated models.',
      sequence: 2,
    });

    // Create 10 sessions for Development level
    const phase1Level2Sessions: CreateSessionInput[] = [
      {
        levelId: phase1Level2.id,
        sessionNumber: 1,
        title: 'Random Forests',
        description: 'Understanding ensemble learning and building random forest models.',
        expertVideoUrl: 'https://example.com/videos/random-forests.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/random-forests.pdf',
        coreActivity: 'Build a random forest model and compare with decision trees',
        keyConcepts: ['Ensemble Learning', 'Random Forests', 'Bootstrap', 'Feature importance'],
      },
      {
        levelId: phase1Level2.id,
        sessionNumber: 2,
        title: 'Gradient Boosting',
        description: 'Introduction to gradient boosting algorithms: XGBoost and LightGBM.',
        expertVideoUrl: 'https://example.com/videos/gradient-boosting.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/gradient-boosting.pdf',
        coreActivity: 'Implement gradient boosting for a classification problem',
        keyConcepts: ['Gradient Boosting', 'XGBoost', 'LightGBM', 'Boosting algorithms'],
      },
      {
        levelId: phase1Level2.id,
        sessionNumber: 3,
        title: 'Support Vector Machines',
        description: 'Understanding SVMs, kernels, and when to use them for classification.',
        expertVideoUrl: 'https://example.com/videos/svm.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/svm.pdf',
        coreActivity: 'Build SVM models with different kernels',
        keyConcepts: ['SVM', 'Kernels', 'Hyperplanes', 'Margin'],
      },
      {
        levelId: phase1Level2.id,
        sessionNumber: 4,
        title: 'K-Means Clustering',
        description: 'Unsupervised learning: clustering data using K-Means algorithm.',
        expertVideoUrl: 'https://example.com/videos/kmeans.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/kmeans.pdf',
        coreActivity: 'Perform clustering on unlabeled data',
        keyConcepts: ['Clustering', 'K-Means', 'Unsupervised Learning', 'Centroids'],
      },
      {
        levelId: phase1Level2.id,
        sessionNumber: 5,
        title: 'Cross-Validation',
        description: 'Model validation techniques: k-fold cross-validation and preventing overfitting.',
        expertVideoUrl: 'https://example.com/videos/cross-validation.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/cross-validation.pdf',
        coreActivity: 'Implement cross-validation for model evaluation',
        keyConcepts: ['Cross-Validation', 'K-Fold', 'Overfitting', 'Model selection'],
      },
      {
        levelId: phase1Level2.id,
        sessionNumber: 6,
        title: 'Hyperparameter Tuning',
        description: 'Optimizing model performance through hyperparameter tuning: Grid Search and Random Search.',
        expertVideoUrl: 'https://example.com/videos/hyperparameter-tuning.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/hyperparameter-tuning.pdf',
        coreActivity: 'Tune hyperparameters to improve model performance',
        keyConcepts: ['Hyperparameters', 'Grid Search', 'Random Search', 'Optimization'],
      },
      {
        levelId: phase1Level2.id,
        sessionNumber: 7,
        title: 'Neural Networks Introduction',
        description: 'Introduction to neural networks: perceptrons, activation functions, and basic architecture.',
        expertVideoUrl: 'https://example.com/videos/neural-networks-intro.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/neural-networks.pdf',
        coreActivity: 'Build a simple neural network from scratch',
        keyConcepts: ['Neural Networks', 'Perceptrons', 'Activation Functions', 'Layers'],
      },
      {
        levelId: phase1Level2.id,
        sessionNumber: 8,
        title: 'Working with TensorFlow/Keras',
        description: 'Building neural networks using TensorFlow and Keras frameworks.',
        expertVideoUrl: 'https://example.com/videos/tensorflow-keras.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/tensorflow.pdf',
        coreActivity: 'Build neural networks using Keras',
        keyConcepts: ['TensorFlow', 'Keras', 'Sequential Model', 'Compilation'],
      },
      {
        levelId: phase1Level2.id,
        sessionNumber: 9,
        title: 'Image Classification Basics',
        description: 'Introduction to computer vision: working with images and basic image classification.',
        expertVideoUrl: 'https://example.com/videos/image-classification.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/image-classification.pdf',
        coreActivity: 'Build an image classifier using neural networks',
        keyConcepts: ['Computer Vision', 'Image Processing', 'CNN basics', 'Image datasets'],
      },
      {
        levelId: phase1Level2.id,
        sessionNumber: 10,
        title: 'Development Project: Multi-Class Classifier',
        description: 'Complete project: Build a sophisticated classifier for multiple classes using advanced ML techniques.',
        expertVideoUrl: 'https://example.com/videos/dev-project.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/dev-project.pdf',
        coreActivity: 'Complete development level project: Multi-class classification',
        keyConcepts: ['Project integration', 'Advanced models', 'Model comparison', 'Performance optimization'],
      },
    ];

    for (const session of phase1Level2Sessions) {
      try {
        await structureRepo.createSession(session);
      } catch (error: any) {
        console.error(`❌ Error creating Development session ${session.sessionNumber}:`, error.message);
        throw error;
      }
    }
    console.log(`  ✅ Created 10 sessions for Development level\n`);

    // Phase 1 - Level 3: Mastery
    console.log('  Creating Level 3: Mastery...');
    const phase1Level3 = await structureRepo.createLevel({
      phaseId: phase1.id,
      levelType: 'mastery',
      title: 'Mastery: Advanced AI Concepts',
      description: 'Master advanced AI concepts, deep learning, and complex AI systems.',
      sequence: 3,
    });

    const phase1Level3Sessions: CreateSessionInput[] = [
      {
        levelId: phase1Level3.id,
        sessionNumber: 1,
        title: 'Deep Neural Networks',
        description: 'Building deep neural networks: multiple layers, backpropagation, and optimization.',
        expertVideoUrl: 'https://example.com/videos/deep-neural-networks.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/deep-nn.pdf',
        coreActivity: 'Build and train deep neural networks',
        keyConcepts: ['Deep Learning', 'Backpropagation', 'Optimization', 'Vanishing gradients'],
      },
      {
        levelId: phase1Level3.id,
        sessionNumber: 2,
        title: 'Convolutional Neural Networks (CNN)',
        description: 'Understanding CNNs for image processing: convolutions, pooling, and CNN architecture.',
        expertVideoUrl: 'https://example.com/videos/cnn.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/cnn.pdf',
        coreActivity: 'Build CNN models for image recognition',
        keyConcepts: ['CNN', 'Convolutions', 'Pooling', 'Feature maps'],
      },
      {
        levelId: phase1Level3.id,
        sessionNumber: 3,
        title: 'Recurrent Neural Networks (RNN)',
        description: 'Working with sequential data: RNNs, LSTM, and GRU for time series and text.',
        expertVideoUrl: 'https://example.com/videos/rnn.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/rnn.pdf',
        coreActivity: 'Build RNN models for sequence prediction',
        keyConcepts: ['RNN', 'LSTM', 'GRU', 'Sequential data'],
      },
      {
        levelId: phase1Level3.id,
        sessionNumber: 4,
        title: 'Natural Language Processing Basics',
        description: 'Introduction to NLP: text preprocessing, tokenization, and word embeddings.',
        expertVideoUrl: 'https://example.com/videos/nlp-basics.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/nlp-basics.pdf',
        coreActivity: 'Process and analyze text data',
        keyConcepts: ['NLP', 'Tokenization', 'Word embeddings', 'Text preprocessing'],
      },
      {
        levelId: phase1Level3.id,
        sessionNumber: 5,
        title: 'Transfer Learning',
        description: 'Using pre-trained models: transfer learning with ResNet, VGG, and other architectures.',
        expertVideoUrl: 'https://example.com/videos/transfer-learning.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/transfer-learning.pdf',
        coreActivity: 'Apply transfer learning to solve new problems',
        keyConcepts: ['Transfer Learning', 'Pre-trained models', 'Fine-tuning', 'Feature extraction'],
      },
      {
        levelId: phase1Level3.id,
        sessionNumber: 6,
        title: 'Model Deployment',
        description: 'Deploying ML models: saving models, creating APIs, and production deployment.',
        expertVideoUrl: 'https://example.com/videos/model-deployment.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/deployment.pdf',
        coreActivity: 'Deploy a trained model as a web service',
        keyConcepts: ['Model deployment', 'APIs', 'Production', 'Model serving'],
      },
      {
        levelId: phase1Level3.id,
        sessionNumber: 7,
        title: 'Advanced Optimization Techniques',
        description: 'Optimization algorithms: Adam, RMSprop, and advanced training techniques.',
        expertVideoUrl: 'https://example.com/videos/optimization.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/optimization.pdf',
        coreActivity: 'Implement advanced optimization techniques',
        keyConcepts: ['Optimizers', 'Adam', 'RMSprop', 'Learning rate scheduling'],
      },
      {
        levelId: phase1Level3.id,
        sessionNumber: 8,
        title: 'Regularization Techniques',
        description: 'Preventing overfitting: dropout, batch normalization, and L1/L2 regularization.',
        expertVideoUrl: 'https://example.com/videos/regularization.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/regularization.pdf',
        coreActivity: 'Apply regularization techniques to improve model generalization',
        keyConcepts: ['Dropout', 'Batch Normalization', 'L1/L2 Regularization', 'Overfitting'],
      },
      {
        levelId: phase1Level3.id,
        sessionNumber: 9,
        title: 'Advanced Computer Vision',
        description: 'Advanced CV techniques: object detection, image segmentation, and YOLO.',
        expertVideoUrl: 'https://example.com/videos/advanced-cv.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/advanced-cv.pdf',
        coreActivity: 'Implement object detection models',
        keyConcepts: ['Object Detection', 'Image Segmentation', 'YOLO', 'R-CNN'],
      },
      {
        levelId: phase1Level3.id,
        sessionNumber: 10,
        title: 'Mastery Project: AI Application',
        description: 'Complete capstone project: Build a complete AI application from data to deployment.',
        expertVideoUrl: 'https://example.com/videos/mastery-project.mp4',
        learningSheetPdfUrl: 'https://example.com/sheets/mastery-project.pdf',
        coreActivity: 'Complete mastery level capstone project',
        keyConcepts: ['End-to-end project', 'Model development', 'Deployment', 'Documentation'],
      },
    ];

    for (const session of phase1Level3Sessions) {
      try {
        await structureRepo.createSession(session);
      } catch (error: any) {
        console.error(`❌ Error creating Mastery session ${session.sessionNumber}:`, error.message);
        throw error;
      }
    }
    console.log(`  ✅ Created 10 sessions for Mastery level\n`);

    // ============================================================================
    // PHASE 2: ADVANCED CONCEPTS
    // ============================================================================
    console.log('📖 Creating Phase 2: Advanced AI Concepts...');
    const phase2 = await structureRepo.createPhase({
      courseId: course.id,
      title: 'Advanced AI and Deep Learning',
      description: 'Deep dive into advanced AI: transformers, generative models, reinforcement learning, and cutting-edge techniques.',
      sequence: 2,
    });

    // Create 3 levels for Phase 2 (Foundation, Development, Mastery)
    for (let levelSeq = 1; levelSeq <= 3; levelSeq++) {
      const levelType = levelSeq === 1 ? 'foundation' : levelSeq === 2 ? 'development' : 'mastery';
      const levelTitle = levelSeq === 1 ? 'Foundation' : levelSeq === 2 ? 'Development' : 'Mastery';
      
      const level = await structureRepo.createLevel({
        phaseId: phase2.id,
        levelType: levelType as 'foundation' | 'development' | 'mastery',
        title: `${levelTitle}: Advanced AI Concepts`,
        description: `${levelTitle} level of advanced AI and deep learning concepts`,
        sequence: levelSeq,
      });

      for (let i = 1; i <= 10; i++) {
        await structureRepo.createSession({
          levelId: level.id,
          sessionNumber: i,
          title: `Phase 2 ${levelTitle} Session ${i}`,
          description: `Advanced AI concepts - ${levelTitle} level - Session ${i}`,
          expertVideoUrl: `https://example.com/videos/phase2-${levelType}-${i}.mp4`,
          learningSheetPdfUrl: `https://example.com/sheets/phase2-${levelType}-${i}.pdf`,
          coreActivity: `Complete ${levelTitle} activity ${i}`,
          keyConcepts: [`Advanced ${levelTitle} AI Concept ${i}`],
        });
      }
      console.log(`  ✅ Created 10 sessions for ${levelTitle} level`);
    }
    console.log(`✅ Phase 2 created with 30 sessions\n`);

    // ============================================================================
    // PHASE 3: MASTERY AND APPLICATIONS
    // ============================================================================
    console.log('📖 Creating Phase 3: Mastery and Real-World Applications...');
    const phase3 = await structureRepo.createPhase({
      courseId: course.id,
      title: 'AI Mastery and Real-World Applications',
      description: 'Master AI through real-world projects, advanced applications, and cutting-edge research areas.',
      sequence: 3,
    });

    // Create 3 levels for Phase 3
    for (let levelSeq = 1; levelSeq <= 3; levelSeq++) {
      const levelType = levelSeq === 1 ? 'foundation' : levelSeq === 2 ? 'development' : 'mastery';
      const levelTitle = levelSeq === 1 ? 'Foundation' : levelSeq === 2 ? 'Development' : 'Mastery';
      
      const level = await structureRepo.createLevel({
        phaseId: phase3.id,
        levelType: levelType as 'foundation' | 'development' | 'mastery',
        title: `${levelTitle}: Real-World AI Applications`,
        description: `${levelTitle} level focusing on real-world AI applications and projects`,
        sequence: levelSeq,
      });

      for (let i = 1; i <= 10; i++) {
        try {
          await structureRepo.createSession({
            levelId: level.id,
            sessionNumber: i,
            title: `Phase 3 ${levelTitle} Session ${i}`,
            description: `Real-world AI applications - ${levelTitle} level - Session ${i}`,
            expertVideoUrl: `https://example.com/videos/phase3-${levelType}-${i}.mp4`,
            learningSheetPdfUrl: `https://example.com/sheets/phase3-${levelType}-${i}.pdf`,
            coreActivity: `Complete ${levelTitle} real-world AI project ${i}`,
            keyConcepts: [`Real-world ${levelTitle} AI Application ${i}`],
          });
        } catch (error: any) {
          console.error(`❌ Error creating Phase 3 ${levelTitle} session ${i}:`, error.message);
          throw error;
        }
      }
      console.log(`  ✅ Created 10 sessions for ${levelTitle} level`);
    }
    console.log(`✅ Phase 3 created with 30 sessions\n`);

    console.log('🎉 AI Course Created Successfully!');
    console.log(`\n📊 Summary:`);
    console.log(`   Course ID: ${course.id}`);
    console.log(`   Course: ${course.title}`);
    console.log(`   Phases: 3`);
    console.log(`   Levels: 9 (3 per phase)`);
    console.log(`   Sessions: 90 (10 per level)`);
    console.log(`\n✅ Course is ready for students to enroll!`);

  } catch (error: any) {
    console.error('\n❌ Error creating AI course!');
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
  process.stdout.write('🚀 Starting AI Course Creation Script...\n\n');
  
  createAICourse()
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

export { createAICourse };

