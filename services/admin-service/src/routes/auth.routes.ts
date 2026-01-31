import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import {
	login,
	refresh,
	current,
	logoutSession,
	logoutEverywhere,
} from '../controllers/auth.controller';
import { requireAdminAuth } from '../middlewares/requireAdminAuth';

const router: ExpressRouter = Router();

router.post('/login', login);
router.post('/refresh', refresh);
router.get('/me', requireAdminAuth, current);
router.post('/logout', logoutSession);
router.post('/logout-all', requireAdminAuth, logoutEverywhere);

export default router;

