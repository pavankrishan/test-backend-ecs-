import { Router } from 'express';
import {
	createIncident,
	getIncident,
	getMyIncidents,
	getAllIncidents,
	updateIncident,
} from '../controllers/safety.controller';
import { requireUserAuth, requireAuth } from '../middlewares/requireUserAuth';
import { requireAdminAuth } from '../middlewares/requireAdminAuth';
import type { Router as ExpressRouter } from 'express';

const router: ExpressRouter = Router();

// Report safety incident - allows both authenticated and unauthenticated requests
// For emergencies, we allow reporting without auth (user can provide userId in body)
router.post('/incidents', requireUserAuth, createIncident);

// Get my incidents - allows userId in query params or from token
router.get('/incidents', requireUserAuth, getMyIncidents);

// Get all incidents - requires admin auth
router.get('/incidents/all', requireAdminAuth, getAllIncidents);

// Get incident by ID - allows userId in query params or from token
router.get('/incidents/:id', requireUserAuth, getIncident);

// Update incident - requires authentication (admin or the user who reported it)
router.put('/incidents/:id', requireUserAuth, updateIncident);

export default router;

