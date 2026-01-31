import { Router } from 'express';
import { CourseContentController } from '../controllers/courseContent.controller';
import { requireAdminAccess } from '../utils/accessControl';

export function createCourseContentRoutes(controller: CourseContentController): Router {
  const router = Router();

  router.get('/:courseId/content', controller.getCourseContent);
  router.post('/:courseId/content', requireAdminAccess, controller.upsertCourseContent);

  return router;
}


