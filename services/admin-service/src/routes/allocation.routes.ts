import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { AllocationController } from '../controllers/allocation.controller';
import { requireAdminAuth } from '../middlewares/requireAdminAuth';
import { requireUserAuth } from '../middlewares/requireUserAuth';

const router: ExpressRouter = Router();

// Admin-only routes
router.post('/', requireAdminAuth, AllocationController.create);
router.post('/:id/approve', requireAdminAuth, AllocationController.approve);
router.post('/:id/reject', requireAdminAuth, AllocationController.reject);
router.post('/allocate', requireAdminAuth, AllocationController.allocate);
router.put('/:id', requireAdminAuth, AllocationController.update);
router.post('/:id/cancel', requireAdminAuth, AllocationController.cancel);

// Auto-assignment route (internal service call, no auth required for now)
// TODO: Add service-to-service authentication in production
router.post('/auto-assign', AllocationController.autoAssign);

// Retry auto-assignment for existing purchases (admin only)
router.post('/retry-auto-assign', requireAdminAuth, AllocationController.retryAutoAssign);

// Session creation routes (temporarily disabled auth for testing)
router.post('/:allocationId/create-sessions', AllocationController.createSessionsForAllocation);
router.post('/create-pending-sessions', AllocationController.createSessionsForPendingAllocations);

// Manual session creation for approved allocations (admin only) - temporarily disabled auth for testing
router.post('/:allocationId/fix-sessions', AllocationController.fixMissingSessions);

// Admin and authenticated user routes
router.get('/', requireAdminAuth, AllocationController.getAll);
// IMPORTANT: Specific routes must come BEFORE parameterized routes (/:id, /:studentId, etc.)
// Otherwise Express will match /check-course-availability as /:id
router.get('/availability/check', requireUserAuth, AllocationController.checkAvailability);
router.get('/available-time-slots', requireUserAuth, AllocationController.getAllAvailableTimeSlots);
router.get('/trainer-availability/check', requireUserAuth, AllocationController.checkTrainerAvailability);
router.get('/trainer-availability/slots', requireUserAuth, AllocationController.getTrainerAvailableSlots);
router.get('/check-course-availability', requireUserAuth, AllocationController.checkCourseTrainerAvailability);
// Parameterized routes must come AFTER all specific routes
router.get('/student/:studentId', requireUserAuth, AllocationController.getByStudent);
router.get('/trainer/:trainerId', requireUserAuth, AllocationController.getByTrainer);
router.get('/:id', requireUserAuth, AllocationController.getById);

export default router;

