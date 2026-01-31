import { Response } from 'express';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import type { PayrollService } from '../services/payroll.service';

export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  getPayrollInfo = asyncHandler(async (req: any, res: Response) => {
    const trainerId = (req as any).user?.trainerId || (req as any).user?.id;
    
    if (!trainerId) {
      return errorResponse(res, {
        statusCode: 401,
        message: 'Unauthorized',
      });
    }

    const payrollInfo = await this.payrollService.getTrainerPayrollInfo(trainerId);

    if (!payrollInfo) {
      return successResponse(res, {
        message: 'Payroll information not available',
        data: null,
      });
    }

    return successResponse(res, {
      message: 'Payroll information fetched successfully',
      data: payrollInfo,
    });
  });

  /**
   * Calculate monthly payroll for a trainer based on student allocations
   * GET /api/trainers/payroll/monthly?month=2024-01-01
   */
  calculateMonthlyPayroll = asyncHandler(async (req: any, res: Response) => {
    const trainerId = (req as any).user?.trainerId || (req as any).user?.id;
    
    if (!trainerId) {
      return errorResponse(res, {
        statusCode: 401,
        message: 'Unauthorized',
      });
    }

    const monthParam = req.query.month as string;
    const month = monthParam ? new Date(monthParam) : new Date();

    if (isNaN(month.getTime())) {
      return errorResponse(res, {
        statusCode: 400,
        message: 'Invalid month parameter. Use format: YYYY-MM-DD',
      });
    }

    const calculation = await this.payrollService.calculateMonthlyPayroll(trainerId, month);

    return successResponse(res, {
      message: 'Monthly payroll calculated successfully',
      data: calculation,
    });
  });

  /**
   * Get payroll calculation history
   * GET /api/trainers/payroll/history?limit=12
   */
  getPayrollHistory = asyncHandler(async (req: any, res: Response) => {
    const trainerId = (req as any).user?.trainerId || (req as any).user?.id;
    
    if (!trainerId) {
      return errorResponse(res, {
        statusCode: 401,
        message: 'Unauthorized',
      });
    }

    const limit = parseInt(req.query.limit as string, 10) || 12;

    const history = await this.payrollService.getPayrollHistory(trainerId, limit);

    return successResponse(res, {
      message: 'Payroll history fetched successfully',
      data: history,
    });
  });

  /**
   * Get active student count for a trainer
   * GET /api/trainers/payroll/active-students?date=2024-01-15
   */
  getActiveStudentCount = asyncHandler(async (req: any, res: Response) => {
    const trainerId = (req as any).user?.trainerId || (req as any).user?.id;
    
    if (!trainerId) {
      return errorResponse(res, {
        statusCode: 401,
        message: 'Unauthorized',
      });
    }

    const dateParam = req.query.date as string;
    const date = dateParam ? new Date(dateParam) : new Date();

    if (isNaN(date.getTime())) {
      return errorResponse(res, {
        statusCode: 400,
        message: 'Invalid date parameter. Use format: YYYY-MM-DD',
      });
    }

    const count = await this.payrollService.getActiveStudentCount(trainerId, date);

    return successResponse(res, {
      message: 'Active student count fetched successfully',
      data: {
        trainerId,
        date: date.toISOString().split('T')[0],
        activeStudentCount: count,
      },
    });
  });
}

