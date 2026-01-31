/**
 * Course Structure Routes
 */

import { Router } from 'express';
import { CourseStructureController } from '../controllers/courseStructure.controller';

export function createCourseStructureRoutes(
  controller: CourseStructureController
): Router {
  const router = Router();

  // ============================================================================
  // PHASE ROUTES
  // ============================================================================
  router.post('/courses/:courseId/phases', controller.createPhase);
  router.get('/courses/:courseId/phases', controller.getPhases);
  
  // PRODUCTION OPTIMIZATION: Batch endpoint for complete course structure (phases, levels, sessions)
  // Use this instead of sequential calls for better performance at 600K+ users scale
  router.get('/courses/:courseId/structure', controller.getCompleteCourseStructure);

  // ============================================================================
  // LEVEL ROUTES
  // ============================================================================
  router.post('/phases/:phaseId/levels', controller.createLevel);
  router.get('/phases/:phaseId/levels', controller.getLevels);

  // ============================================================================
  // SESSION ROUTES
  // ============================================================================
  router.post('/levels/:levelId/sessions', controller.createSession);
  router.get('/levels/:levelId/sessions', controller.getSessions);
  router.get('/sessions/:sessionId', controller.getSessionById);

  // ============================================================================
  // PURCHASE ROUTES
  // ============================================================================
  router.post('/purchases', controller.createPurchase);
  router.post('/purchases/:purchaseId/upgrade', controller.upgradePurchase);
  router.get('/students/:studentId/courses/:courseId/purchase', controller.getPurchase);
  router.get('/students/:studentId/courses/:courseId/access/:sessionId', controller.checkAccess);

  // ============================================================================
  // PROGRESS ROUTES
  // ============================================================================
  router.post('/progress/video-watched', controller.markVideoWatched);
  router.post('/progress/sheet-previewed', controller.markSheetPreviewed);
  router.post('/progress/quiz', controller.submitQuizResults);
  router.get('/students/:studentId/courses/:courseId/progress', controller.getStudentProgress);
  router.get('/levels/:levelId/completion', controller.checkLevelCompletion);

  // ============================================================================
  // PROJECT ROUTES
  // ============================================================================
  router.post('/projects', controller.submitProject);
  router.get('/projects/public', controller.getPublicProjects);
  router.get('/projects/community', controller.getCommunityProjects);
  router.get('/students/:studentId/projects', controller.getStudentProjects);
  router.post('/projects/:projectId/review', controller.reviewProject);
  router.get('/trainers/:trainerId/projects', controller.getTrainerProjects);

  // ============================================================================
  // EXAM ROUTES
  // ============================================================================
  router.get('/levels/:levelId/exam', controller.getExamQuestions);
  router.post('/students/:studentId/levels/:levelId/exam/submit', controller.submitExam);
  router.get('/students/:studentId/levels/:levelId/exam/attempts', controller.getExamAttempts);

  return router;
}

