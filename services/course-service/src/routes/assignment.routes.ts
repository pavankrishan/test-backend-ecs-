/**
 * Assignment Routes
 */

import { Router } from 'express';
import { AssignmentController } from '../controllers/assignment.controller';
import { requireAdminAccess, requireAuthenticatedUser } from '../utils/accessControl';

export function createAssignmentRoutes(assignmentController: AssignmentController): Router {
  const router = Router();

  router.post('/', requireAdminAccess, assignmentController.createAssignment);
  router.get('/course/:courseId', assignmentController.getCourseAssignments);
  router.get('/:id', assignmentController.getAssignmentById);
  router.post('/:id/submit', requireAuthenticatedUser, assignmentController.submitAssignment);
  router.post('/submissions/:id/grade', requireAdminAccess, assignmentController.gradeSubmission);
  router.get('/:id/submissions', requireAdminAccess, assignmentController.getSubmissions);
  router.get('/:id/submissions/student/:studentId', requireAdminAccess, assignmentController.getStudentSubmission);

  return router;
}

