import { Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import type { FleetService, FleetSearchOptions } from '../services/fleet.service';
import type { ZodRequest } from '@kodingcaravan/shared/types/zodRequest';

const trainerParamsSchema = z.object({
  trainerId: z.string().uuid(),
});

const locationBodySchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  serviceRadiusKm: z.number().min(0).max(500).nullable().optional(),
  available: z.boolean().optional(),
});

const listQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(1).max(500).optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

type TrainerParamsRequest = ZodRequest<{ params: typeof trainerParamsSchema }>;
type UpdateLocationRequest = ZodRequest<{ params: typeof trainerParamsSchema; body: typeof locationBodySchema }>;
type ListFleetRequest = ZodRequest<{ query: typeof listQuerySchema }>;

export class FleetController {
  constructor(private readonly fleetService: FleetService) {}

  updateLocation = asyncHandler(async (req: UpdateLocationRequest, res: Response) => {
    const { trainerId } = trainerParamsSchema.parse(req.params);
    const body = locationBodySchema.parse(req.body);

    const location = await this.fleetService.upsertLocation({
      trainerId,
      ...body,
    });

    return successResponse(res, {
      message: 'Trainer location updated successfully',
      data: location,
    });
  });

  getLocation = asyncHandler(async (req: TrainerParamsRequest, res: Response) => {
    const { trainerId } = trainerParamsSchema.parse(req.params);
    const location = await this.fleetService.getLocation(trainerId);

    if (!location) {
      return errorResponse(res, {
        statusCode: 404,
        message: 'Trainer location not found',
      });
    }

    return successResponse(res, {
      message: 'Trainer location fetched successfully',
      data: location,
    });
  });

  listAvailable = asyncHandler(async (req: ListFleetRequest, res: Response) => {
    const query = listQuerySchema.parse(req.query);
    const options: FleetSearchOptions = {
      latitude: query.latitude,
      longitude: query.longitude,
      radiusKm: query.radiusKm,
      city: query.city,
      state: query.state,
      country: query.country,
      page: query.page,
      limit: query.limit,
    };

    const result = await this.fleetService.listAvailable(options);

    return successResponse(res, {
      message: 'Available trainers fetched successfully',
      data: result,
    });
  });
}

