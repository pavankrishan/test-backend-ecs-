import { Request, Response } from 'express';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import logger from '@kodingcaravan/shared/config/logger';
import { AllocationService } from '../services/allocation.service';
import { z } from 'zod';

const allocationService = new AllocationService();

const createAllocationSchema = z.object({
	studentId: z.string().uuid(),
	trainerId: z.string().uuid().optional().nullable(),
	courseId: z.string().uuid().optional().nullable(),
	requestedBy: z.string().uuid(),
	notes: z.string().optional().nullable(),
	metadata: z.record(z.any()).optional().nullable(),
});

const approveAllocationSchema = z.object({
	trainerId: z.string().uuid().optional(),
});

const rejectAllocationSchema = z.object({
	rejectionReason: z.string().min(1),
});

const allocateTrainerSchema = z.object({
	studentId: z.string().uuid(),
	trainerId: z.string().uuid(),
	courseId: z.string().uuid().optional().nullable(),
	notes: z.string().optional().nullable(),
});

const updateAllocationSchema = z.object({
	trainerId: z.string().uuid().optional().nullable(),
	status: z.enum(['pending', 'approved', 'rejected', 'active', 'completed', 'cancelled']).optional(),
	notes: z.string().optional().nullable(),
	rejectionReason: z.string().optional().nullable(),
	metadata: z.record(z.any()).optional().nullable(),
});

const autoAssignSchema = z.object({
	studentId: z.string().uuid(),
	courseId: z.string().uuid(),
	timeSlot: z.string().min(1),
	date: z.string().min(1),
	requestedBy: z.string().uuid().optional(),
	paymentMetadata: z.record(z.any()).optional(), // For upgrade detection
});

const createSessionsForAllocationSchema = z.object({
	allocationId: z.string().uuid(),
});

export class AllocationController {
	/**
	 * Create a new allocation request
	 * POST /api/v1/admin/allocations
	 */
	static create = asyncHandler(async (req: Request, res: Response) => {
		const body = createAllocationSchema.parse(req.body);
		const adminId = (req as any).adminId || (req as any).userId;

		if (!adminId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Admin authentication required',
			});
		}

		const allocation = await allocationService.createAllocation(body);

		return successResponse(res, {
			statusCode: 201,
			message: 'Allocation request created successfully',
			data: allocation,
		});
	});

	/**
	 * Approve allocation
	 * POST /api/v1/admin/allocations/:id/approve
	 */
	static approve = asyncHandler(async (req: Request, res: Response) => {
		const { id } = req.params;
		const body = approveAllocationSchema.parse(req.body);
		const adminId = (req as any).adminId || (req as any).userId;

		if (!adminId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Admin authentication required',
			});
		}

		const allocation = await allocationService.approveAllocation(id, adminId, body.trainerId);

		return successResponse(res, {
			message: 'Allocation approved successfully',
			data: allocation,
		});
	});

	/**
	 * Reject allocation
	 * POST /api/v1/admin/allocations/:id/reject
	 */
	static reject = asyncHandler(async (req: Request, res: Response) => {
		const { id } = req.params;
		const body = rejectAllocationSchema.parse(req.body);
		const adminId = (req as any).adminId || (req as any).userId;

		if (!adminId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Admin authentication required',
			});
		}

		const allocation = await allocationService.rejectAllocation(id, adminId, body.rejectionReason);

		return successResponse(res, {
			message: 'Allocation rejected successfully',
			data: allocation,
		});
	});

	/**
	 * Allocate trainer to student
	 * POST /api/v1/admin/allocations/allocate
	 */
	static allocate = asyncHandler(async (req: Request, res: Response) => {
		const body = allocateTrainerSchema.parse(req.body);
		const adminId = (req as any).adminId || (req as any).userId;

		if (!adminId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Admin authentication required',
			});
		}

		const allocation = await allocationService.allocateTrainer(
			body.studentId,
			body.trainerId,
			adminId,
			{
				courseId: body.courseId,
				notes: body.notes,
			}
		);

		return successResponse(res, {
			statusCode: 201,
			message: 'Trainer allocated successfully',
			data: allocation,
		});
	});

	/**
	 * Get allocation by ID
	 * GET /api/v1/admin/allocations/:id
	 */
	static getById = asyncHandler(async (req: Request, res: Response) => {
		const { id } = req.params;

		const allocation = await allocationService.getAllocation(id);
		if (!allocation) {
			return errorResponse(res, {
				statusCode: 404,
				message: 'Allocation not found',
			});
		}

		return successResponse(res, {
			message: 'Allocation retrieved successfully',
			data: allocation,
		});
	});

	/**
	 * Get all allocations
	 * GET /api/v1/admin/allocations
	 */
	static getAll = asyncHandler(async (req: Request, res: Response) => {
		const { status, studentId, trainerId, limit, offset } = req.query;

		const allocations = await allocationService.getAllAllocations({
			status: status as any,
			studentId: studentId as string,
			trainerId: trainerId as string,
			limit: limit ? parseInt(limit as string, 10) : undefined,
			offset: offset ? parseInt(offset as string, 10) : undefined,
		});

		return successResponse(res, {
			message: 'Allocations retrieved successfully',
			data: allocations,
		});
	});

	/**
	 * Get student allocations
	 * GET /api/v1/admin/allocations/student/:studentId
	 */
	static getByStudent = asyncHandler(async (req: Request, res: Response) => {
		const { studentId } = req.params;
		const { status, limit, offset, details } = req.query;
		const userId = (req as any).userId;
		const userRole = (req as any).userRole;

		// If user is authenticated, validate they can only access their own allocations
		// (unless they're an admin)
		if (userId && userRole !== 'admin' && userId !== studentId) {
			return errorResponse(res, {
				statusCode: 403,
				message: 'You can only access your own allocations',
			});
		}

		// If details=true, return enriched data with trainer info
		if (details === 'true') {
			const allocations = await allocationService.getStudentAllocationsWithDetails(studentId, {
				status: status as any,
				limit: limit ? parseInt(limit as string, 10) : undefined,
				offset: offset ? parseInt(offset as string, 10) : undefined,
			});

			return successResponse(res, {
				message: 'Student allocations with details retrieved successfully',
				data: allocations,
			});
		}

		const allocations = await allocationService.getStudentAllocations(studentId, {
			status: status as any,
			limit: limit ? parseInt(limit as string, 10) : undefined,
			offset: offset ? parseInt(offset as string, 10) : undefined,
		});

		return successResponse(res, {
			message: 'Student allocations retrieved successfully',
			data: allocations,
		});
	});

	/**
	 * Get trainer allocations
	 * GET /api/v1/admin/allocations/trainer/:trainerId
	 */
	static getByTrainer = asyncHandler(async (req: Request, res: Response) => {
		const { trainerId } = req.params;
		const { status, limit, offset, details } = req.query;

		// Production logging
		logger.debug('getByTrainer called', {
			trainerId,
			status,
			limit,
			offset,
			details,
			correlationId: (req as any).correlationId,
			service: 'admin-service',
		});

		// If details=true, return enriched data with student info
		if (details === 'true') {
			const allocations = await allocationService.getTrainerAllocationsWithDetails(trainerId, {
				status: status as any,
				limit: limit ? parseInt(limit as string, 10) : undefined,
				offset: offset ? parseInt(offset as string, 10) : undefined,
			});

			logger.debug('getByTrainer response (with details)', {
				trainerId,
				status,
				count: allocations.length,
				correlationId: (req as any).correlationId,
				service: 'admin-service',
			});

			return successResponse(res, {
				message: 'Trainer allocations with details retrieved successfully',
				data: allocations,
			});
		}

		const allocations = await allocationService.getTrainerAllocations(trainerId, {
			status: status as any,
			limit: limit ? parseInt(limit as string, 10) : undefined,
			offset: offset ? parseInt(offset as string, 10) : undefined,
		});

		logger.debug('getByTrainer response', {
			trainerId,
			status,
			count: allocations.length,
			correlationId: (req as any).correlationId,
			service: 'admin-service',
		});

		return successResponse(res, {
			message: 'Trainer allocations retrieved successfully',
			data: allocations,
		});
	});

	/**
	 * Update allocation
	 * PUT /api/v1/admin/allocations/:id
	 */
	static update = asyncHandler(async (req: Request, res: Response) => {
		const { id } = req.params;
		const body = updateAllocationSchema.parse(req.body);
		const adminId = (req as any).adminId || (req as any).userId;

		if (!adminId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Admin authentication required',
			});
		}

		const allocation = await allocationService.updateAllocation(id, adminId, body);

		return successResponse(res, {
			message: 'Allocation updated successfully',
			data: allocation,
		});
	});

	/**
	 * Cancel allocation
	 * POST /api/v1/admin/allocations/:id/cancel
	 */
	static cancel = asyncHandler(async (req: Request, res: Response) => {
		const { id } = req.params;
		const adminId = (req as any).adminId || (req as any).userId;

		if (!adminId) {
			return errorResponse(res, {
				statusCode: 401,
				message: 'Admin authentication required',
			});
		}

		const allocation = await allocationService.cancelAllocation(id, adminId);

		return successResponse(res, {
			message: 'Allocation cancelled successfully',
			data: allocation,
		});
	});

	/**
	 * Check time slot availability
	 * GET /api/v1/admin/allocations/availability/check
	 */
	static checkAvailability = asyncHandler(async (req: Request, res: Response) => {
		const { timeSlot, date, courseId } = req.query;

		if (!timeSlot || !date) {
			return errorResponse(res, {
				statusCode: 400,
				message: 'Time slot and date are required',
			});
		}

		const availability = await allocationService.checkTimeSlotAvailability(
			timeSlot as string,
			date as string,
			courseId as string | undefined
		);

		return successResponse(res, {
			message: 'Availability checked successfully',
			data: availability,
		});
	});

	/**
	 * Check trainer availability for upgrade
	 * GET /api/v1/admin/allocations/trainer-availability/check
	 */
	static checkTrainerAvailability = asyncHandler(async (req: Request, res: Response) => {
		const { trainerId, timeSlot, startDate, additionalSessions, scheduleMode, studentId } = req.query;

		if (!trainerId || !timeSlot || !startDate || !additionalSessions) {
			return errorResponse(res, {
				statusCode: 400,
				message: 'trainerId, timeSlot, startDate, and additionalSessions are required',
			});
		}

		const availability = await allocationService.checkTrainerAvailabilityForUpgrade(
			trainerId as string,
			timeSlot as string,
			startDate as string,
			parseInt(additionalSessions as string, 10),
			(scheduleMode as 'everyday' | 'sunday') || 'everyday',
			studentId as string | undefined
		);

		return successResponse(res, {
			message: 'Trainer availability checked successfully',
			data: availability,
		});
	});

	/**
	 * Get all available time slots from all approved trainers
	 * GET /api/v1/admin/allocations/available-time-slots
	 */
	static getAllAvailableTimeSlots = asyncHandler(async (req: Request, res: Response) => {
		const { courseId } = req.query;

		const slots = await allocationService.getAllAvailableTimeSlots(courseId as string | undefined);

		return successResponse(res, {
			message: 'Available time slots retrieved successfully',
			data: slots,
		});
	});

	/**
	 * Get trainer available time slots and dates for upgrade
	 * GET /api/v1/admin/allocations/trainer-availability/slots
	 */
	static getTrainerAvailableSlots = asyncHandler(async (req: Request, res: Response) => {
		const { trainerId, startDate, additionalSessions, scheduleMode, studentId } = req.query;

		if (!trainerId || !startDate || !additionalSessions) {
			return errorResponse(res, {
				statusCode: 400,
				message: 'trainerId, startDate, and additionalSessions are required',
			});
		}

		const slots = await allocationService.getTrainerAvailableSlotsForUpgrade(
			trainerId as string,
			startDate as string,
			parseInt(additionalSessions as string, 10),
			(scheduleMode as 'everyday' | 'sunday') || 'everyday',
			studentId as string | undefined
		);

		return successResponse(res, {
			message: 'Trainer available slots retrieved successfully',
			data: slots,
		});
	});

	/**
	 * Automatically assign a trainer to a student after course purchase
	 * POST /api/v1/admin/allocations/auto-assign
	 */
	static autoAssign = asyncHandler(async (req: Request, res: Response) => {
		const body = autoAssignSchema.parse(req.body);

		const allocation = await allocationService.autoAssignTrainerAfterPurchase(
			body.studentId,
			body.courseId,
			body.timeSlot,
			body.date,
			body.requestedBy || body.studentId,
			body.paymentMetadata
		);

		// If allocation is pending (auto-assignment failed), return 202 Accepted
		if (allocation.status === 'pending' && allocation.trainerId === null) {
			return successResponse(res, {
				statusCode: 202,
				message: 'Auto-assignment attempted but no trainer available. Allocation created as pending for manual review.',
				data: allocation,
			});
		}

		return successResponse(res, {
			statusCode: 201,
			message: 'Trainer automatically assigned successfully',
			data: allocation,
		});
	});

	/**
	 * Retry auto-assignment for existing course purchase
	 * POST /api/v1/admin/allocations/retry-auto-assign
	 * This endpoint is for students who already purchased a course but trainer wasn't allocated
	 */
	static retryAutoAssign = asyncHandler(async (req: Request, res: Response) => {
		const { studentId, courseId } = req.body;

		if (!studentId || !courseId) {
			return errorResponse(res, {
				statusCode: 400,
				message: 'studentId and courseId are required',
			});
		}

		// Get purchase details from course service to extract timeSlot and date
		try {
			const courseServiceUrl = process.env.COURSE_SERVICE_URL ||
				`http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.COURSE_SERVICE_PORT || 3005}`;

			const axios = (await import('axios')).default;
			const purchaseUrl = `${courseServiceUrl}/api/v1/students/${studentId}/courses/${courseId}/purchase`;

			const purchaseResponse = await axios.get(purchaseUrl, { timeout: 10000 });

			if (purchaseResponse.status !== 200 || !purchaseResponse.data?.data) {
				return errorResponse(res, {
					statusCode: 404,
					message: 'Course purchase not found',
				});
			}

			const purchase = purchaseResponse.data.data;
			const metadata = purchase.metadata || {};

			// Extract timeSlot and date from purchase metadata
			const schedule = metadata.schedule && typeof metadata.schedule === 'object' 
				? metadata.schedule as Record<string, unknown> 
				: {};
			
			const timeSlot = (metadata.timeSlot as string) || 
				(metadata.preferredTimeSlot as string) || 
				(schedule.timeSlot as string) ; // Default fallback

			// Priority: schedule.startDate > schedule.date > metadata.startDate > metadata.date > today
			const date = (schedule.startDate as string) ||
				(schedule.date as string) ||
				(metadata.startDate as string) ||
				(metadata.date as string) ||
				(metadata.preferredDate as string) ||
				new Date().toISOString().split('T')[0]; // Today's date as fallback

			logger.info('Retrying auto-assignment for student', {
				studentId,
				courseId,
				timeSlot,
				date,
				hasMetadata: !!metadata,
				correlationId: (req as any).correlationId,
				service: 'admin-service',
			});

			// Call auto-assignment with purchase metadata
			const allocation = await allocationService.autoAssignTrainerAfterPurchase(
				studentId,
				courseId,
				timeSlot,
				date,
				studentId,
				metadata // Pass full metadata for upgrade detection and other info
			);

			// If allocation is pending (auto-assignment failed), return 202 Accepted
			if (allocation.status === 'pending' && allocation.trainerId === null) {
				return successResponse(res, {
					statusCode: 202,
					message: 'Auto-assignment attempted but no trainer available. Allocation created as pending for manual review.',
					data: allocation,
				});
			}

			return successResponse(res, {
				statusCode: 201,
				message: 'Trainer automatically assigned successfully',
				data: allocation,
			});
		} catch (error: any) {
			logger.error('Retry Auto-Assign error', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				studentId,
				courseId,
				correlationId: (req as any).correlationId,
				service: 'admin-service',
			});
			
			if (error.response?.status === 404) {
				return errorResponse(res, {
					statusCode: 404,
					message: 'Course purchase not found. Please ensure the student has purchased this course.',
				});
			}

			return errorResponse(res, {
				statusCode: 500,
				message: error.message || 'Failed to retry auto-assignment',
			});
		}
	});

	/**
	 * Fix missing sessions for an approved allocation
	 * POST /api/v1/admin/allocations/:allocationId/fix-sessions
	 */
	static fixMissingSessions = asyncHandler(async (req: Request, res: Response) => {
		const { allocationId } = req.params;

		const allocation = await allocationService.getAllocation(allocationId);
		if (!allocation) {
			return errorResponse(res, {
				statusCode: 404,
				message: 'Allocation not found',
			});
		}

		if (allocation.status !== 'approved') {
			return errorResponse(res, {
				statusCode: 400,
				message: 'Allocation must be approved to create sessions',
			});
		}

		// Check if sessions already exist
		const { getPool } = await import('../config/database');
		const pool = getPool();
		const existingSessions = await pool.query(
			'SELECT COUNT(*) as count FROM tutoring_sessions WHERE allocation_id = $1',
			[allocationId]
		);

		const sessionCount = parseInt(existingSessions.rows[0].count);
		if (sessionCount > 0) {
			return successResponse(res, {
				statusCode: 200,
				message: `Sessions already exist (${sessionCount} sessions found)`,
				data: { existingSessions: sessionCount },
			});
		}

		// Create sessions
		try {
			// Use public method to create sessions
			const result = await allocationService.createSessionsForExistingAllocation(allocationId);
			if (!result.success) {
				throw new Error(result.message);
			}

			// Verify creation
			const finalCheck = await pool.query(
				'SELECT COUNT(*) as count FROM tutoring_sessions WHERE allocation_id = $1',
				[allocationId]
			);

			const finalCount = parseInt(finalCheck.rows[0].count);

			return successResponse(res, {
				statusCode: 201,
				message: `Successfully created ${finalCount} sessions`,
				data: { sessionsCreated: finalCount },
			});
		} catch (error: any) {
			logger.error('Failed to create sessions', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				allocationId: req.params.allocationId,
				correlationId: (req as any).correlationId,
				service: 'admin-service',
			});

			// Provide helpful error message
			let errorMessage = 'Failed to create sessions';
			if (error.message?.includes('GPS coordinates')) {
				errorMessage = 'Cannot create sessions: Student missing GPS coordinates. Update student address.';
			} else if (error.message?.includes('Student profile not found')) {
				errorMessage = 'Cannot create sessions: Student profile not found.';
			}

			return errorResponse(res, {
				statusCode: 500,
				message: errorMessage,
				errors: { error: error.message },
			});
		}
	});

	/**
	 * Create sessions for an existing allocation (useful when address was updated after allocation)
	 */
	static createSessionsForAllocation = asyncHandler(async (req: Request, res: Response) => {
		const { allocationId } = createSessionsForAllocationSchema.parse(req.params);

		const result = await allocationService.createSessionsForExistingAllocation(allocationId);

		if (result.success) {
			return successResponse(res, {
				message: result.message,
				data: {
					sessionsCreated: result.sessionsCreated,
					allocationId,
				},
			});
		} else {
			return errorResponse(res, {
				statusCode: 400,
				message: result.message,
			});
		}
	});

	/**
	 * Create sessions for all approved allocations that don't have sessions yet
	 */
	static createSessionsForPendingAllocations = asyncHandler(async (req: Request, res: Response) => {
		const result = await allocationService.createSessionsForPendingAllocations();

		return successResponse(res, {
			message: `Processed ${result.processed} allocations: ${result.successful} successful, ${result.failed} failed`,
			data: result,
		});
	});

	/**
	 * Check if trainers are available for a course before purchase
	 * GET /api/v1/admin/allocations/check-course-availability
	 */
	static checkCourseTrainerAvailability = asyncHandler(async (req: Request, res: Response) => {
		const { courseId, timeSlot } = req.query;

		if (!courseId || typeof courseId !== 'string') {
			return errorResponse(res, {
				statusCode: 400,
				message: 'courseId is required',
			});
		}

		const result = await allocationService.checkTrainerAvailabilityForCourse(
			courseId,
			timeSlot as string | undefined
		);

		return successResponse(res, {
			message: result.message,
			data: result,
		});
	});
}

