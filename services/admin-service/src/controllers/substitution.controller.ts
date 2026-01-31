import { Request, Response } from 'express';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import { SubstitutionService } from '../services/substitution.service';
import { z } from 'zod';

const substitutionService = new SubstitutionService();

const createSubstitutionSchema = z.object({
  sessionDate: z.string().refine((val: string) => !isNaN(Date.parse(val)), {
    message: 'Invalid date format',
  }),
  originalTrainerId: z.string().uuid(),
  substituteTrainerId: z.string().uuid(),
  studentId: z.string().uuid(),
});

export class SubstitutionController {
  /**
   * Create a session substitution
   * POST /api/v1/admin/substitutions
   */
  static create = asyncHandler(async (req: Request, res: Response) => {
    const adminId = (req as any).adminId || (req as any).userId;

    if (!adminId) {
      return errorResponse(res, {
        statusCode: 401,
        message: 'Admin authentication required',
      });
    }

    const body = createSubstitutionSchema.parse(req.body);
    const sessionDate = new Date(body.sessionDate);

    const substitution = await substitutionService.createSubstitution(
      {
        sessionDate,
        originalTrainerId: body.originalTrainerId,
        substituteTrainerId: body.substituteTrainerId,
        studentId: body.studentId,
      },
      adminId
    );

    return successResponse(res, {
      message: 'Substitution created successfully',
      data: substitution,
    });
  });

  /**
   * Get substitutions for a trainer
   * GET /api/v1/admin/substitutions/trainer/:trainerId?startDate=2024-01-01&endDate=2024-01-31&asSubstitute=true
   */
  static getTrainerSubstitutions = asyncHandler(async (req: Request, res: Response) => {
    const { trainerId } = req.params;
    const { startDate, endDate, asSubstitute } = req.query;

    if (!startDate || !endDate) {
      return errorResponse(res, {
        statusCode: 400,
        message: 'startDate and endDate query parameters are required',
      });
    }

    const substitutions = await substitutionService.getTrainerSubstitutions(
      trainerId,
      new Date(startDate as string),
      new Date(endDate as string),
      { asSubstitute: asSubstitute === 'true' }
    );

    return successResponse(res, {
      message: 'Substitutions retrieved successfully',
      data: substitutions,
    });
  });

  /**
   * Get substitution by ID
   * GET /api/v1/admin/substitutions/:id
   */
  static getById = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const substitution = await substitutionService.getSubstitutionById(id);

    if (!substitution) {
      return errorResponse(res, {
        statusCode: 404,
        message: 'Substitution not found',
      });
    }

    return successResponse(res, {
      message: 'Substitution retrieved successfully',
      data: substitution,
    });
  });

  /**
   * Delete a substitution
   * DELETE /api/v1/admin/substitutions/:id
   */
  static delete = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const adminId = (req as any).adminId || (req as any).userId;

    if (!adminId) {
      return errorResponse(res, {
        statusCode: 401,
        message: 'Admin authentication required',
      });
    }

    const deleted = await substitutionService.deleteSubstitution(id);

    if (!deleted) {
      return errorResponse(res, {
        statusCode: 404,
        message: 'Substitution not found',
      });
    }

    return successResponse(res, {
      message: 'Substitution deleted successfully',
      data: { id },
    });
  });
}

