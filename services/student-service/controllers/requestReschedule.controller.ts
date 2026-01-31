import { Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import type { RescheduleService } from '../services/reschedule.service';
import type { ZodRequest } from '@kodingcaravan/shared/types/zodRequest';

const createRescheduleSchema = z.object({
  studentId: z.string().uuid(),
  bookingId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  reason: z.string().min(5),
  currentSchedule: z
    .object({
      start: z.string().datetime().nullable().optional(),
      end: z.string().datetime().nullable().optional(),
      timezone: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  preferredSlots: z.array(z.string().datetime()).nullable().optional(),
  meetingType: z.string().max(50).nullable().optional(),
  studentNotes: z.string().nullable().optional(),
  requestedFor: z.string().datetime().nullable().optional(),
});

const updateRescheduleSchema = createRescheduleSchema
  .omit({ studentId: true })
  .extend({
    reason: z.string().min(5).optional(),
  });

const updateStatusSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'rescheduled', 'cancelled']),
  adminNotes: z.string().nullable().optional(),
  resolvedAt: z.string().datetime().nullable().optional(),
});

const listQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'rescheduled', 'cancelled']).optional(),
  studentId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

const rescheduleIdParams = z.object({
  id: z.string().uuid(),
});

type CreateRescheduleRequest = ZodRequest<{ body: typeof createRescheduleSchema }>;
type UpdateRescheduleRequest = ZodRequest<{ params: typeof rescheduleIdParams; body: typeof updateRescheduleSchema }>;
type UpdateStatusRequest = ZodRequest<{ params: typeof rescheduleIdParams; body: typeof updateStatusSchema }>;
type ListRescheduleRequest = ZodRequest<{ query: typeof listQuerySchema }>;
type GetRescheduleRequest = ZodRequest<{ params: typeof rescheduleIdParams }>;

export class RequestRescheduleController {
  constructor(private readonly rescheduleService: RescheduleService) {}

  createRequest = asyncHandler(async (req: CreateRescheduleRequest, res: Response) => {
    const body = createRescheduleSchema.parse(req.body);
    const request = await this.rescheduleService.createRequest({
      studentId: body.studentId,
      bookingId: body.bookingId,
      courseId: body.courseId,
      reason: body.reason,
      currentSchedule: body.currentSchedule ? {
        start: body.currentSchedule.start ?? null,
        end: body.currentSchedule.end ?? null,
        timezone: body.currentSchedule.timezone ?? null,
      } : null,
      preferredSlots: body.preferredSlots ?? null,
      meetingType: body.meetingType ?? null,
      studentNotes: body.studentNotes ?? null,
      requestedFor: body.requestedFor ? new Date(body.requestedFor) : null,
    });

    return successResponse(res, {
      statusCode: 201,
      message: 'Reschedule request created successfully',
      data: request,
    });
  });

  updateRequest = asyncHandler(async (req: UpdateRescheduleRequest, res: Response) => {
    const { id } = rescheduleIdParams.parse(req.params);
    const body = updateRescheduleSchema.parse(req.body);
    const updated = await this.rescheduleService.updateRequest(id, {
      reason: body.reason,
      bookingId: body.bookingId,
      courseId: body.courseId,
      currentSchedule: body.currentSchedule ? {
        start: body.currentSchedule.start ?? null,
        end: body.currentSchedule.end ?? null,
        timezone: body.currentSchedule.timezone ?? null,
      } : null,
      preferredSlots: body.preferredSlots ?? null,
      meetingType: body.meetingType ?? null,
      studentNotes: body.studentNotes ?? null,
      requestedFor: body.requestedFor ? new Date(body.requestedFor) : undefined,
    });

    if (!updated) {
      return errorResponse(res, {
        statusCode: 404,
        message: 'Reschedule request not found',
      });
    }

    return successResponse(res, {
      message: 'Reschedule request updated successfully',
      data: updated,
    });
  });

  updateStatus = asyncHandler(async (req: UpdateStatusRequest, res: Response) => {
    const { id } = rescheduleIdParams.parse(req.params);
    const body = updateStatusSchema.parse(req.body);

    const updated = await this.rescheduleService.updateStatus(id, {
      status: body.status,
      adminNotes: body.adminNotes ?? null,
      resolvedAt: body.resolvedAt ? new Date(body.resolvedAt) : undefined,
    });

    if (!updated) {
      return errorResponse(res, {
        statusCode: 404,
        message: 'Reschedule request not found',
      });
    }

    return successResponse(res, {
      message: 'Reschedule status updated successfully',
      data: updated,
    });
  });

  listRequests = asyncHandler(async (req: ListRescheduleRequest, res: Response) => {
    const { status, studentId, courseId, limit, page } = listQuerySchema.parse(req.query);
    const result = await this.rescheduleService.listRequests({
      status,
      studentId,
      courseId,
      limit,
      page,
    });

    return successResponse(res, {
      message: 'Reschedule requests fetched successfully',
      data: result,
    });
  });

  getRequest = asyncHandler(async (req: GetRescheduleRequest, res: Response) => {
    const { id } = rescheduleIdParams.parse(req.params);
    const request = await this.rescheduleService.getRequest(id);

    if (!request) {
      return errorResponse(res, {
        statusCode: 404,
        message: 'Reschedule request not found',
      });
    }

    return successResponse(res, {
      message: 'Reschedule request fetched successfully',
      data: request,
    });
  });
}

