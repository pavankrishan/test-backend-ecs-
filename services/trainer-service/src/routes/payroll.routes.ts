import { Router } from 'express';
import type { PayrollController } from '../controllers/payroll.controller';
import { requireAuth } from '../middlewares/authMiddleware';

export function createPayrollRoutes(controller: PayrollController): Router {
  const router = Router();

  // Legacy endpoint (sessions-based payroll)
  router.get('/info', requireAuth, controller.getPayrollInfo);

  // New endpoints (student-allocation-based payroll)
  router.get('/monthly', requireAuth, controller.calculateMonthlyPayroll);
  router.get('/history', requireAuth, controller.getPayrollHistory);
  router.get('/active-students', requireAuth, controller.getActiveStudentCount);

  return router;
}

