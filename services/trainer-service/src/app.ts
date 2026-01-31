import express from 'express';
import timeout from 'connect-timeout';
import type { Express } from 'express';
import { globalErrorHandler, createHealthCheckEndpoints, getRedisClient } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';
import { initPostgres, getPostgresPool } from './config/database';
import { ensureTrainerProfileTable, TrainerProfileRepository } from './models/trainerProfile.model';
import { ensureTrainerPerformanceTable, TrainerPerformanceRepository } from './models/trainerPerformance.model';
import { ensureTrainerDocumentsTable, TrainerDocumentsRepository } from './models/trainerDocuments.model';
import { ensureTrainerLocationTable, TrainerLocationRepository } from './models/trainerLocation.model';
import { ensureTrainerBaseLocationTable, TrainerBaseLocationRepository } from './models/trainerBaseLocation.model';
import { ensureTrainerBankDetailsTable, TrainerBankDetailsRepository } from './models/trainerBankDetails.model';
import { ensureTrainerSessionSubstitutionsTable } from './models/trainerSessionSubstitution.model';
import { ensureTrainerStudentAllocationsTable } from './models/trainerStudentAllocation.model';
import { TrainerService } from './services/trainer.service';
import { VerificationService } from './services/verification.service';
import { FleetService } from './services/fleet.service';
import { BankDetailsService } from './services/bankDetails.service';
import { PayrollService } from './services/payroll.service';
import { TrainerController } from './controllers/trainer.controller';
import { VerificationController } from './controllers/verification.controller';
import { FleetController } from './controllers/fleet.controller';
import { BankDetailsController } from './controllers/bankDetails.controller';
import { PayrollController } from './controllers/payroll.controller';
import { SubstitutionController } from './controllers/substitution.controller';
import { createTrainerRoutes } from './routes/trainer.routes';
import { createVerificationRoutes } from './routes/verification.routes';
import { createFleetRoutes } from './routes/fleet.routes';
import { createBankDetailsRoutes } from './routes/bankDetails.routes';
import { createPayrollRoutes } from './routes/payroll.routes';
import { createSubstitutionRoutes } from './routes/substitution.routes';

const app: Express = express();

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Request timeout middleware (30 seconds)
app.use(timeout('30s'));

// Timeout handler - must be after timeout middleware
app.use((req, res, next) => {
  if (!req.timedout) next();
});

// Health check endpoints (will be initialized after databases are ready)
let healthCheckHandlers: { healthHandler: any; readyHandler: any } | null = null;

async function setupHealthChecks() {
  if (!healthCheckHandlers) {
    await initPostgres();
    const pool = getPostgresPool();
    
    healthCheckHandlers = createHealthCheckEndpoints({
      serviceName: 'trainer-service',
      postgresPool: pool,
      redisClient: getRedisClient(),
    });
  }
  return healthCheckHandlers;
}

// Health check (liveness probe)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'trainer-service',
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe - checks dependencies
app.get('/ready', async (_req, res) => {
  try {
    const handlers = await setupHealthChecks();
    await handlers.readyHandler(_req, res);
  } catch (error) {
    res.status(503).json({
      ready: false,
      service: 'trainer-service',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
  }
});

// Readiness probe
let servicesInitialized = false;

async function initializeServices(): Promise<void> {
  if (servicesInitialized) {
    return;
  }

  await initPostgres();
  const pool = getPostgresPool();

  await ensureTrainerProfileTable(pool);
  await ensureTrainerPerformanceTable(pool);
  await ensureTrainerDocumentsTable(pool);
  await ensureTrainerLocationTable(pool);
  await ensureTrainerBaseLocationTable(pool);
  await ensureTrainerBankDetailsTable(pool);
  await ensureTrainerStudentAllocationsTable(pool);
  await ensureTrainerSessionSubstitutionsTable(pool);

  const profileRepo = new TrainerProfileRepository(pool);
  const performanceRepo = new TrainerPerformanceRepository(pool);
  const documentsRepo = new TrainerDocumentsRepository(pool);
  const locationRepo = new TrainerLocationRepository(pool);
  const baseLocationRepo = new TrainerBaseLocationRepository(pool);
  const bankDetailsRepo = new TrainerBankDetailsRepository(pool);

  const trainerService = new TrainerService(profileRepo, performanceRepo, documentsRepo, locationRepo, baseLocationRepo, pool);
  const verificationService = new VerificationService(documentsRepo, profileRepo);
  const fleetService = new FleetService(locationRepo, profileRepo);
  const bankDetailsService = new BankDetailsService(bankDetailsRepo, pool);
  const payrollService = new PayrollService(pool);

  const trainerController = new TrainerController(trainerService);
  const verificationController = new VerificationController(verificationService);
  const fleetController = new FleetController(fleetService);
  const bankDetailsController = new BankDetailsController(bankDetailsService);
  const payrollController = new PayrollController(payrollService);
  const substitutionController = new SubstitutionController();

  app.use('/api/trainers/verification', createVerificationRoutes(verificationController));
  app.use('/api/trainers/fleet', createFleetRoutes(fleetController));
  app.use('/api/trainers/bank-details', createBankDetailsRoutes(bankDetailsController));
  app.use('/api/trainers/payroll', createPayrollRoutes(payrollController));
  app.use('/api/trainers/substitutions', createSubstitutionRoutes(substitutionController));
  app.use('/api/trainers', createTrainerRoutes(trainerController));

  servicesInitialized = true;
  logger.info('Trainer Service routes initialized', { service: 'trainer-service' });
}

app.use(async (req, res, next) => {
  if (!servicesInitialized && req.path !== '/' && req.path !== '/health') {
    try {
      await initializeServices();
    } catch (error) {
      logger.error('Failed to initialize Trainer Service', { 
        service: 'trainer-service',
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        success: false,
        message: 'Trainer Service initialization failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  next();
});

app.get('/', (_req, res) => {
  res.json({
    message: 'Trainer Service Running ✅',
    endpoints: {
      trainers: '/api/trainers',
      verification: '/api/trainers/verification',
      fleet: '/api/trainers/fleet',
      bankDetails: '/api/trainers/bank-details',
      payroll: '/api/trainers/payroll',
      health: '/health',
    },
  });
});

app.use(globalErrorHandler);

// Eager initialization with delay to allow PostgreSQL to be ready
// This is non-blocking - service will start even if this fails
setTimeout(() => {
  void initializeServices().catch((error) => {
    logger.error('Trainer Service eager initialization failed', { 
      service: 'trainer-service',
      error: error instanceof Error ? error.message : String(error)
    });
    logger.info('Service will retry initialization on first request', { service: 'trainer-service' });
  });
}, 2000); // Wait 2 seconds before attempting eager initialization

export default app;
