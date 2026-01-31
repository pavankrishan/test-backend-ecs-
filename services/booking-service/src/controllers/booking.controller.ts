/**
 * Booking Controller
 * Handles HTTP requests for booking operations
 */

import { Request, Response } from 'express';
import axios from 'axios';
import { ServiceAreaService } from '../services/serviceArea.service';
import { TrainerAssignmentService } from '../services/trainerAssignment.service';
import { SessionBookingRepository } from '../models/sessionBooking.model';
import { PreBookingRepository } from '../models/preBooking.model';
import { DemandCalculatorService } from '../services/demandCalculator.service';
import { ScheduleSlotRepository } from '../models/scheduleSlot.model';
import { AttendanceRecordRepository } from '../models/attendanceRecord.model';
import { getAvailableTrainersFromService, getTrainerCandidatesFromService } from '../utils/trainerIntegration';
import { AutoTrainerAssignmentService, type FetchTrainersFunction } from '../services/autoTrainerAssignment.service';
import type { TrainerInfo } from '../services/trainerEligibilityChecker.service';
import { TrainerServiceClient } from '../utils/trainerServiceClient';
import { PreBookingService } from '../services/preBooking.service';
import { PreBookingCapacityRepository } from '../models/preBookingCapacity.model';
import { getPool } from '../config/database';

export class BookingController {
	private readonly trainerServiceClient: TrainerServiceClient;
	private readonly preBookingService: PreBookingService;
	private readonly capacityRepo: PreBookingCapacityRepository;

	constructor(
		private readonly serviceAreaService: ServiceAreaService,
		private readonly trainerAssignmentService: TrainerAssignmentService,
		private readonly bookingRepo: SessionBookingRepository,
		private readonly preBookingRepo: PreBookingRepository,
		private readonly demandCalculator: DemandCalculatorService,
		private readonly scheduleSlotRepo: ScheduleSlotRepository,
		private readonly attendanceRepo: AttendanceRecordRepository,
		private readonly autoAssignmentService?: AutoTrainerAssignmentService
	) {
		this.trainerServiceClient = new TrainerServiceClient();
		const pool = getPool();
		this.preBookingService = new PreBookingService(pool);
		this.capacityRepo = new PreBookingCapacityRepository(pool);
	}

	/**
	 * POST /zones-by-location
	 * Given a cityId and GPS location, return all service zones (clusters)
	 * in that city whose radius covers the location, ordered by proximity.
	 *
	 * Response:
	 * - 200 + list of zones (if at least one match)
	 * - 404 + SERVICE_NOT_AVAILABLE (if city inactive / no zones / outside coverage)
	 */
	getZonesByLocation = async (req: Request, res: Response): Promise<void> => {
		try {
			const { cityId, lat, lng } = req.body;

			if (!cityId || lat === undefined || lng === undefined) {
				res.status(400).json({
					success: false,
					message: 'Missing required fields: cityId, lat, lng',
				});
				return;
			}

			const latitude = typeof lat === 'string' ? parseFloat(lat) : Number(lat);
			const longitude = typeof lng === 'string' ? parseFloat(lng) : Number(lng);

			if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
				res.status(400).json({
					success: false,
					message: 'Invalid coordinates: lat and lng must be numbers',
				});
				return;
			}

			const result = await this.serviceAreaService.findZonesByCityAndLocation(
				cityId,
				latitude,
				longitude
			);

			if (result === 'SERVICE_NOT_AVAILABLE') {
				res.status(404).json({
					success: false,
					message: 'SERVICE_NOT_AVAILABLE',
				});
				return;
			}

			res.json({
				success: true,
				data: result,
			});
		} catch (error: any) {
			res.status(500).json({
				success: false,
				message: error.message || 'Failed to find zones for location',
			});
		}
	};

	/**
	 * POST /check-service-availability
	 * Check if service is available at a location
	 */
	checkServiceAvailability = async (req: Request, res: Response): Promise<void> => {
		try {
			const { lat, lng, course, timeslot } = req.body;

			if (!lat || !lng || !course || !timeslot) {
				res.status(400).json({
					success: false,
					message: 'Missing required fields: lat, lng, course, timeslot',
				});
				return;
			}

			// Fetch trainers from trainer-service
			const getAvailableTrainers = async (location: { latitude: number; longitude: number }, courseId: string, slot: string) => {
				return getAvailableTrainersFromService(location, courseId, slot);
			};

			const result = await this.serviceAreaService.checkServiceAvailability(
				parseFloat(lat),
				parseFloat(lng),
				course,
				timeslot,
				getAvailableTrainers
			);

			res.json({
				success: true,
				data: result,
			});
		} catch (error: any) {
			res.status(500).json({
				success: false,
				message: error.message || 'Failed to check service availability',
			});
		}
	};

	/**
	 * POST /create-booking
	 * Create a session booking
	 */
	createBooking = async (req: Request, res: Response): Promise<void> => {
		try {
			const { studentId, studentIds, courseId, address, lat, lng, timeslot, mode, groupSize, sessionCount, startDate } = req.body;

			if (!studentId || !courseId || !address || !lat || !lng || !timeslot || !mode || !groupSize || !sessionCount || !startDate) {
				res.status(400).json({
					success: false,
					message: 'Missing required fields',
				});
				return;
			}

			// Detect cluster
			const nearestCluster = await this.serviceAreaService.findNearestCluster(
				parseFloat(lat),
				parseFloat(lng)
			);

			const booking = await this.bookingRepo.create({
				studentId,
				studentIds: studentIds || [],
				courseId,
				address,
				latitude: parseFloat(lat),
				longitude: parseFloat(lng),
				timeslot,
				mode: mode as '1on1' | '1on2' | '1on3',
				groupSize: parseInt(groupSize) as 1 | 2 | 3,
				sessionCount: parseInt(sessionCount) as 10 | 20 | 30,
				startDate: new Date(startDate),
			});

			// Update cluster if found
			if (nearestCluster) {
				await this.bookingRepo.update(booking.id, { clusterId: nearestCluster.id });
				booking.clusterId = nearestCluster.id;
			}

			res.json({
				success: true,
				data: booking,
			});
		} catch (error: any) {
			res.status(500).json({
				success: false,
				message: error.message || 'Failed to create booking',
			});
		}
	};

	/**
	 * POST /create-prebooking
	 * Create a pre-booking with all validations
	 */
	createPreBooking = async (req: Request, res: Response): Promise<void> => {
		try {
			const {
				studentId,
				address,
				lat,
				lng,
				courseId,
				timeslot,
				mode,
				groupSize,
				sessionCount,
				startDate,
				couponCode,
			} = req.body;

			if (!address || !lat || !lng || !courseId || !timeslot || !mode || !groupSize || !sessionCount || !startDate) {
				res.status(400).json({
					success: false,
					message: 'Missing required fields: address, lat, lng, courseId, timeslot, mode, groupSize, sessionCount, startDate',
				});
				return;
			}

			// Parse startDate
			const startDateObj = new Date(startDate);
			if (isNaN(startDateObj.getTime())) {
				res.status(400).json({
					success: false,
					message: 'Invalid startDate format',
				});
				return;
			}

			// Detect city and cluster
			const nearestCluster = await this.serviceAreaService.findNearestCluster(
				parseFloat(lat),
				parseFloat(lng)
			);

			// Create pre-booking with all validations
			const result = await this.preBookingService.createPreBooking({
				address,
				latitude: parseFloat(lat),
				longitude: parseFloat(lng),
				courseId,
				timeslot,
				mode: mode as '1on1' | '1on2' | '1on3',
				groupSize: parseInt(groupSize) as 1 | 2 | 3,
				sessionCount: parseInt(sessionCount) as 10 | 20 | 30,
				cityId: nearestCluster ? null : null, // TODO: Get cityId from cluster
				clusterId: nearestCluster?.id || null,
				studentId: studentId || null,
				startDate: startDateObj,
				metadata: couponCode ? { couponCode } : null,
			});

			res.json({
				success: true,
				data: {
					preBookingId: result.preBooking.id,
					status: result.preBooking.status,
					capacityRemaining: result.capacityRemaining,
					pricing: result.pricing,
				},
			});
		} catch (error: any) {
			// Handle capacity exceeded error
			if (error.message?.includes('capacity exceeded')) {
				res.status(409).json({
					success: false,
					message: 'Pre-booking capacity exceeded for this course and timeslot',
				});
				return;
			}

			// Handle Sunday booking error
			if (error.message?.includes('Sunday')) {
				res.status(400).json({
					success: false,
					message: 'Sunday bookings are not allowed',
				});
				return;
			}

			// Handle feature flag error
			if (error.message?.includes('disabled')) {
				res.status(400).json({
					success: false,
					message: error.message,
				});
				return;
			}

			res.status(500).json({
				success: false,
				message: error.message || 'Failed to create pre-booking',
			});
		}
	};

	/**
	 * GET /pre-bookings/capacity?courseId=uuid&timeslot=18:00
	 * Get pre-booking capacity for a course and timeslot
	 */
	getPreBookingCapacity = async (req: Request, res: Response): Promise<void> => {
		try {
			const { courseId, timeslot } = req.query;

			if (!courseId || !timeslot) {
				res.status(400).json({
					success: false,
					message: 'Missing required query parameters: courseId, timeslot',
				});
				return;
			}

			const capacity = await this.capacityRepo.getCapacity(courseId as string, timeslot as string);
			const remaining = await this.capacityRepo.getRemainingCapacity(courseId as string, timeslot as string);

			res.json({
				success: true,
				data: {
					courseId,
					timeslot,
					currentCount: capacity?.currentCount || 0,
					maxCapacity: capacity?.maxCapacity || 10,
					available: remaining > 0,
					remaining,
				},
			});
		} catch (error: any) {
			res.status(500).json({
				success: false,
				message: error.message || 'Failed to get pre-booking capacity',
			});
		}
	};

	/**
	 * GET /trainer-demand?city=Ongole
	 * Get trainer requirement summary
	 */
	getTrainerDemand = async (req: Request, res: Response): Promise<void> => {
		try {
			const { city } = req.query;

			const result = await this.demandCalculator.calculateTrainerDemand(
				city as string | undefined
			);

			res.json({
				success: true,
				data: result,
			});
		} catch (error: any) {
			res.status(500).json({
				success: false,
				message: error.message || 'Failed to calculate trainer demand',
			});
		}
	};

	/**
	 * POST /assign-trainer
	 * Assign trainer to a booking
	 */
	assignTrainer = async (req: Request, res: Response): Promise<void> => {
		try {
			const { bookingId } = req.body;

			if (!bookingId) {
				res.status(400).json({
					success: false,
					message: 'Missing bookingId',
				});
				return;
			}

			// Fetch trainer candidates from trainer-service
			const getTrainerCandidates = async () => {
				return getTrainerCandidatesFromService();
			};

			const result = await this.trainerAssignmentService.assignTrainer(
				bookingId,
				getTrainerCandidates
			);

			if (!result.success) {
				res.status(400).json({
					success: false,
					message: result.message,
					data: result,
				});
				return;
			}

			res.json({
				success: true,
				data: result,
			});
		} catch (error: any) {
			res.status(500).json({
				success: false,
				message: error.message || 'Failed to assign trainer',
			});
		}
	};

	/**
	 * GET /trainer-schedule/:trainerId
	 * Get trainer's 30-day schedule
	 */
	getTrainerSchedule = async (req: Request, res: Response): Promise<void> => {
		try {
			const { trainerId } = req.params;

			if (!trainerId) {
				res.status(400).json({
					success: false,
					message: 'Missing trainerId',
				});
				return;
			}

			const startDate = new Date();
			const endDate = new Date();
			endDate.setDate(endDate.getDate() + 30);

			const slots = await this.scheduleSlotRepo.findByTrainerId(trainerId, {
				startDate,
				endDate,
			});

			res.json({
				success: true,
				data: {
					trainerId,
					slots,
					period: {
						startDate,
						endDate,
					},
				},
			});
		} catch (error: any) {
			res.status(500).json({
				success: false,
				message: error.message || 'Failed to get trainer schedule',
			});
		}
	};

	/**
	 * POST /trainer-attendance
	 * Record trainer attendance
	 */
	recordAttendance = async (req: Request, res: Response): Promise<void> => {
		try {
			const { bookingId, sessionId, trainerId, studentId, date, timeslot, status, notes } = req.body;

			if (!bookingId || !trainerId || !studentId || !date || !timeslot || !status) {
				res.status(400).json({
					success: false,
					message: 'Missing required fields',
				});
				return;
			}

			const attendance = await this.attendanceRepo.create({
				bookingId,
				sessionId: sessionId || null,
				trainerId,
				studentId,
				date: new Date(date),
				timeslot,
				status: status as 'present' | 'absent' | 'rescheduled' | 'cancelled',
				notes: notes || null,
			});

			// If present, increment completed sessions
			if (status === 'present') {
				await this.bookingRepo.incrementCompletedSessions(bookingId);
			}

			res.json({
				success: true,
				data: attendance,
			});
		} catch (error: any) {
			res.status(500).json({
				success: false,
				message: error.message || 'Failed to record attendance',
			});
		}
	};

	/**
	 * POST /auto-assign-trainer
	 * Auto assign trainer to a course purchase
	 */
	autoAssignTrainer = async (req: Request, res: Response): Promise<void> => {
		try {
			const {
				bookingId,
				courseId,
				classType,
				totalSessions,
				deliveryMode,
				startDate,
				preferredTimeSlot,
				studentLocation,
				students,
			} = req.body;

			// Validate required fields
			if (
				!bookingId ||
				!courseId ||
				!classType ||
				!totalSessions ||
				!deliveryMode ||
				!startDate ||
				!preferredTimeSlot ||
				!studentLocation ||
				!students ||
				!Array.isArray(students) ||
				students.length === 0
			) {
				res.status(400).json({
					success: false,
					message: 'Missing required fields',
				});
				return;
			}

			// Validate studentLocation
			if (
				typeof studentLocation.latitude !== 'number' ||
				typeof studentLocation.longitude !== 'number'
			) {
				res.status(400).json({
					success: false,
					message: 'Invalid studentLocation: latitude and longitude must be numbers',
				});
				return;
			}

			// Validate coordinate bounds
			if (
				studentLocation.latitude < -90 ||
				studentLocation.latitude > 90 ||
				studentLocation.longitude < -180 ||
				studentLocation.longitude > 180
			) {
				res.status(400).json({
					success: false,
					message: 'Invalid coordinates: latitude must be between -90 and 90, longitude between -180 and 180',
				});
				return;
			}

			// Validate startDate
			const parsedStartDate = new Date(startDate);
			if (isNaN(parsedStartDate.getTime())) {
				res.status(400).json({
					success: false,
					message: 'Invalid startDate format',
				});
				return;
			}

			// Validate startDate is not in the past
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			parsedStartDate.setHours(0, 0, 0, 0);
			if (parsedStartDate < today) {
				res.status(400).json({
					success: false,
					message: 'startDate cannot be in the past',
				});
				return;
			}

			// Validate time slot format (HH:MM)
			const timeSlotRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
			if (!timeSlotRegex.test(preferredTimeSlot)) {
				res.status(400).json({
					success: false,
					message: 'Invalid preferredTimeSlot format. Expected HH:MM (24-hour format)',
				});
				return;
			}

			// Validate UUID formats
			const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
			if (!uuidRegex.test(bookingId)) {
				res.status(400).json({
					success: false,
					message: 'Invalid bookingId format. Expected UUID',
				});
				return;
			}
			if (!uuidRegex.test(courseId)) {
				res.status(400).json({
					success: false,
					message: 'Invalid courseId format. Expected UUID',
				});
				return;
			}
			for (const student of students) {
				if (!uuidRegex.test(student.id)) {
					res.status(400).json({
						success: false,
						message: `Invalid student ID format for student: ${student.name}. Expected UUID`,
					});
					return;
				}
			}

			// Get auto assignment service from constructor
			if (!this.autoAssignmentService) {
				res.status(500).json({
					success: false,
					message: 'Auto assignment service not available',
				});
				return;
			}

			// Use centralized trainer service client with retry logic
			const fetchTrainers = async (filters: {
				franchiseId?: string | null;
				zoneId?: string | null;
				courseId: string;
				isActive?: boolean;
			}): Promise<TrainerInfo[]> => {
				return this.trainerServiceClient.fetchTrainers(filters);
			};

			// Call auto assignment service
			const result = await this.autoAssignmentService.assignTrainer(
				{
					bookingId,
					courseId,
					classType,
					totalSessions,
					deliveryMode,
					startDate: parsedStartDate,
					preferredTimeSlot,
					studentLocation: {
						latitude: studentLocation.latitude,
						longitude: studentLocation.longitude,
					},
					students,
				},
				fetchTrainers
			);

			// Return result
			res.json({
				success: result.result === 'ASSIGNED',
				result: result.result,
				data: {
					purchaseId: result.purchaseId,
					trainerId: result.trainerId,
					message: result.message,
				},
			});
		} catch (error: any) {
			res.status(500).json({
				success: false,
				message: error.message || 'Failed to auto assign trainer',
			});
		}
	};
}

