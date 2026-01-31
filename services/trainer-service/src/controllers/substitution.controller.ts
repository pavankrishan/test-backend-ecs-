import { Response } from 'express';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import type { Pool } from 'pg';
import { getPostgresPool } from '../config/database';

export class SubstitutionController {
  constructor(private readonly pool: Pool = getPostgresPool()) {}

  /**
   * Get substitutions where trainer is original (sessions given away)
   * GET /api/trainers/substitutions/original?startDate=2024-01-01&endDate=2024-01-31
   */
  getOriginalSubstitutions = asyncHandler(async (req: any, res: Response) => {
    const trainerId = (req as any).user?.trainerId || (req as any).user?.id;
    
    if (!trainerId) {
      return errorResponse(res, {
        statusCode: 401,
        message: 'Unauthorized',
      });
    }

    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return errorResponse(res, {
        statusCode: 400,
        message: 'startDate and endDate query parameters are required',
      });
    }

    const result = await this.pool.query(
      `
        SELECT 
          sub.id,
          sub.session_date,
          sub.student_id,
          sub.substitute_trainer_id,
          s.name AS student_name,
          t.name AS substitute_trainer_name
        FROM trainer_session_substitutions sub
        JOIN students s ON s.id = sub.student_id
        JOIN trainers t ON t.id = sub.substitute_trainer_id
        WHERE sub.original_trainer_id = $1
          AND sub.session_date BETWEEN $2 AND $3
        ORDER BY sub.session_date DESC
      `,
      [trainerId, startDate, endDate]
    );

    const substitutions = result.rows.map((row: any) => ({
      id: row.id,
      sessionDate: row.session_date.toISOString().split('T')[0],
      studentId: row.student_id,
      studentName: row.student_name,
      substituteTrainerId: row.substitute_trainer_id,
      substituteTrainerName: row.substitute_trainer_name,
    }));

    return successResponse(res, {
      message: 'Substitutions retrieved successfully',
      data: substitutions,
    });
  });

  /**
   * Get substitutions where trainer is substitute (sessions taken over)
   * GET /api/trainers/substitutions/substitute?startDate=2024-01-01&endDate=2024-01-31
   */
  getSubstituteSubstitutions = asyncHandler(async (req: any, res: Response) => {
    const trainerId = (req as any).user?.trainerId || (req as any).user?.id;
    
    if (!trainerId) {
      return errorResponse(res, {
        statusCode: 401,
        message: 'Unauthorized',
      });
    }

    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return errorResponse(res, {
        statusCode: 400,
        message: 'startDate and endDate query parameters are required',
      });
    }

    const result = await this.pool.query(
      `
        SELECT 
          sub.id,
          sub.session_date,
          sub.student_id,
          sub.original_trainer_id,
          s.name AS student_name,
          t.name AS original_trainer_name
        FROM trainer_session_substitutions sub
        JOIN students s ON s.id = sub.student_id
        JOIN trainers t ON t.id = sub.original_trainer_id
        WHERE sub.substitute_trainer_id = $1
          AND sub.session_date BETWEEN $2 AND $3
        ORDER BY sub.session_date DESC
      `,
      [trainerId, startDate, endDate]
    );

    const substitutions = result.rows.map((row: any) => ({
      id: row.id,
      sessionDate: row.session_date.toISOString().split('T')[0],
      studentId: row.student_id,
      studentName: row.student_name,
      originalTrainerId: row.original_trainer_id,
      originalTrainerName: row.original_trainer_name,
    }));

    return successResponse(res, {
      message: 'Substitutions retrieved successfully',
      data: substitutions,
    });
  });
}

