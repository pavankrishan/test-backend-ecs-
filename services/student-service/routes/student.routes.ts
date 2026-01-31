import { Router } from 'express';
import type { StudentController } from '../controllers/student.controller';

export function createStudentRoutes(studentController: StudentController): Router {
  const router = Router();

  router.get('/', studentController.listStudents);
  router.get('/:studentId', studentController.getOverview);
  router.get('/:studentId/home', studentController.getHome);
  router.get('/:studentId/learning', studentController.getLearning);
  router.get('/:studentId/courses/:courseId/state', studentController.getCourseState);
  router.post('/:studentId/invalidate-cache', studentController.invalidateCache);
  router.get('/:studentId/profile', studentController.getProfile);
  router.put('/:studentId/profile', studentController.upsertProfile);

  router.get('/:studentId/progress', studentController.getProgress);
  router.put('/:studentId/progress/:courseId', studentController.upsertProgress);
  router.post('/:studentId/progress/:courseId/complete', studentController.recordCompletion);

  router.get('/:studentId/projects', studentController.listProjects);
  router.post('/:studentId/projects', studentController.createProject);
  router.get('/:studentId/projects/:projectId', studentController.getProject);
  router.patch('/:studentId/projects/:projectId', studentController.updateProject);

  router.post('/:studentId/support-tickets', studentController.createSupportTicket);

  // Claim deal routes
  router.get('/:studentId/claim-deal/check', studentController.checkCanClaimDeal);
  router.post('/:studentId/claim-deal', studentController.claimDeal);

  // Referral routes
  router.get('/:studentId/referral-code', studentController.getReferralCode);
  router.get('/:studentId/referral-stats', studentController.getReferralStats);

  // Admin routes for geocoding (requires admin authentication in production)
  router.post('/admin/geocode-profiles', studentController.geocodeProfiles);

  return router;
}

