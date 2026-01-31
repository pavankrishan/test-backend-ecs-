/**
 * Course Structure Controller - HTTP Request Handlers
 * Handles phases, levels, sessions, purchases, progress, and projects
 */

import { Request, Response } from 'express';
import { CourseStructureService } from '../services/courseStructure.service';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import logger from '@kodingcaravan/shared/config/logger';
import { QuizRepository } from '../repositories/quiz.repository';
import type {
  CreatePhaseInput,
  CreateLevelInput,
  CreateSessionInput,
  CreatePurchaseInput,
  SessionPurchaseTier,
  ProjectStatus,
} from '../models/courseStructure.model';

export class CourseStructureController {
  private quizRepository: QuizRepository;

  constructor(private courseStructureService: CourseStructureService) {
    this.quizRepository = new QuizRepository();
  }

  // ============================================================================
  // PHASE OPERATIONS
  // ============================================================================

  /**
   * POST /api/v1/courses/:courseId/phases
   * Create a new phase
   */
  createPhase = async (req: Request, res: Response) => {
    try {
      const { courseId } = req.params;
      const data: CreatePhaseInput = {
        ...req.body,
        courseId,
      };
      const phase = await this.courseStructureService.getRepository().createPhase(data);
      return successResponse(res, {
        statusCode: 201,
        message: 'Phase created successfully',
        data: phase,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to create phase',
      });
    }
  };

  /**
   * GET /api/v1/courses/:courseId/phases
   * Get all phases for a course
   */
  getPhases = async (req: Request, res: Response) => {
    try {
      const { courseId } = req.params;
      const phases = await this.courseStructureService.getRepository().getPhasesByCourseId(courseId);
      return successResponse(res, {
        message: 'Phases retrieved successfully',
        data: phases,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to retrieve phases',
      });
    }
  };

  // ============================================================================
  // LEVEL OPERATIONS
  // ============================================================================

  /**
   * POST /api/v1/phases/:phaseId/levels
   * Create a new level
   */
  createLevel = async (req: Request, res: Response) => {
    try {
      const { phaseId } = req.params;
      const data: CreateLevelInput = {
        ...req.body,
        phaseId,
      };
      const level = await this.courseStructureService.getRepository().createLevel(data);
      return successResponse(res, {
        statusCode: 201,
        message: 'Level created successfully',
        data: level,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to create level',
      });
    }
  };

  /**
   * GET /api/v1/phases/:phaseId/levels
   * Get all levels for a phase
   */
  getLevels = async (req: Request, res: Response) => {
    try {
      const { phaseId } = req.params;
      const levels = await this.courseStructureService.getRepository().getLevelsByPhaseId(phaseId);
      return successResponse(res, {
        message: 'Levels retrieved successfully',
        data: levels,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to retrieve levels',
      });
    }
  };

  // ============================================================================
  // SESSION OPERATIONS
  // ============================================================================

  /**
   * POST /api/v1/levels/:levelId/sessions
   * Create a new session
   */
  createSession = async (req: Request, res: Response) => {
    try {
      const { levelId } = req.params;
      const data: CreateSessionInput = {
        ...req.body,
        levelId,
      };
      const session = await this.courseStructureService.getRepository().createSession(data);
      return successResponse(res, {
        statusCode: 201,
        message: 'Session created successfully',
        data: session,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to create session',
      });
    }
  };

  /**
   * GET /api/v1/levels/:levelId/sessions
   * Get all sessions for a level
   */
  getSessions = async (req: Request, res: Response) => {
    try {
      const { levelId } = req.params;
      const sessions = await this.courseStructureService.getRepository().getSessionsByLevelId(levelId);
      return successResponse(res, {
        message: 'Sessions retrieved successfully',
        data: sessions,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to retrieve sessions',
      });
    }
  };

  /**
   * GET /api/v1/courses/:courseId/structure
   * PRODUCTION OPTIMIZATION: Get complete course structure (phases, levels, sessions) in single optimized query
   * This endpoint replaces multiple sequential API calls with one efficient batch call for 600K+ users scale
   */
  getCompleteCourseStructure = async (req: Request, res: Response) => {
    try {
      const { courseId } = req.params;
      
      logger.debug('getCompleteCourseStructure called', {
        courseId,
        correlationId: (req as any).correlationId,
        service: 'course-service',
      });
      
      const structure = await this.courseStructureService.getRepository().getCompleteCourseStructure(courseId);
      
      logger.debug('Structure retrieved', {
        courseId,
        phasesCount: structure.phases?.length || 0,
        levelsCount: structure.levels?.length || 0,
        sessionsCount: structure.sessions?.length || 0,
        correlationId: (req as any).correlationId,
        service: 'course-service',
      });
      
      // Transform sessions to map S3 keys to URLs for frontend compatibility
      const transformedStructure = {
        ...structure,
        sessions: structure.sessions.map((session: any) => ({
          ...session,
          // Map S3 keys to URLs (frontend expects expertVideoUrl/learningSheetPdfUrl)
          expertVideoUrl: session.expertVideoS3Key || null,
          learningSheetPdfUrl: session.learningSheetPdfS3Key || null,
        })),
      };
      
      return successResponse(res, {
        message: 'Course structure retrieved successfully',
        data: transformedStructure,
      });
    } catch (error: any) {
      logger.error('getCompleteCourseStructure error', {
        courseId: req.params.courseId,
        error: error?.message || String(error),
        stack: error?.stack,
        correlationId: (req as any).correlationId,
        service: 'course-service',
      });
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to retrieve course structure',
      });
    }
  };

  /**
   * GET /api/v1/sessions/:sessionId
   * Get session by ID with quiz questions
   */
  getSessionById = async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const session = await this.courseStructureService.getRepository().getSessionById(sessionId);
      if (!session) {
        return errorResponse(res, {
          statusCode: 404,
          message: 'Session not found',
        });
      }

      // Fetch quiz questions from MongoDB if quizId exists
      let mcqQuestions = null;
      if (session.quizId) {
        try {
          logger.debug('Fetching quiz by quizId', {
            sessionId,
            quizId: session.quizId,
            correlationId: (req as any).correlationId,
            service: 'course-service',
          });
          const quiz = await this.quizRepository.findById(session.quizId);
          if (quiz && quiz.questions) {
            mcqQuestions = quiz.questions;
            logger.debug('Found quiz questions via quizId', {
              sessionId,
              quizId: session.quizId,
              questionsCount: quiz.questions.length,
              correlationId: (req as any).correlationId,
              service: 'course-service',
            });
          } else {
            logger.debug('Quiz found but no questions', {
              sessionId,
              quizId: session.quizId,
              correlationId: (req as any).correlationId,
              service: 'course-service',
            });
          }
        } catch (quizError: any) {
          // Log error but don't fail the request - quiz might not exist yet
          logger.warn('Failed to fetch quiz by quizId', {
            sessionId,
            quizId: session.quizId,
            error: quizError?.message || String(quizError),
            correlationId: (req as any).correlationId,
            service: 'course-service',
          });
        }
      }

      // Also try fetching by sessionId as fallback (in case quizId wasn't set)
      if (!mcqQuestions) {
        try {
          logger.debug('Trying to fetch quiz by sessionId', {
            sessionId,
            correlationId: (req as any).correlationId,
            service: 'course-service',
          });
          const quiz = await this.quizRepository.findBySessionId(sessionId);
          if (quiz && quiz.questions) {
            mcqQuestions = quiz.questions;
            logger.debug('Found quiz questions via sessionId', {
              sessionId,
              questionsCount: quiz.questions.length,
              correlationId: (req as any).correlationId,
              service: 'course-service',
            });
            // Update session with quizId for future requests
            if (!session.quizId && quiz._id) {
              await this.courseStructureService.getRepository().updateSessionQuizId(sessionId, quiz._id.toString());
              logger.debug('Updated session with quizId', {
                sessionId,
                quizId: quiz._id.toString(),
                correlationId: (req as any).correlationId,
                service: 'course-service',
              });
            }
          } else {
            logger.debug('No quiz found for sessionId', {
              sessionId,
              correlationId: (req as any).correlationId,
              service: 'course-service',
            });
          }
        } catch (quizError: any) {
          // No quiz found - that's okay, session just doesn't have a quiz yet
          logger.debug('Error fetching quiz by sessionId', {
            sessionId,
            error: quizError?.message || String(quizError),
            correlationId: (req as any).correlationId,
            service: 'course-service',
          });
        }
      }

      // Prepare response with quiz questions
      const sessionResponse = {
        ...session,
        mcqQuestions: mcqQuestions || null,
        // Map S3 keys to URLs (if needed - adjust based on your S3 setup)
        expertVideoUrl: session.expertVideoS3Key || null,
        learningSheetPdfUrl: session.learningSheetPdfS3Key || null,
      };

      return successResponse(res, {
        message: 'Session retrieved successfully',
        data: sessionResponse,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to retrieve session',
      });
    }
  };

  // ============================================================================
  // PURCHASE OPERATIONS
  // ============================================================================

  /**
   * POST /api/v1/purchases
   * Create a new purchase
   */
  createPurchase = async (req: Request, res: Response) => {
    try {
      const studentId = (req as any).user?.userId || req.body.studentId;
      if (!studentId) {
        return errorResponse(res, {
          statusCode: 401,
          message: 'Student ID is required',
        });
      }

      const data: CreatePurchaseInput = {
        studentId,
        courseId: req.body.courseId,
        purchaseTier: req.body.purchaseTier as SessionPurchaseTier,
        expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : undefined,
        metadata: req.body.metadata || undefined, // Store all payment details (sessionCount, timeSlot, classType, etc.)
      };

      const purchase = await this.courseStructureService.createPurchase(data);
      return successResponse(res, {
        statusCode: 201,
        message: 'Purchase created successfully',
        data: purchase,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to create purchase',
      });
    }
  };

  /**
   * POST /api/v1/purchases/:purchaseId/upgrade
   * Upgrade purchase to higher tier
   */
  upgradePurchase = async (req: Request, res: Response) => {
    try {
      const { purchaseId } = req.params;
      const newTier = req.body.purchaseTier as SessionPurchaseTier;

      if (![10, 20, 30].includes(newTier)) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'Invalid purchase tier. Must be 10, 20, or 30',
        });
      }

      const purchase = await this.courseStructureService.upgradePurchase(purchaseId, newTier);
      if (!purchase) {
        return errorResponse(res, {
          statusCode: 404,
          message: 'Purchase not found',
        });
      }

      return successResponse(res, {
        message: 'Purchase upgraded successfully',
        data: purchase,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to upgrade purchase',
      });
    }
  };

  /**
   * GET /api/v1/students/:studentId/courses/:courseId/purchase
   * Get active purchase for a student and course
   */
  getPurchase = async (req: Request, res: Response) => {
    try {
      const { studentId, courseId } = req.params;
      const purchase = await this.courseStructureService.getActivePurchase(studentId, courseId);
      
      if (!purchase) {
        return errorResponse(res, {
          statusCode: 404,
          message: 'No active purchase found for this course',
        });
      }

      return successResponse(res, {
        message: 'Purchase retrieved successfully',
        data: purchase,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to retrieve purchase',
      });
    }
  };

  /**
   * GET /api/v1/students/:studentId/courses/:courseId/access
   * Check if student can access a session
   */
  checkAccess = async (req: Request, res: Response) => {
    try {
      const { studentId, sessionId } = req.params;
      const access = await this.courseStructureService.canAccessSession(studentId, sessionId);
      return successResponse(res, {
        message: access.canAccess ? 'Access granted' : 'Access denied',
        data: access,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to check access',
      });
    }
  };

  // ============================================================================
  // PROGRESS OPERATIONS
  // ============================================================================

  /**
   * POST /api/v1/progress/video-watched
   * Mark video as watched
   */
  markVideoWatched = async (req: Request, res: Response) => {
    try {
      const studentId = (req as any).user?.userId || req.body.studentId;
      const { sessionId } = req.body;

      if (!studentId || !sessionId) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'Student ID and Session ID are required',
        });
      }

      const progress = await this.courseStructureService.markVideoWatched(studentId, sessionId);
      if (!progress) {
        return errorResponse(res, {
          statusCode: 404,
          message: 'Progress not found',
        });
      }

      return successResponse(res, {
        message: 'Video marked as watched',
        data: progress,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to mark video as watched',
      });
    }
  };

  /**
   * POST /api/v1/progress/sheet-previewed
   * Mark sheet as previewed (sheets are preview-only, not downloadable)
   */
  markSheetPreviewed = async (req: Request, res: Response) => {
    try {
      const studentId = (req as any).user?.userId || req.body.studentId;
      const { sessionId } = req.body;

      if (!studentId || !sessionId) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'Student ID and Session ID are required',
        });
      }

      const progress = await this.courseStructureService.markSheetPreviewed(studentId, sessionId);
      if (!progress) {
        return errorResponse(res, {
          statusCode: 404,
          message: 'Progress not found',
        });
      }

      return successResponse(res, {
        message: 'Sheet marked as previewed',
        data: progress,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to mark sheet as previewed',
      });
    }
  };

  /**
   * POST /api/v1/progress/quiz
   * Submit quiz results
   */
  submitQuizResults = async (req: Request, res: Response) => {
    try {
      const studentId = (req as any).user?.userId || req.body.studentId;
      const { sessionId, score, maxScore } = req.body;

      if (!studentId || !sessionId || score === undefined || maxScore === undefined) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'Student ID, Session ID, score, and maxScore are required',
        });
      }

      const progress = await this.courseStructureService.submitQuizResults(
        studentId,
        sessionId,
        score,
        maxScore
      );
      if (!progress) {
        return errorResponse(res, {
          statusCode: 404,
          message: 'Progress not found',
        });
      }

      return successResponse(res, {
        message: 'Quiz results submitted successfully',
        data: progress,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to submit quiz results',
      });
    }
  };

  /**
   * GET /api/v1/students/:studentId/courses/:courseId/progress
   * Get student progress for a course
   */
  getStudentProgress = async (req: Request, res: Response) => {
    try {
      const { studentId, courseId } = req.params;
      const progress = await this.courseStructureService.getRepository().getStudentProgressByCourse(
        studentId,
        courseId
      );
      return successResponse(res, {
        message: 'Progress retrieved successfully',
        data: progress,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to retrieve progress',
      });
    }
  };

  /**
   * GET /api/v1/levels/:levelId/completion
   * Check if level is completed
   */
  checkLevelCompletion = async (req: Request, res: Response) => {
    try {
      const { levelId } = req.params;
      const studentId = (req as any).user?.userId || req.query.studentId as string;

      if (!studentId) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'Student ID is required',
        });
      }

      const completion = await this.courseStructureService.isLevelCompleted(studentId, levelId);
      return successResponse(res, {
        message: 'Level completion status retrieved',
        data: completion,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to check level completion',
      });
    }
  };

  // ============================================================================
  // PROJECT OPERATIONS
  // ============================================================================

  /**
   * POST /api/v1/projects
   * Submit a project
   */
  submitProject = async (req: Request, res: Response) => {
    try {
      const studentId = (req as any).user?.userId || req.body.studentId;
      const { levelId, projectVideoUrl, projectPdfUrl, title, description, imageUrls } = req.body;

      if (!studentId || !levelId || !projectVideoUrl || !projectPdfUrl || !title) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'Student ID, Level ID, project video URL, PDF URL, and title are required',
        });
      }

      // Use first image URL as PDF URL if provided, otherwise use projectPdfUrl
      const finalPdfUrl = (imageUrls && imageUrls.length > 0) ? imageUrls[0] : projectPdfUrl;

      const project = await this.courseStructureService.submitProject({
        studentId,
        levelId,
        projectVideoUrl,
        projectPdfUrl: finalPdfUrl,
        title,
        description,
      });

      return successResponse(res, {
        statusCode: 201,
        message: 'Project submitted successfully',
        data: project,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to submit project',
      });
    }
  };

  /**
   * GET /api/v1/projects/public
   * Get public projects (for marketing/showcase page)
   */
  getPublicProjects = async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const projects = await this.courseStructureService.getVisibleProjects({
        isPublic: true,
        limit,
      });
      return successResponse(res, {
        message: 'Public projects retrieved successfully',
        data: projects,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to retrieve public projects',
      });
    }
  };

  /**
   * GET /api/v1/projects/community
   * Get community projects (for logged-in users)
   */
  getCommunityProjects = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.userId;
      const limit = parseInt(req.query.limit as string) || 50;
      const projects = await this.courseStructureService.getVisibleProjects({
        userId,
        limit,
      });
      return successResponse(res, {
        message: 'Community projects retrieved successfully',
        data: projects,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to retrieve community projects',
      });
    }
  };

  /**
   * GET /api/v1/students/:studentId/projects
   * Get student's projects
   */
  getStudentProjects = async (req: Request, res: Response) => {
    try {
      const { studentId } = req.params;
      const courseId = req.query.courseId as string | undefined;
      const projects = await this.courseStructureService.getRepository().getProjectsByStudent(
        studentId,
        courseId
      );
      return successResponse(res, {
        message: 'Student projects retrieved successfully',
        data: projects,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to retrieve student projects',
      });
    }
  };

  /**
   * POST /api/v1/projects/:projectId/review
   * Trainer review a project
   */
  reviewProject = async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const trainerId = (req as any).user?.userId || req.body.trainerId;
      const { status, feedback, rating } = req.body;

      if (!trainerId || !status) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'Trainer ID and status are required',
        });
      }

      const project = await this.courseStructureService.submitProjectReview(
        projectId,
        trainerId,
        status as ProjectStatus,
        feedback,
        rating
      );

      if (!project) {
        return errorResponse(res, {
          statusCode: 404,
          message: 'Project not found',
        });
      }

      return successResponse(res, {
        message: 'Project reviewed successfully',
        data: project,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to review project',
      });
    }
  };

  /**
   * GET /api/v1/trainers/:trainerId/projects
   * Get projects assigned to a trainer
   */
  getTrainerProjects = async (req: Request, res: Response) => {
    try {
      const { trainerId } = req.params;
      const status = req.query.status as ProjectStatus | undefined;
      const projects = await this.courseStructureService.getTrainerProjects(trainerId, status);
      return successResponse(res, {
        message: 'Trainer projects retrieved successfully',
        data: projects,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to retrieve trainer projects',
      });
    }
  };

  // ============================================================================
  // EXAM OPERATIONS
  // ============================================================================

  /**
   * GET /api/v1/levels/:levelId/exam
   * Get exam questions for a level
   */
  getExamQuestions = async (req: Request, res: Response) => {
    try {
      const { levelId } = req.params;

      if (!levelId) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'Level ID is required',
        });
      }

      const examData = await this.courseStructureService.getExamQuestions(levelId);

      return successResponse(res, {
        message: 'Exam questions retrieved successfully',
        data: examData,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to get exam questions',
      });
    }
  };

  /**
   * POST /api/v1/students/:studentId/levels/:levelId/exam/submit
   * Submit exam answers
   */
  submitExam = async (req: Request, res: Response) => {
    try {
      const studentId = (req as any).user?.userId || req.params.studentId;
      const { levelId } = req.params;
      const { answers } = req.body;

      if (!studentId || !levelId || !answers) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'Student ID, Level ID, and answers are required',
        });
      }

      const result = await this.courseStructureService.submitExam({
        studentId,
        levelId,
        answers,
      });

      return successResponse(res, {
        statusCode: 201,
        message: 'Exam submitted successfully',
        data: result,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to submit exam',
      });
    }
  };

  /**
   * GET /api/v1/students/:studentId/levels/:levelId/exam/attempts
   * Get exam attempt history
   */
  getExamAttempts = async (req: Request, res: Response) => {
    try {
      const studentId = (req as any).user?.userId || req.params.studentId;
      const { levelId } = req.params;

      if (!studentId || !levelId) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'Student ID and Level ID are required',
        });
      }

      const attempts = await this.courseStructureService.getExamAttempts(studentId, levelId);

      return successResponse(res, {
        message: 'Exam attempts retrieved successfully',
        data: attempts,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to get exam attempts',
      });
    }
  };
}

