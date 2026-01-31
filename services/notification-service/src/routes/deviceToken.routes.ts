import { Router } from 'express';
import { DeviceTokenController } from '../controllers/deviceToken.controller';

export function createDeviceTokenRoutes(controller: DeviceTokenController): Router {
  const router = Router();

  router.post('/register', controller.registerToken);
  router.get('/tokens', controller.getUserTokens);
  router.post('/deactivate', controller.deactivateToken);
  router.delete('/token', controller.deleteToken);

  return router;
}

