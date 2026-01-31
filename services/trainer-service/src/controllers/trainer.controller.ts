import { Response, Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import { AppError } from '@kodingcaravan/shared';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import type { TrainerService, TrainerListOptions } from '../services/trainer.service';
import type { ZodRequest } from '@kodingcaravan/shared/types/zodRequest';
import { getPostgresPool } from '../config/database';

const listQuerySchema = z.object({
  search: z.string().trim().optional(),
  verified: z.coerce.boolean().optional(),
  specialties: z
    .string()
    .optional()
    .transform((value: string | undefined) => (value ? value.split(',').map((item: string) => item.trim()).filter(Boolean) : undefined)),
  limit: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().optional(),
});

const trainerIdParams = z.object({
  trainerId: z.string().uuid(),
});

const profileBodySchema = z.object({
  fullName: z.string().min(2).max(150).nullable().optional(),
  bio: z.string().min(10).max(2000).nullable().optional(),
  specialties: z.array(z.string().min(2).max(100)).nullable().optional(),
  yearsOfExperience: z.number().int().min(0).max(60).nullable().optional(),
  hourlyRate: z.number().min(0).max(100000).nullable().optional(),
  availability: z.record(z.any()).nullable().optional(),
  preferredLanguages: z.array(z.string().min(2).max(40)).nullable().optional(),
  certifications: z.array(z.string().min(2).max(150)).nullable().optional(),
});

const performanceBodySchema = z.object({
  completedSessions: z.number().int().min(0).optional(),
  cancelledSessions: z.number().int().min(0).optional(),
  activeStudents: z.number().int().min(0).optional(),
  averageAttendance: z.number().min(0).max(100).nullable().optional(),
  averageFeedbackScore: z.number().min(0).max(5).nullable().optional(),
  responseTimeMinutes: z.number().min(0).nullable().optional(),
  onTimeRate: z.number().min(0).max(100).nullable().optional(),
  earningsTotal: z.number().min(0).nullable().optional(),
  earningsMonth: z.number().min(0).nullable().optional(),
});

const confirmLocationBodySchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).nullable().optional(),
  source: z.literal('gps_confirmed').optional().default('gps_confirmed'),
});

const allocationPreferenceBodySchema = z.object({
  acceptMore: z.boolean(),
});

type ListTrainersRequest = ZodRequest<{ query: typeof listQuerySchema }>;
type TrainerIdRequest = ZodRequest<{ params: typeof trainerIdParams }>;
type UpdateProfileRequest = ZodRequest<{ params: typeof trainerIdParams; body: typeof profileBodySchema }>;
type UpdatePerformanceRequest = ZodRequest<{ params: typeof trainerIdParams; body: typeof performanceBodySchema }>;
type ConfirmLocationRequest = ZodRequest<{ body: typeof confirmLocationBodySchema }>;
type AllocationPreferenceRequest = ZodRequest<{ body: typeof allocationPreferenceBodySchema }>;

export class TrainerController {
  constructor(private readonly trainerService: TrainerService) {}

  listTrainers = asyncHandler(async (req: ListTrainersRequest, res: Response) => {
    const { search, verified, specialties, limit, page } = listQuerySchema.parse(req.query);
    const options: TrainerListOptions = {
      search,
      verified,
      specialties,
      limit,
      page,
    };
    const result = await this.trainerService.listTrainers(options);

    return successResponse(res, {
      message: 'Trainers fetched successfully',
      data: result,
    });
  });

  getOverview = asyncHandler(async (req: TrainerIdRequest, res: Response) => {
    const { trainerId } = trainerIdParams.parse(req.params);
    const overview = await this.trainerService.getOverview(trainerId);

    if (!overview.profile) {
      return errorResponse(res, {
        statusCode: 404,
        message: 'Trainer not found',
      });
    }

    return successResponse(res, {
      message: 'Trainer overview fetched successfully',
      data: overview,
    });
  });

  updateProfile = asyncHandler(async (req: UpdateProfileRequest, res: Response) => {
    const { trainerId } = trainerIdParams.parse(req.params);
    const body = profileBodySchema.parse(req.body);
    const profile = await this.trainerService.upsertProfile(trainerId, body);

    return successResponse(res, {
      message: 'Trainer profile updated successfully',
      data: profile,
    });
  });

  updatePerformance = asyncHandler(async (req: UpdatePerformanceRequest, res: Response) => {
    const { trainerId } = trainerIdParams.parse(req.params);
    const body = performanceBodySchema.parse(req.body);

    const performance = await this.trainerService.updatePerformance(trainerId, body);

    return successResponse(res, {
      message: 'Trainer performance updated successfully',
      data: performance,
    });
  });

  /**
   * Confirm trainer location via GPS + map pin
   * WHY: Store exact, trainer-confirmed location after approval
   * 
   * RULES:
   * - Trainer must be authenticated (via requireAuth middleware)
   * - Trainer must be approved (checked in service)
   * - Coordinates must be valid (validated by schema)
   */
  confirmLocation = asyncHandler(async (req: ConfirmLocationRequest, res: Response) => {
    const authUser = (req as any).authUser;
    if (!authUser) {
      throw new AppError('Authentication required', 401);
    }

    const trainerId = authUser.id;
    const body = confirmLocationBodySchema.parse(req.body);

    // Confirm location
    const location = await this.trainerService.confirmLocation(
      trainerId,
      body.latitude,
      body.longitude,
      body.accuracy ?? null
    );

    return successResponse(res, {
      message: 'Location confirmed successfully',
      data: {
        id: location.id,
        trainerId: location.trainerId,
        latitude: location.latitude,
        longitude: location.longitude,
        source: location.source,
        confirmedAt: location.confirmedAt,
      },
    });
  });

  /**
   * Check if trainer has confirmed location
   * WHY: Used by frontend to determine if location confirmation screen should be shown
   */
  checkLocationStatus = asyncHandler(async (req: Request, res: Response) => {
    const authUser = (req as any).authUser;
    if (!authUser) {
      throw new AppError('Authentication required', 401);
    }

    const trainerId = authUser.id;
    const hasConfirmed = await this.trainerService.hasConfirmedLocation(trainerId);
    const baseLocation = await this.trainerService.getBaseLocation(trainerId);

    return successResponse(res, {
      message: 'Location status fetched',
      data: {
        hasConfirmedLocation: hasConfirmed,
        baseLocation: baseLocation
          ? {
              id: baseLocation.id,
              latitude: baseLocation.latitude,
              longitude: baseLocation.longitude,
              source: baseLocation.source,
              confirmedAt: baseLocation.confirmedAt,
            }
          : null,
      },
    });
  });

  /**
   * Set trainer allocation preference (accept/decline more allocations)
   * POST /api/trainers/allocations/preference
   */
  setAllocationPreference = asyncHandler(async (req: AllocationPreferenceRequest, res: Response) => {
    const authUser = (req as any).authUser;
    if (!authUser) {
      throw new AppError('Authentication required', 401);
    }

    const trainerId = authUser.id;
    const { acceptMore } = allocationPreferenceBodySchema.parse(req.body);

    const pool = getPostgresPool();
    
    // Get current allocation count and max
    const allocationCountResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count 
       FROM trainer_allocations 
       WHERE trainer_id = $1 AND status IN ('approved', 'active')`,
      [trainerId]
    );
    const currentAllocations = parseInt(allocationCountResult.rows[0]?.count || '0', 10);

    // Get trainer rating and max allocation
    const ratingResult = await pool.query<{ rating_average: number | null }>(
      `SELECT rating_average FROM trainer_profiles WHERE trainer_id = $1`,
      [trainerId]
    );
    const rating = ratingResult.rows[0]?.rating_average || 0;

    // Calculate max allocation based on rating
    let maxAllocations = 3;
    if (rating >= 4.6) maxAllocations = 8;
    else if (rating >= 4.1) maxAllocations = 7;
    else if (rating >= 3.6) maxAllocations = 6;
    else if (rating >= 3.1) maxAllocations = 5;
    else if (rating >= 2.1) maxAllocations = 4;

    // Store preference in trainer_profiles metadata (or create a separate table if needed)
    await pool.query(
      `UPDATE trainer_profiles 
       SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('allocation_preference', jsonb_build_object(
         'acceptMoreAllocations', $1,
         'preferenceUpdatedAt', NOW()
       ))
       WHERE trainer_id = $2`,
      [acceptMore, trainerId]
    );

    return successResponse(res, {
      message: acceptMore 
        ? `Preference saved. You'll receive allocations up to ${maxAllocations} based on your rating.`
        : `Preference saved. You'll stay at ${currentAllocations} allocations.`,
      data: {
        acceptMoreAllocations: acceptMore,
        currentAllocations,
        maxAllocations,
        rating,
      },
    });
  });

  /**
   * Get trainer allocation preference
   * GET /api/trainers/allocations/preference
   */
  getAllocationPreference = asyncHandler(async (req: Request, res: Response) => {
    const authUser = (req as any).authUser;
    if (!authUser) {
      throw new AppError('Authentication required', 401);
    }

    const trainerId = authUser.id;
    const pool = getPostgresPool();

    // Get current allocation count
    const allocationCountResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count 
       FROM trainer_allocations 
       WHERE trainer_id = $1 AND status IN ('approved', 'active')`,
      [trainerId]
    );
    const currentAllocations = parseInt(allocationCountResult.rows[0]?.count || '0', 10);

    // Get trainer rating and preference
    const profileResult = await pool.query<{ 
      rating_average: number | null;
      metadata: any;
    }>(
      `SELECT rating_average, metadata FROM trainer_profiles WHERE trainer_id = $1`,
      [trainerId]
    );

    const rating = profileResult.rows[0]?.rating_average || 0;
    const metadata = profileResult.rows[0]?.metadata || {};
    const preference = metadata.allocation_preference || {};

    // Calculate max allocation based on rating
    let maxAllocations = 3;
    if (rating >= 4.6) maxAllocations = 8;
    else if (rating >= 4.1) maxAllocations = 7;
    else if (rating >= 3.6) maxAllocations = 6;
    else if (rating >= 3.1) maxAllocations = 5;
    else if (rating >= 2.1) maxAllocations = 4;

    return successResponse(res, {
      message: 'Allocation preference fetched successfully',
      data: {
        acceptMoreAllocations: preference.acceptMoreAllocations ?? true, // Default to true
        currentAllocations,
        maxAllocations,
        rating,
        preferenceUpdatedAt: preference.preferenceUpdatedAt || null,
      },
    });
  });
}

