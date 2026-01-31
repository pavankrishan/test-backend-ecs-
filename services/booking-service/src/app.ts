/**
 * Booking Service Express App
 */

import express, { type Application } from 'express';
import timeout from 'connect-timeout';
import { globalErrorHandler, createHealthCheckEndpoints, getRedisClient } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';
import { getPool } from './config/database';
import { CityRepository } from './models/city.model';
import { ClusterRepository } from './models/cluster.model';
import { SessionBookingRepository } from './models/sessionBooking.model';
import { PreBookingRepository } from './models/preBooking.model';
import { ScheduleSlotRepository } from './models/scheduleSlot.model';
import { AttendanceRecordRepository } from './models/attendanceRecord.model';
import { ZoneRepository } from './models/zone.model';
import { FranchiseRepository } from './models/franchise.model';
import { CoursePurchaseRepository } from './models/coursePurchase.model';
import { PurchaseSessionRepository } from './models/purchaseSession.model';
import { CertificateRepository } from './models/certificate.model';
import { ServiceAreaService } from './services/serviceArea.service';
import { TrainerAssignmentService } from './services/trainerAssignment.service';
import { DemandCalculatorService } from './services/demandCalculator.service';
import { SessionScheduleGeneratorService } from './services/sessionScheduleGenerator.service';
import { PurchaseValidatorService } from './services/purchaseValidator.service';
import { TrainerEligibilityCheckerService } from './services/trainerEligibilityChecker.service';
import { AutoTrainerAssignmentService } from './services/autoTrainerAssignment.service';
import { BookingController } from './controllers/booking.controller';
import { createBookingRoutes } from './routes/booking.routes';
import { ensureFeatureFlagTable } from './models/featureFlag.model';
import { ensureCouponTables } from './models/coupon.model';
import { ensurePricingConfigTable } from './models/pricingConfig.model';
import { ensurePreBookingCapacityTable } from './models/preBookingCapacity.model';

const app: Application = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request timeout middleware (30 seconds)
app.use(timeout('30s'));

// Timeout handler - must be after timeout middleware
app.use((req, res, next) => {
  if (!req.timedout) next();
});

// Initialize repositories
const pool = getPool();

// Health check endpoints with dependency checks
const { healthHandler, readyHandler } = createHealthCheckEndpoints({
	serviceName: 'booking-service',
	postgresPool: pool,
	redisClient: getRedisClient(),
});

app.get('/health', healthHandler);
app.get('/ready', readyHandler);

// Initialize repositories
const cityRepo = new CityRepository(pool);
const clusterRepo = new ClusterRepository(pool);
const bookingRepo = new SessionBookingRepository(pool);
const preBookingRepo = new PreBookingRepository(pool);
const scheduleSlotRepo = new ScheduleSlotRepository(pool);
const attendanceRepo = new AttendanceRecordRepository(pool);
const zoneRepo = new ZoneRepository(pool);
const franchiseRepo = new FranchiseRepository(pool);
const purchaseRepo = new CoursePurchaseRepository(pool);
const purchaseSessionRepo = new PurchaseSessionRepository(pool);
const certificateRepo = new CertificateRepository(pool);

// Initialize services
const serviceAreaService = new ServiceAreaService(cityRepo, clusterRepo, pool);
const trainerAssignmentService = new TrainerAssignmentService(
	bookingRepo,
	scheduleSlotRepo,
	clusterRepo,
	pool
);
const demandCalculator = new DemandCalculatorService(preBookingRepo, pool);
const scheduleGenerator = new SessionScheduleGeneratorService();
const purchaseValidator = new PurchaseValidatorService();
const eligibilityChecker = new TrainerEligibilityCheckerService(scheduleSlotRepo, pool);
const autoAssignmentService = new AutoTrainerAssignmentService(
	purchaseRepo,
	purchaseSessionRepo,
	scheduleSlotRepo,
	zoneRepo,
	franchiseRepo,
	certificateRepo,
	scheduleGenerator,
	purchaseValidator,
	eligibilityChecker,
	pool
);

// Initialize new tables
(async () => {
	try {
		await ensureFeatureFlagTable(pool);
		await ensureCouponTables(pool);
		await ensurePricingConfigTable(pool);
		await ensurePreBookingCapacityTable(pool);
		logger.info('New tables initialized', { service: 'booking-service' });
	} catch (error) {
		logger.error('Error initializing tables', { 
			service: 'booking-service',
			error: error instanceof Error ? error.message : String(error)
		});
	}
})();

// Initialize controller
const bookingController = new BookingController(
	serviceAreaService,
	trainerAssignmentService,
	bookingRepo,
	preBookingRepo,
	demandCalculator,
	scheduleSlotRepo,
	attendanceRepo,
	autoAssignmentService
);

// Routes
app.use('/api/v1/booking', createBookingRoutes(bookingController));

// Error handler
app.use(globalErrorHandler);

export default app;

