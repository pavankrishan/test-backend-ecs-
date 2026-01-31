import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { pincodeController } from '../controllers/pincode.controller';

const router: ExpressRouter = Router();

/**
 * Pincode lookup routes
 * Used for auto-fill functionality during trainer application
 */

// Resolve pincode to city information
router.get('/pincodes/:pincode', (req, res) => {
	pincodeController.resolvePincode(req, res);
});

// Get cities by state
router.get('/cities', (req, res) => {
	pincodeController.getCitiesByState(req, res);
});

// Get all states
router.get('/states', (req, res) => {
	pincodeController.getStates(req, res);
});

export default router;

