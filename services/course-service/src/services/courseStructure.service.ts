/**
 * Course Structure Service
 * 
 * Implements business logic for:
 * - Session access control based on purchase tier
 * - Progress tracking and unlocking
 * - Project submission validation
 * - Visibility rules enforcement
 */

import { CourseStructureRepository } from '../models/courseStructure.model';
import type {
  CoursePhase,
  CourseLevel,
  CourseSession,
  StudentCoursePurchase,
  StudentProgress,
  StudentProject,
  ExamAttempt,
  LevelType,
  SessionPurchaseTier,
  ProjectVisibility,
  ProjectStatus,
} from '../models/courseStructure.model';
import { Exam } from '../models/exam.model';
import { httpPost } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';

export class CourseStructureService {
  constructor(private readonly repository: CourseStructureRepository) {}

  // Expose repository for controller access
  getRepository(): CourseStructureRepository {
    return this.repository;
  }

  // ============================================================================
  // ACCESS CONTROL LOGIC
  // ============================================================================

  /**
   * Determine which sessions should be unlocked based on purchase tier
   * - 10 sessions → Level 1 (Foundation) - Sessions 1-10
   * - 20 sessions → Level 1 + Level 2 (Foundation + Development) - Sessions 1-20
   * - 30 sessions → All 3 levels (Foundation + Development + Mastery) - Sessions 1-30
   */
  private getUnlockedSessionRange(purchaseTier: SessionPurchaseTier): {
    maxLevel: LevelType;
    maxSessionNumber: number;
  } {
    switch (purchaseTier) {
      case 10:
        return { maxLevel: 'foundation', maxSessionNumber: 10 };
      case 20:
        return { maxLevel: 'development', maxSessionNumber: 20 };
      case 30:
        return { maxLevel: 'mastery', maxSessionNumber: 30 };
      default:
        return { maxLevel: 'foundation', maxSessionNumber: 0 };
    }
  }

  /**
   * Check if a session should be unlocked for a student
   */
  private shouldUnlockSession(
    session: CourseSession,
    level: CourseLevel,
    purchaseTier: SessionPurchaseTier
  ): boolean {
    const { maxLevel, maxSessionNumber } = this.getUnlockedSessionRange(purchaseTier);
    
    // Check level type
    const levelOrder: Record<LevelType, number> = {
      foundation: 1,
      development: 2,
      mastery: 3,
    };

    const maxLevelOrder = levelOrder[maxLevel];
    const currentLevelOrder = levelOrder[level.levelType];

    // If current level is beyond max level, lock it
    if (currentLevelOrder > maxLevelOrder) {
      return false;
    }

    // If same level, check session number
    if (currentLevelOrder === maxLevelOrder) {
      return session.sessionNumber <= maxSessionNumber;
    }

    // If earlier level, unlock all sessions
    return true;
  }

  /**
   * Initialize or update student progress for all sessions in a course
   * This should be called after purchase or upgrade
   */
  async initializeStudentAccess(
    studentId: string,
    courseId: string,
    purchaseTier: SessionPurchaseTier
  ): Promise<void> {
    // Get all phases, levels, and sessions for the course
    const phases = await this.repository.getPhasesByCourseId(courseId);
    
    for (const phase of phases) {
      const levels = await this.repository.getLevelsByPhaseId(phase.id);
      
      for (const level of levels) {
        const sessions = await this.repository.getSessionsByLevelId(level.id);
        
        for (const session of sessions) {
          const shouldUnlock = this.shouldUnlockSession(session, level, purchaseTier);
          
          // Get or create progress entry
          const progress = await this.repository.getOrCreateProgress(
            studentId,
            courseId,
            phase.id,
            level.id,
            session.id
          );

          // Update unlock status if needed
          if (shouldUnlock && !progress.isUnlocked) {
            await this.repository.updateProgress(progress.id, {});
            // Manually update unlock status
            await this.repository.getPool().query(
              `UPDATE student_progress 
               SET is_unlocked = true, unlocked_at = NOW(), status = 'not_started'
               WHERE id = $1`,
              [progress.id]
            );
          } else if (!shouldUnlock && progress.isUnlocked) {
            // Lock the session
            await this.repository.getPool().query(
              `UPDATE student_progress 
               SET is_unlocked = false, unlocked_at = NULL, status = 'locked'
               WHERE id = $1`,
              [progress.id]
            );
          }
        }
      }
    }
  }

  /**
   * Check if student can access a specific session
   */
  async canAccessSession(
    studentId: string,
    sessionId: string
  ): Promise<{ canAccess: boolean; reason?: string }> {
    // Get session and its level
    const session = await this.repository.getSessionById(sessionId);
    if (!session) {
      return { canAccess: false, reason: 'Session not found' };
    }

    const level = await this.repository.getLevelById(session.levelId);
    if (!level) {
      return { canAccess: false, reason: 'Level not found' };
    }

    // Get phase
    const phase = await this.repository.getPhaseById(level.phaseId);
    if (!phase) {
      return { canAccess: false, reason: 'Phase not found' };
    }

    // Get active purchase
    const purchase = await this.repository.getActivePurchase(studentId, phase.courseId);
    if (!purchase) {
      return { canAccess: false, reason: 'No active purchase found' };
    }

    // Check if session should be unlocked
    const shouldUnlock = this.shouldUnlockSession(session, level, purchase.purchaseTier);
    
    if (!shouldUnlock) {
      return {
        canAccess: false,
        reason: `This session requires a ${purchase.purchaseTier === 10 ? '20 or 30' : '30'} session purchase`,
      };
    }

    // Get progress to check actual unlock status
    const progress = await this.repository.getOrCreateProgress(
      studentId,
      phase.courseId,
      phase.id,
      level.id,
      sessionId
    );

    if (!progress.isUnlocked) {
      return { canAccess: false, reason: 'Session is locked' };
    }

    return { canAccess: true };
  }

  // ============================================================================
  // PROGRESS TRACKING
  // ============================================================================

  /**
   * Mark video as watched
   */
  async markVideoWatched(studentId: string, sessionId: string): Promise<StudentProgress | null> {
    const progress = await this.getProgressForSession(studentId, sessionId);
    if (!progress) {
      return null;
    }

    return await this.repository.updateProgress(progress.id, {
      videoWatched: true,
    });
  }

  /**
   * Mark learning sheet as previewed (sheets are preview-only, not downloadable)
   */
  async markSheetPreviewed(
    studentId: string,
    sessionId: string
  ): Promise<StudentProgress | null> {
    const progress = await this.getProgressForSession(studentId, sessionId);
    if (!progress) {
      return null;
    }

    return await this.repository.updateProgress(progress.id, {
      sheetPreviewed: true,
    });
  }

  /**
   * Submit quiz results
   */
  async submitQuizResults(
    studentId: string,
    sessionId: string,
    score: number,
    maxScore: number
  ): Promise<StudentProgress | null> {
    const progress = await this.getProgressForSession(studentId, sessionId);
    if (!progress) {
      return null;
    }

    return await this.repository.updateProgress(progress.id, {
      quizCompleted: true,
      quizScore: score,
      quizMaxScore: maxScore,
    });
  }

  /**
   * Get progress for a specific session
   */
  private async getProgressForSession(
    studentId: string,
    sessionId: string
  ): Promise<StudentProgress | null> {
    const session = await this.repository.getSessionById(sessionId);
    if (!session) {
      return null;
    }

    const level = await this.repository.getLevelById(session.levelId);
    if (!level) {
      return null;
    }

    const phase = await this.repository.getPhaseById(level.phaseId);
    if (!phase) {
      return null;
    }

    return await this.repository.getOrCreateProgress(
      studentId,
      phase.courseId,
      phase.id,
      level.id,
      sessionId
    );
  }

  /**
   * Check if student has completed all sessions in a level
   */
  async isLevelCompleted(
    studentId: string,
    levelId: string
  ): Promise<{ completed: boolean; completedSessions: number; totalSessions: number }> {
    const level = await this.repository.getLevelById(levelId);
    if (!level) {
      return { completed: false, completedSessions: 0, totalSessions: 0 };
    }

    const sessions = await this.repository.getSessionsByLevelId(levelId);
    const progressList = await this.repository.getPool().query(
      `SELECT * FROM student_progress
       WHERE student_id = $1 AND level_id = $2`,
      [studentId, levelId]
    );

    const completedCount = progressList.rows.filter(
      (p: any) => p.status === 'completed'
    ).length;

    return {
      completed: completedCount === sessions.length,
      completedSessions: completedCount,
      totalSessions: sessions.length,
    };
  }

  // ============================================================================
  // PROJECT SUBMISSION
  // ============================================================================

  /**
   * Check if student can submit a project for a level
   * Project can only be submitted after completing all 10 sessions in that level
   */
  async canSubmitProject(
    studentId: string,
    levelId: string
  ): Promise<{ canSubmit: boolean; reason?: string }> {
    const levelCompletion = await this.isLevelCompleted(studentId, levelId);
    
    if (!levelCompletion.completed) {
      return {
        canSubmit: false,
        reason: `You must complete all ${levelCompletion.totalSessions} sessions in this level before submitting a project`,
      };
    }

    // Check if project already exists
    const level = await this.repository.getLevelById(levelId);
    if (!level) {
      return { canSubmit: false, reason: 'Level not found' };
    }

    const phase = await this.repository.getPhaseById(level.phaseId);
    if (!phase) {
      return { canSubmit: false, reason: 'Phase not found' };
    }

    const existingProjects = await this.repository.getProjectsByStudent(studentId, phase.courseId);
    const existingProject = existingProjects.find((p) => p.levelId === levelId);

    if (existingProject) {
      return {
        canSubmit: false,
        reason: 'Project already submitted for this level',
      };
    }

    return { canSubmit: true };
  }

  /**
   * Submit a project for a level
   */
  async submitProject(input: {
    studentId: string;
    levelId: string;
    projectVideoUrl: string;
    projectPdfUrl: string;
    title: string;
    description?: string;
  }): Promise<StudentProject> {
    // Validate submission eligibility
    const canSubmit = await this.canSubmitProject(input.studentId, input.levelId);
    if (!canSubmit.canSubmit) {
      throw new Error(canSubmit.reason || 'Cannot submit project');
    }

    // Get level and phase info
    const level = await this.repository.getLevelById(input.levelId);
    if (!level) {
      throw new Error('Level not found');
    }

    const phase = await this.repository.getPhaseById(level.phaseId);
    if (!phase) {
      throw new Error('Phase not found');
    }

    // Create project (visibility is set automatically based on level type)
    return await this.repository.createProject({
      studentId: input.studentId,
      courseId: phase.courseId,
      phaseId: phase.id,
      levelId: input.levelId,
      levelType: level.levelType,
      projectVideoUrl: input.projectVideoUrl,
      projectPdfUrl: input.projectPdfUrl,
      title: input.title,
      description: input.description,
    });
  }

  /**
   * Get projects visible to a user based on visibility rules
   */
  async getVisibleProjects(options: {
    userId?: string; // If provided, include community projects
    isPublic?: boolean; // If true, only return public projects
    limit?: number;
  }): Promise<StudentProject[]> {
    if (options.isPublic || !options.userId) {
      // Public only - for marketing/showcase page
      return await this.repository.getPublicProjects(options.limit || 50);
    }

    // Include community projects for logged-in users
    return await this.repository.getCommunityProjects(options.limit || 50);
  }

  // ============================================================================
  // PURCHASE & UPGRADE
  // ============================================================================

  /**
   * Create a new purchase and initialize access
   */
  async createPurchase(input: {
    studentId: string;
    courseId: string;
    purchaseTier: SessionPurchaseTier;
    expiryDate?: Date;
    metadata?: Record<string, unknown>;
  }): Promise<StudentCoursePurchase> {
    // Check for duplicate order ID in metadata to prevent duplicate purchases
    const orderId = input.metadata?.razorpayOrderId || input.metadata?.razorpay_orderId;
    if (orderId && typeof orderId === 'string') {
      const existingPurchase = await this.repository.getPool().query(
        `SELECT * FROM student_course_purchases
         WHERE student_id = $1 
         AND course_id = $2
         AND (metadata->>'razorpayOrderId' = $3 OR metadata->>'razorpay_orderId' = $3)
         ORDER BY purchase_date DESC
         LIMIT 1`,
        [input.studentId, input.courseId, orderId]
      );

      if (existingPurchase.rows.length > 0) {
        logger.info('Purchase with same order ID already exists, returning existing purchase', {
          orderId,
          purchaseId: existingPurchase.rows[0].id,
          studentId: input.studentId,
          courseId: input.courseId,
          service: 'course-service',
        });
        // Activate the existing purchase if it's not active
        if (!existingPurchase.rows[0].is_active) {
          await this.repository.getPool().query(
            `UPDATE student_course_purchases
             SET is_active = true, updated_at = NOW()
             WHERE id = $1`,
            [existingPurchase.rows[0].id]
          );
          existingPurchase.rows[0].is_active = true;
        }
        // Convert row to StudentCoursePurchase format
        const row = existingPurchase.rows[0];
        return {
          id: row.id,
          studentId: row.student_id,
          courseId: row.course_id,
          purchaseTier: row.purchase_tier,
          purchaseDate: row.purchase_date,
          expiryDate: row.expiry_date,
          metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
          isActive: row.is_active,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      }
    }

    // Check if this is an upgrade
    const isUpgrade = input.metadata?.upgrade === true || input.metadata?.upgrade === 'true';
    
    if (isUpgrade) {
      // For upgrades, update the existing active purchase instead of creating a new one
      const existingPurchase = await this.repository.getActivePurchase(input.studentId, input.courseId);
      
      if (existingPurchase) {
        // Calculate new tier: current tier + additional sessions
        // Use additionalSessions from metadata if available, otherwise calculate from purchaseTier
        const additionalSessions = (input.metadata?.additionalSessions as number) || 
          (input.purchaseTier - existingPurchase.purchaseTier);
        const newTier = existingPurchase.purchaseTier + additionalSessions;
        
        logger.info('Upgrade detected: Updating existing purchase', {
          purchaseId: existingPurchase.id,
          studentId: input.studentId,
          courseId: input.courseId,
          fromTier: existingPurchase.purchaseTier,
          toTier: newTier,
          additionalSessions,
          service: 'course-service',
        });
        
        // Update the existing purchase with calculated new tier
        const updated = await this.repository.upgradePurchase(existingPurchase.id, newTier as 10 | 20 | 30);
        
        if (updated) {
          // Update metadata to include upgrade info
          const updatedMetadata = {
            ...(existingPurchase.metadata || {}),
            ...(input.metadata || {}),
            upgrade: true,
            previousPurchaseTier: existingPurchase.purchaseTier,
            upgradedAt: new Date().toISOString(),
          };
          
          // Update metadata in database
          await this.repository.getPool().query(
            `UPDATE student_course_purchases
             SET metadata = $1
             WHERE id = $2`,
            [JSON.stringify(updatedMetadata), updated.id]
          );
          
          // Re-initialize access with new tier
          await this.initializeStudentAccess(
            input.studentId,
            input.courseId,
            input.purchaseTier
          );

          // Invalidate student cache after upgrade
          await this.invalidateStudentCache(input.studentId).catch((error) => {
            logger.warn('Failed to invalidate student cache after upgrade (non-critical)', {
              error: error instanceof Error ? error.message : String(error),
              studentId: input.studentId,
              service: 'course-service',
            });
          });
          
          return updated;
        }
      }
    }
    
    // Check if there's an active purchase for the same cycle (prevent duplicate purchases)
    const cycleId = input.metadata?.cycleId || input.metadata?.cycleNo || input.metadata?.cycleTitle;
    if (cycleId && !isUpgrade) {
      const existingActivePurchase = await this.repository.getActivePurchase(input.studentId, input.courseId);
      
      if (existingActivePurchase) {
        const existingMeta = existingActivePurchase.metadata as Record<string, unknown> | null;
        const existingCycleId = existingMeta?.cycleId || existingMeta?.cycleNo || existingMeta?.cycleTitle;
        
        // Normalize cycle IDs for comparison
        const normalizeCycleId = (raw: unknown): string | null => {
          if (!raw || typeof raw !== 'string') return null;
          const trimmed = raw.trim().toLowerCase();
          if (trimmed === 'cycle-1' || trimmed === '1' || trimmed.includes('cycle 1')) return 'cycle-1';
          if (trimmed === 'cycle-2' || trimmed === '2' || trimmed.includes('cycle 2')) return 'cycle-2';
          if (trimmed === 'cycle-3' || trimmed === '3' || trimmed.includes('cycle 3')) return 'cycle-3';
          return trimmed;
        };
        
        const normalizedExisting = normalizeCycleId(existingCycleId);
        const normalizedNew = normalizeCycleId(cycleId);
        
        // If same cycle and purchase tier is less than 30, treat as upgrade
        if (normalizedExisting && normalizedNew && normalizedExisting === normalizedNew && existingActivePurchase.purchaseTier < 30) {
          logger.info('Duplicate purchase detected for same cycle, treating as upgrade', {
            studentId: input.studentId,
            courseId: input.courseId,
            existingTier: existingActivePurchase.purchaseTier,
            newTier: input.purchaseTier,
            cycleId,
            service: 'course-service',
          });
          
          // Calculate additional sessions
          const additionalSessions = input.purchaseTier - existingActivePurchase.purchaseTier;
          const newTier = Math.min(existingActivePurchase.purchaseTier + additionalSessions, 30) as 10 | 20 | 30;
          
          // Update existing purchase as upgrade
          const updated = await this.repository.upgradePurchase(existingActivePurchase.id, newTier);
          
          if (updated) {
            const updatedMetadata = {
              ...(existingMeta || {}),
              ...(input.metadata || {}),
              upgrade: true,
              previousPurchaseTier: existingActivePurchase.purchaseTier,
              additionalSessions,
              upgradedAt: new Date().toISOString(),
            };
            
            await this.repository.getPool().query(
              `UPDATE student_course_purchases
               SET metadata = $1
               WHERE id = $2`,
              [JSON.stringify(updatedMetadata), updated.id]
            );
            
            await this.initializeStudentAccess(
              input.studentId,
              input.courseId,
              newTier
            );

            // Invalidate student cache after upgrade
            await this.invalidateStudentCache(input.studentId).catch((error) => {
              logger.warn('Failed to invalidate student cache after upgrade (non-critical)', {
                error: error instanceof Error ? error.message : String(error),
                studentId: input.studentId,
                service: 'course-service',
              });
            });
            
            return updated;
          }
        } else if (normalizedExisting && normalizedNew && normalizedExisting === normalizedNew && existingActivePurchase.purchaseTier >= 30) {
          // Already has full tier (30 sessions) for this cycle - prevent duplicate
          throw new Error(`You already have the maximum sessions (30) for this cycle. Please complete all sessions before purchasing again.`);
        }
      }
    }
    
    // For new purchases, deactivate any existing purchases for this course
    await this.repository.getPool().query(
      `UPDATE student_course_purchases
       SET is_active = false
       WHERE student_id = $1 AND course_id = $2`,
      [input.studentId, input.courseId]
    );

    // Create new purchase
    const purchase = await this.repository.createPurchase(input);

    // Initialize student access
    await this.initializeStudentAccess(
      input.studentId,
      input.courseId,
      input.purchaseTier
    );

    // Invalidate student cache so purchased course appears immediately
    await this.invalidateStudentCache(input.studentId).catch((error) => {
      logger.warn('Failed to invalidate student cache (non-critical)', {
        error: error instanceof Error ? error.message : String(error),
        studentId: input.studentId,
        service: 'course-service',
      });
    });

    return purchase;
  }

  /**
   * Upgrade existing purchase to higher tier
   */
  async upgradePurchase(
    purchaseId: string,
    newTier: SessionPurchaseTier
  ): Promise<StudentCoursePurchase | null> {
    const purchase = await this.repository.getPool().query(
      `SELECT * FROM student_course_purchases WHERE id = $1`,
      [purchaseId]
    );

    if (purchase.rows.length === 0) {
      return null;
    }

    const currentPurchase = purchase.rows[0];
    
    // Can only upgrade to higher tier
    if (newTier <= currentPurchase.purchase_tier) {
      throw new Error('Can only upgrade to a higher tier');
    }

    // Update purchase
    const updated = await this.repository.upgradePurchase(purchaseId, newTier);

    // Re-initialize access with new tier
    if (updated) {
      await this.initializeStudentAccess(
        updated.studentId,
        updated.courseId,
        newTier
      );
    }

    return updated;
  }

  /**
   * Get active purchase for a student and course
   */
  async getActivePurchase(
    studentId: string,
    courseId: string
  ): Promise<StudentCoursePurchase | null> {
    return await this.repository.getActivePurchase(studentId, courseId);
  }

  // ============================================================================
  // TRAINER OPERATIONS
  // ============================================================================

  /**
   * Assign trainer to review a project
   */
  async assignTrainerToProject(
    projectId: string,
    trainerId: string
  ): Promise<StudentProject | null> {
    const project = await this.repository.getProjectById(projectId);
    if (!project) {
      return null;
    }

    return await this.repository.updateProjectReview(projectId, {
      status: 'pending',
      trainerId,
    });
  }

  /**
   * Submit trainer review for a project
   */
  async submitProjectReview(
    projectId: string,
    trainerId: string,
    status: ProjectStatus,
    feedback?: string,
    rating?: number
  ): Promise<StudentProject | null> {
    return await this.repository.updateProjectReview(projectId, {
      status,
      trainerId,
      trainerFeedback: feedback,
      trainerRating: rating,
    });
  }

  /**
   * Get projects assigned to a trainer
   */
  async getTrainerProjects(
    trainerId: string,
    status?: ProjectStatus
  ): Promise<StudentProject[]> {
    let query = `SELECT * FROM student_projects WHERE trainer_id = $1`;
    const params: any[] = [trainerId];

    if (status) {
      query += ` AND status = $2`;
      params.push(status);
    }

    return await this.repository.getProjectsByTrainer(trainerId, status);
  }

  /**
   * Invalidate student cache after purchase creation
   * This ensures purchased courses appear immediately in student screens
   */
  private async invalidateStudentCache(studentId: string): Promise<void> {
    try {
      const studentServiceUrl = process.env.STUDENT_SERVICE_URL || 
        `http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.STUDENT_SERVICE_PORT || 3003}`;
      
      const cacheInvalidationUrl = `${studentServiceUrl}/api/students/${studentId}/invalidate-cache`;
      
      // Fire-and-forget cache invalidation (non-blocking)
      httpPost(cacheInvalidationUrl, {}, { timeout: 5000 })
        .then((response) => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            logger.debug('Successfully invalidated cache for student', {
              studentId,
              service: 'course-service',
            });
          } else {
            logger.warn('Cache invalidation returned non-success status', {
              statusCode: response.statusCode,
              studentId,
              service: 'course-service',
            });
          }
        })
        .catch((error) => {
          logger.warn('Cache invalidation failed (non-critical)', {
            studentId,
            error: error instanceof Error ? error.message : String(error),
            service: 'course-service',
          });
        });
      // Continue without awaiting - cache invalidation is non-critical
    } catch (error: any) {
      // Don't throw - cache invalidation failure shouldn't fail purchase creation
      logger.warn('Failed to invalidate cache for student', {
        error: error?.message || String(error),
        stack: error instanceof Error ? error.stack : undefined,
        studentId,
        service: 'course-service',
      });
    }
  }

  // ============================================================================
  // EXAM OPERATIONS
  // ============================================================================

  /**
   * Get exam questions for a level
   */
  async getExamQuestions(levelId: string): Promise<{
    questions: any[];
    maxAttempts: number;
    timeLimit?: number;
  }> {
    const exam = await Exam.findOne({ levelId });
    if (!exam) {
      throw new Error('Exam not found for this level');
    }

    return {
      questions: exam.questions,
      maxAttempts: exam.maxAttempts || 3,
    };
  }

  /**
   * Submit exam answers and calculate score
   */
  async submitExam(input: {
    studentId: string;
    levelId: string;
    answers: Array<{ questionId: string; selectedAnswerIndex: number }>;
  }): Promise<{
    attemptNumber: number;
    score: number;
    maxScore: number;
    percentage: number;
    certificateType?: 'normal' | 'excellence' | null;
    nextAttemptDate?: string;
    canAttempt: boolean;
  }> {
    // Get exam questions
    const exam = await Exam.findOne({ levelId: input.levelId });
    if (!exam) {
      throw new Error('Exam not found for this level');
    }

    // Get existing attempts
    const existingAttempts = await this.repository.getExamAttempts(
      input.studentId,
      input.levelId
    );

    // Check if max attempts reached
    if (existingAttempts.length >= 3) {
      throw new Error('Maximum attempts reached');
    }

    // Check 1-day gap requirement
    if (existingAttempts.length > 0) {
      const lastAttempt = existingAttempts[existingAttempts.length - 1];
      const oneDayInMs = 24 * 60 * 60 * 1000;
      const timeSinceLastAttempt = Date.now() - new Date(lastAttempt.completedAt).getTime();
      
      if (timeSinceLastAttempt < oneDayInMs) {
        const nextAttemptDate = new Date(
          new Date(lastAttempt.completedAt).getTime() + oneDayInMs
        );
        throw new Error(
          `You must wait 1 day between attempts. Next attempt available: ${nextAttemptDate.toISOString()}`
        );
      }
    }

    // Calculate score
    let score = 0;
    const maxScore = 150; // 30 questions * 5 points each

    exam.questions.forEach((question) => {
      const answer = input.answers.find((a) => a.questionId === question.id);
      
      if (!answer) {
        // Unattempted: 0 points
        return;
      }

      if (answer.selectedAnswerIndex === question.correctAnswerIndex) {
        // Correct: +5 points
        score += 5;
      } else {
        // Wrong: -1 point
        score -= 1;
      }
    });

    // Ensure score is not negative
    score = Math.max(0, score);

    const percentage = (score / maxScore) * 100;
    const attemptNumber = existingAttempts.length + 1;

    // Determine certificate type
    let certificateType: 'normal' | 'excellence' | null = null;
    if (percentage >= 80) {
      certificateType = 'excellence'; // 80% or above
    } else if (percentage >= 50) {
      certificateType = 'normal'; // 50% or above
    }

    // Create exam attempt
    await this.repository.createExamAttempt({
      studentId: input.studentId,
      levelId: input.levelId,
      attemptNumber,
      score,
      maxScore,
      percentage,
      answers: input.answers,
      certificateType,
    });

    // Calculate next attempt date (1 day from now)
    const nextAttemptDate = new Date(Date.now() + 24 * 60 * 60 * 1000);

    return {
      attemptNumber,
      score,
      maxScore,
      percentage,
      certificateType,
      nextAttemptDate: attemptNumber < 3 ? nextAttemptDate.toISOString() : undefined,
      canAttempt: attemptNumber < 3,
    };
  }

  /**
   * Get exam attempt history
   */
  async getExamAttempts(studentId: string, levelId: string): Promise<{
    attempts: Array<{
      attemptNumber: number;
      score: number;
      maxScore: number;
      completedAt: string;
    }>;
    canAttempt: boolean;
    nextAttemptDate?: string;
    remainingAttempts: number;
  }> {
    const attempts = await this.repository.getExamAttempts(studentId, levelId);
    
    const canAttempt = attempts.length < 3;
    let nextAttemptDate: string | undefined;

    // Calculate next attempt date if there are attempts
    if (attempts.length > 0 && attempts.length < 3) {
      const lastAttempt = attempts[attempts.length - 1];
      const oneDayInMs = 24 * 60 * 60 * 1000;
      const nextDate = new Date(
        new Date(lastAttempt.completedAt).getTime() + oneDayInMs
      );
      
      // Check if 1 day has passed
      if (Date.now() >= nextDate.getTime()) {
        // Can attempt now
        nextAttemptDate = undefined;
      } else {
        nextAttemptDate = nextDate.toISOString();
      }
    }

    return {
      attempts: attempts.map((a) => ({
        attemptNumber: a.attemptNumber,
        score: a.score,
        maxScore: a.maxScore,
        completedAt: a.completedAt.toISOString(),
      })),
      canAttempt: canAttempt && (!nextAttemptDate || Date.now() >= new Date(nextAttemptDate).getTime()),
      nextAttemptDate,
      remainingAttempts: Math.max(0, 3 - attempts.length),
    };
  }
}

