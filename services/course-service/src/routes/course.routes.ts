/**
 * Course Routes
 */

import { Router } from 'express';
import { CourseController } from '../controllers/course.controller';
import { requireAdminAccess } from '../utils/accessControl';

export function createCourseRoutes(courseController: CourseController): Router {
  const router = Router();

  // Course CRUD
  router.post('/', requireAdminAccess, courseController.createCourse);
  router.get('/', courseController.getCourses);
  router.get('/:id', courseController.getCourseById);
  router.put('/:id', requireAdminAccess, courseController.updateCourse);
  router.delete('/:id', requireAdminAccess, courseController.deleteCourse);

  // Course content
  router.get('/:id/videos', courseController.getCourseVideos);
  router.get('/:id/materials', courseController.getCourseMaterials);
  router.get('/:id/assignments', courseController.getCourseAssignments);

  return router;
}

