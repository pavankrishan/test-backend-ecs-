/**
 * Quiz Repository
 * Handles quiz operations in MongoDB
 */

import { Quiz, IQuiz, MCQQuestion } from '../models/quiz.model';
import { getMongoConnection } from '../config/database';

export interface CreateQuizInput {
  sessionId: string; // PostgreSQL UUID of the session
  questions: MCQQuestion[]; // 12-25 questions
  passingScore?: number;
}

export class QuizRepository {
  /**
   * Ensure MongoDB connection is ready before operations
   * CRITICAL: With bufferCommands=false, queries fail immediately if connection isn't ready
   * This method ensures the connection is fully established and verified before any query
   * 
   * getMongoConnection() guarantees:
   * 1. Connection is established (readyState === 1)
   * 2. Database object is available
   * 3. Connection passes ping verification
   * 4. All models using the mongoose singleton can be safely queried
   */
  private async ensureConnection(): Promise<void> {
    await getMongoConnection();
    // Connection is now guaranteed to be ready for queries
    // All models registered on the mongoose singleton can be used safely
  }

  /**
   * Create a new quiz for a session
   */
  async create(input: CreateQuizInput): Promise<IQuiz> {
    await this.ensureConnection();
    
    const quiz = new Quiz({
      sessionId: input.sessionId,
      questions: input.questions,
      passingScore: input.passingScore,
    });

    // Calculate totalPoints (will also be calculated in pre-save hook)
    quiz.totalPoints = input.questions.reduce((sum, q) => sum + (q.points || 1), 0);

    return await quiz.save();
  }

  /**
   * Get quiz by session ID
   */
  async findBySessionId(sessionId: string): Promise<IQuiz | null> {
    await this.ensureConnection();
    return await Quiz.findOne({ sessionId }).exec();
  }

  /**
   * Get quiz by ID
   */
  async findById(quizId: string): Promise<IQuiz | null> {
    await this.ensureConnection();
    return await Quiz.findById(quizId).exec();
  }

  /**
   * Update quiz
   */
  async update(quizId: string, updates: Partial<CreateQuizInput>): Promise<IQuiz | null> {
    await this.ensureConnection();
    
    const quiz = await Quiz.findById(quizId).exec();
    if (!quiz) {
      return null;
    }

    if (updates.questions) {
      quiz.questions = updates.questions;
      quiz.totalPoints = updates.questions.reduce((sum, q) => sum + (q.points || 1), 0);
    }

    if (updates.passingScore !== undefined) {
      quiz.passingScore = updates.passingScore;
    }

    return await quiz.save();
  }

  /**
   * Delete quiz
   */
  async delete(quizId: string): Promise<boolean> {
    await this.ensureConnection();
    
    const result = await Quiz.deleteOne({ _id: quizId }).exec();
    return (result.deletedCount ?? 0) > 0;
  }

  /**
   * Delete quiz by session ID
   */
  async deleteBySessionId(sessionId: string): Promise<boolean> {
    await this.ensureConnection();
    
    const result = await Quiz.deleteOne({ sessionId }).exec();
    return (result.deletedCount ?? 0) > 0;
  }
}

