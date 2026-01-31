import type { Pool } from 'pg';
import { TrainerStudentAllocationRepository } from '../models/trainerStudentAllocation.model';

export interface PayrollConfig {
  sessionsPerDay: number;
  baseSalary: number;
  travelAllowancePerDay: number;
  totalMonthlyCompensation: number;
}

export interface TrainerPayrollInfo {
  sessionsPerDay: number;
  monthlySalary: number;
  baseSalary: number;
  travelAllowance: number;
  bankDetailsProvided: boolean;
}

export interface MonthlyPayrollCalculation {
  baseSalaryAmount: number;
  allowanceAmount: number;
  totalPayout: number;
  calculationDetails: {
    monthStart: string;
    monthEnd: string;
    monthDays: number;
    baseSalaryRanges: Array<{
      startDate: string;
      endDate: string;
      studentCount: number;
      days: number;
      dailyBase: number;
      rangeBaseSalary: number;
    }>;
    allowance: {
      dailyRatePerStudent: number;
      totalAllowance: number;
    };
  };
}

export interface PayrollRange {
  startDate: Date;
  endDate: Date;
  studentCount: number;
  days: number;
  dailyBase: number;
  rangeBaseSalary: number;
}

export class PayrollService {
  private readonly allocationRepo: TrainerStudentAllocationRepository;

  constructor(private readonly pool: Pool) {
    this.allocationRepo = new TrainerStudentAllocationRepository(pool);
  }

  /**
   * Calculate trainer's average sessions per day from their scheduled sessions
   * Uses the last 30 days of scheduled sessions to determine average daily sessions
   */
  async calculateSessionsPerDay(trainerId: string): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await this.pool.query<{ date: string; session_count: number }>(
      `
        SELECT 
          DATE(scheduled_date) as date,
          COUNT(*) as session_count
        FROM tutoring_sessions
        WHERE trainer_id = $1
          AND scheduled_date >= $2
          AND status IN ('scheduled', 'in_progress', 'completed')
        GROUP BY DATE(scheduled_date)
        ORDER BY date DESC
      `,
      [trainerId, thirtyDaysAgo]
    );

    if (result.rows.length === 0) {
      return 0;
    }

    // Calculate average sessions per day
    const totalSessions = result.rows.reduce((sum: number, row: any) => sum + parseInt(row.session_count.toString()), 0);
    const averageSessionsPerDay = totalSessions / result.rows.length;

    // Round to nearest integer and clamp between 4-8
    const sessionsPerDay = Math.max(4, Math.min(8, Math.round(averageSessionsPerDay)));

    return sessionsPerDay;
  }

  /**
   * Get payroll configuration for a given sessions per day
   */
  async getPayrollConfig(sessionsPerDay: number): Promise<PayrollConfig | null> {
    const result = await this.pool.query<PayrollConfig>(
      `
        SELECT 
          sessions_per_day as "sessionsPerDay",
          base_salary as "baseSalary",
          travel_allowance_per_day as "travelAllowancePerDay",
          total_monthly_compensation as "totalMonthlyCompensation"
        FROM payroll_config
        WHERE sessions_per_day = $1
          AND is_active = true
          AND (effective_until IS NULL OR effective_until >= CURRENT_DATE)
        ORDER BY effective_from DESC
        LIMIT 1
      `,
      [sessionsPerDay]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  }

  /**
   * Get trainer's payroll information including monthly salary
   */
  async getTrainerPayrollInfo(trainerId: string): Promise<TrainerPayrollInfo | null> {
    // Check if trainer has bank details
    const bankDetailsResult = await this.pool.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM trainer_bank_details WHERE trainer_id = $1`,
      [trainerId]
    );
    const bankDetailsProvided = parseInt(bankDetailsResult.rows[0]?.count?.toString() || '0') > 0;

    // Calculate sessions per day
    const sessionsPerDay = await this.calculateSessionsPerDay(trainerId);

    if (sessionsPerDay === 0) {
      return null;
    }

    // Get payroll config
    const config = await this.getPayrollConfig(sessionsPerDay);

    if (!config) {
      return null;
    }

    return {
      sessionsPerDay,
      monthlySalary: config.totalMonthlyCompensation,
      baseSalary: config.baseSalary,
      travelAllowance: config.travelAllowancePerDay * 30,
      bankDetailsProvided,
    };
  }

  /**
   * Base salary slabs based on student count
   */
  private getBaseSalarySlab(studentCount: number): number {
    const slabs: Record<number, number> = {
      3: 9000,
      4: 12000,
      5: 15000,
      6: 18000,
      7: 21000,
      8: 24000,
    };
    return slabs[studentCount] || 0;
  }

  /**
   * Count working days (Mon-Sat) in a date range
   */
  private countWorkingDays(startDate: Date, endDate: Date): number {
    let count = 0;
    const current = new Date(startDate);
    while (current <= endDate) {
      const dayOfWeek = current.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
      if (dayOfWeek >= 1 && dayOfWeek <= 6) {
        count++;
      }
      current.setDate(current.getDate() + 1);
    }
    return count;
  }

  /**
   * Check if a date is a working day (Mon-Sat)
   */
  private isWorkingDay(date: Date): boolean {
    const dayOfWeek = date.getDay();
    return dayOfWeek >= 1 && dayOfWeek <= 6;
  }

  /**
   * Calculate monthly payroll for a trainer based on student allocations
   * Uses working days only (Mon-Sat, excludes Sundays)
   * Handles session substitutions for allowance adjustments
   */
  async calculateMonthlyPayroll(
    trainerId: string,
    month: Date
  ): Promise<MonthlyPayrollCalculation> {
    const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0); // Last day of month
    const workingDays = this.countWorkingDays(monthStart, monthEnd);
    const dailyAllowancePerStudent = 25.0;

    // Get daily student counts for working days only
    const dailyCounts = await this.allocationRepo.getDailyStudentCounts(
      trainerId,
      monthStart,
      monthEnd
    );

    // Filter to working days only and group into ranges with constant student count
    const workingDayCounts = dailyCounts.filter((dc) => this.isWorkingDay(dc.date));
    const ranges: PayrollRange[] = [];
    let currentRange: PayrollRange | null = null;

    for (const dayCount of workingDayCounts) {
      if (!currentRange || currentRange.studentCount !== dayCount.studentCount) {
        // Start new range
        if (currentRange) {
          ranges.push(currentRange);
        }
        currentRange = {
          startDate: dayCount.date,
          endDate: dayCount.date,
          studentCount: dayCount.studentCount,
          days: 1,
          dailyBase: 0,
          rangeBaseSalary: 0,
        };
      } else {
        // Extend current range
        currentRange.endDate = dayCount.date;
        currentRange.days += 1;
      }
    }

    if (currentRange) {
      ranges.push(currentRange);
    }

    // Calculate base salary for each range (per working day)
    let totalBaseSalary = 0;
    const baseSalaryRanges = ranges.map((range) => {
      const monthlyBase = this.getBaseSalarySlab(range.studentCount);
      const dailyBase = monthlyBase / workingDays; // Divide by working days, not calendar days
      const rangeBaseSalary = dailyBase * range.days;
      totalBaseSalary += rangeBaseSalary;

      return {
        startDate: range.startDate.toISOString().split('T')[0],
        endDate: range.endDate.toISOString().split('T')[0],
        studentCount: range.studentCount,
        days: range.days,
        dailyBase: Math.round(dailyBase * 100) / 100,
        rangeBaseSalary: Math.round(rangeBaseSalary * 100) / 100,
      };
    });

    // Calculate allowance: per student per working day, adjusted for substitutions
    const allocations = await this.allocationRepo.findByTrainerId(trainerId);
    let totalAllowance = 0;

    // Get substitutions where this trainer is original (loses allowance)
    const substitutionsAsOriginal = await this.pool.query(
      `
        SELECT DISTINCT session_date, student_id
        FROM trainer_session_substitutions
        WHERE original_trainer_id = $1
          AND session_date BETWEEN $2 AND $3
          AND EXTRACT(DOW FROM session_date) BETWEEN 1 AND 6
      `,
      [trainerId, monthStart, monthEnd]
    );
    const substitutedDays = new Set(
      substitutionsAsOriginal.rows.map(
        (r: any) => `${r.session_date.toISOString().split('T')[0]}-${r.student_id}`
      )
    );

    // Get substitutions where this trainer is substitute (gains allowance)
    const substitutionsAsSubstitute = await this.pool.query(
      `
        SELECT DISTINCT session_date, student_id
        FROM trainer_session_substitutions
        WHERE substitute_trainer_id = $1
          AND session_date BETWEEN $2 AND $3
          AND EXTRACT(DOW FROM session_date) BETWEEN 1 AND 6
      `,
      [trainerId, monthStart, monthEnd]
    );
    const substituteDays = new Set(
      substitutionsAsSubstitute.rows.map(
        (r: any) => `${r.session_date.toISOString().split('T')[0]}-${r.student_id}`
      )
    );

    // Calculate allowance for original allocations (excluding substituted days)
    for (const allocation of allocations) {
      const allocationStart = new Date(allocation.startDate);
      const allocationEnd = allocation.endDate
        ? new Date(allocation.endDate)
        : monthEnd;

      // Calculate overlap with month
      const overlapStart = allocationStart > monthStart ? allocationStart : monthStart;
      const overlapEnd = allocationEnd < monthEnd ? allocationEnd : monthEnd;

      if (overlapStart <= overlapEnd) {
        // Count working days in overlap, excluding substituted days
        const current = new Date(overlapStart);
        while (current <= overlapEnd) {
          if (this.isWorkingDay(current)) {
            const dayKey = `${current.toISOString().split('T')[0]}-${allocation.studentId}`;
            if (!substitutedDays.has(dayKey)) {
              totalAllowance += dailyAllowancePerStudent;
            }
          }
          current.setDate(current.getDate() + 1);
        }
      }
    }

    // Add allowance for substitute days
    for (const sub of substitutionsAsSubstitute.rows) {
      totalAllowance += dailyAllowancePerStudent;
    }

    const totalPayout = totalBaseSalary + totalAllowance;

    return {
      baseSalaryAmount: Math.round(totalBaseSalary * 100) / 100,
      allowanceAmount: Math.round(totalAllowance * 100) / 100,
      totalPayout: Math.round(totalPayout * 100) / 100,
      calculationDetails: {
        monthStart: monthStart.toISOString().split('T')[0],
        monthEnd: monthEnd.toISOString().split('T')[0],
        monthDays: workingDays, // Working days, not calendar days
        baseSalaryRanges,
        allowance: {
          dailyRatePerStudent: dailyAllowancePerStudent,
          totalAllowance: Math.round(totalAllowance * 100) / 100,
        },
      },
    };
  }

  /**
   * Calculate monthly payroll using SQL function (alternative method)
   */
  async calculateMonthlyPayrollSQL(
    trainerId: string,
    month: Date
  ): Promise<MonthlyPayrollCalculation> {
    const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);

    const result = await this.pool.query(
      `SELECT calculate_trainer_monthly_payroll($1, $2) as result`,
      [trainerId, monthStart]
    );

    const payrollData = result.rows[0].result;

    return {
      baseSalaryAmount: parseFloat(payrollData.base_salary_amount),
      allowanceAmount: parseFloat(payrollData.allowance_amount),
      totalPayout: parseFloat(payrollData.total_payout),
      calculationDetails: {
        monthStart: payrollData.calculation_details.month_start,
        monthEnd: payrollData.calculation_details.month_end,
        monthDays: payrollData.calculation_details.month_days,
        baseSalaryRanges: payrollData.calculation_details.base_salary_ranges || [],
        allowance: {
          dailyRatePerStudent: parseFloat(
            payrollData.calculation_details.allowance.daily_rate_per_student
          ),
          totalAllowance: parseFloat(payrollData.calculation_details.allowance.total_allowance),
        },
      },
    };
  }

  /**
   * Get active student count for a trainer on a given date
   */
  async getActiveStudentCount(trainerId: string, date: Date): Promise<number> {
    return this.allocationRepo.getActiveStudentCount(trainerId, date);
  }

  /**
   * Save payroll calculation to database
   */
  async savePayrollCalculation(
    trainerId: string,
    calculation: MonthlyPayrollCalculation,
    status: 'calculated' | 'approved' | 'paid' = 'calculated'
  ): Promise<string> {
    const monthStart = new Date(calculation.calculationDetails.monthStart);

    const result = await this.pool.query(
      `
        INSERT INTO trainer_payroll_calculations (
          trainer_id,
          calculation_month,
          base_salary_amount,
          allowance_amount,
          total_payout,
          calculation_details,
          status,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        ON CONFLICT (trainer_id, calculation_month)
        DO UPDATE SET
          base_salary_amount = EXCLUDED.base_salary_amount,
          allowance_amount = EXCLUDED.allowance_amount,
          total_payout = EXCLUDED.total_payout,
          calculation_details = EXCLUDED.calculation_details,
          status = EXCLUDED.status,
          updated_at = NOW()
        RETURNING id
      `,
      [
        trainerId,
        monthStart,
        calculation.baseSalaryAmount,
        calculation.allowanceAmount,
        calculation.totalPayout,
        JSON.stringify(calculation.calculationDetails),
        status,
      ]
    );

    const snapshotId = result.rows[0].id;
    
    // Emit PAYROLL_RECALCULATED event
    try {
      const { getEventBus } = await import('@kodingcaravan/shared/events/eventBus');
      const eventBus = getEventBus();
      
      const monthKey = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}-01`;
      
      await eventBus.emit({
        type: 'PAYROLL_RECALCULATED',
        timestamp: Date.now(),
        userId: trainerId,
        role: 'trainer',
        trainerId,
        month: monthKey,
        snapshotId,
        recalculatedBy: status === 'calculated' ? 'system' : 'admin',
        metadata: {
          baseSalaryAmount: calculation.baseSalaryAmount,
          allowanceAmount: calculation.allowanceAmount,
          totalPayout: calculation.totalPayout,
        },
      });
    } catch (error: any) {
      console.error('[Payroll Service] Failed to emit PAYROLL_RECALCULATED event (non-critical):', error?.message);
    }
    
    return snapshotId;
  }

  /**
   * Get payroll calculation history for a trainer
   */
  async getPayrollHistory(
    trainerId: string,
    limit: number = 12
  ): Promise<Array<MonthlyPayrollCalculation & { id: string; status: string; createdAt: Date }>> {
    const result = await this.pool.query(
      `
        SELECT 
          id,
          calculation_month,
          base_salary_amount,
          allowance_amount,
          total_payout,
          calculation_details,
          status,
          created_at
        FROM trainer_payroll_calculations
        WHERE trainer_id = $1
        ORDER BY calculation_month DESC
        LIMIT $2
      `,
      [trainerId, limit]
    );

    return result.rows.map((row: any) => ({
      id: row.id,
      status: row.status,
      createdAt: new Date(row.created_at),
      baseSalaryAmount: parseFloat(row.base_salary_amount),
      allowanceAmount: parseFloat(row.allowance_amount),
      totalPayout: parseFloat(row.total_payout),
      calculationDetails: row.calculation_details,
    }));
  }
}

