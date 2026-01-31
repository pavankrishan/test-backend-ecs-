/**
 * Upload Routes
 */

import { Router } from 'express';
import { UploadController, uploadSingle } from '../controllers/upload.controller';

export function createUploadRoutes(controller: UploadController): Router {
  const router = Router();

  router.post('/upload', uploadSingle, controller.uploadFile);

  return router;
}
