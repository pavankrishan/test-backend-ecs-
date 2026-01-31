/**
 * Video Routes
 */

import { Router } from 'express';
import { VideoController } from '../controllers/video.controller';
import { requireAdminAccess } from '../utils/accessControl';

export function createVideoRoutes(videoController: VideoController): Router {
  const router = Router();

  router.get('/course/:courseId', videoController.getCourseVideos);
  router.get('/course/:courseId/preview', videoController.getPreviewVideos);
  router.get('/:id', videoController.getVideoById);
  router.post('/', requireAdminAccess, videoController.addVideo);
  router.put('/:id', requireAdminAccess, videoController.updateVideo);
  router.delete('/:id', requireAdminAccess, videoController.deleteVideo);

  return router;
}

