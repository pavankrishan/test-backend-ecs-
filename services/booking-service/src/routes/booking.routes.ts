/**
 * Booking Routes
 */

import { Router } from 'express';
import { BookingController } from '../controllers/booking.controller';
import { PricingController } from '../controllers/pricing.controller';
import { SessionSyncController } from '../controllers/sessionSync.controller';
import { validateAutoAssignTrainer } from '../middlewares/validation.middleware';

export function createBookingRoutes(controller: BookingController): Router {
	const router = Router();
	const sessionSyncController = new SessionSyncController();
	const pricingController = new PricingController();

	// Existing booking routes
	router.post('/check-service-availability', controller.checkServiceAvailability);
	router.post('/zones-by-location', controller.getZonesByLocation);
	router.post('/create-booking', controller.createBooking);
	router.post('/create-prebooking', controller.createPreBooking);
	router.get('/trainer-demand', controller.getTrainerDemand);
	router.post('/assign-trainer', controller.assignTrainer);
	router.get('/trainer-schedule/:trainerId', controller.getTrainerSchedule);
	router.post('/trainer-attendance', controller.recordAttendance);
	router.post('/auto-assign-trainer', validateAutoAssignTrainer, controller.autoAssignTrainer);

	// Pricing routes
	router.get('/pricing/calculate', pricingController.calculatePricing);
	router.post('/coupons/validate', pricingController.validateCoupon);
	router.get('/feature-flags', pricingController.getFeatureFlags);

	// Pre-booking capacity routes
	router.get('/pre-bookings/capacity', controller.getPreBookingCapacity);

	// Session sync routes (for syncing purchase_sessions to tutoring_sessions)
	router.post('/sync-sessions/:purchaseId', sessionSyncController.syncPurchaseSessions);
	router.post('/sync-sessions/all', sessionSyncController.syncAllPurchaseSessions);
	router.post('/sync-sessions/session/:sessionId', sessionSyncController.syncSingleSession);

	return router;
}

