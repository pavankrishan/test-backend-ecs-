import { Response, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import type { ZodRequest } from '@kodingcaravan/shared/types/zodRequest';
import { AnalyticsService } from '../services/analytics.service';
import { successResponse, errorResponse } from '../utils/response';
import { Analytics } from '../models/analytics.model';

const objectId = () => z.string().length(24);

const recordEventSchema = z.object({
  eventType: z.string().min(1).max(128),
  userId: objectId(),
  courseId: objectId().optional(),
  metadata: z.record(z.any()).optional(),
  timestamp: z.coerce.date().optional(),
});

const bulkRecordSchema = z.array(recordEventSchema);

const listEventsQuerySchema = z.object({
  eventTypes: z
    .string()
    .optional()
    .transform((value: string | undefined) => (value ? value.split(',').map((item: string) => item.trim()).filter(Boolean) : undefined)),
  userId: objectId().optional(),
  courseId: objectId().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

const eventTypeMetricsQuerySchema = z.object({
  eventTypes: z
    .string()
    .optional()
    .transform((value: string | undefined) => (value ? value.split(',').map((item: string) => item.trim()).filter(Boolean) : undefined)),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

const topCoursesQuerySchema = z.object({
  eventType: z.string().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

const trendsQuerySchema = z.object({
  eventType: z.string().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  interval: z.enum(['hour', 'day', 'week']).optional(),
});

const userTimelineQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().optional(),
});

const eventIdParamsSchema = z.object({
  eventId: objectId(),
});

const userIdParamsSchema = z.object({
  userId: objectId(),
});

type RecordEventRequest = ZodRequest<{ body: typeof recordEventSchema }>;
type BulkRecordRequest = Request<any, any, z.infer<typeof bulkRecordSchema>, any>;
type ListEventsRequest = ZodRequest<{ query: typeof listEventsQuerySchema }>;
type EventTypeMetricsRequest = ZodRequest<{ query: typeof eventTypeMetricsQuerySchema }>;
type TopCoursesRequest = ZodRequest<{ query: typeof topCoursesQuerySchema }>;
type TrendsRequest = ZodRequest<{ query: typeof trendsQuerySchema }>;
type EventIdRequest = ZodRequest<{ params: typeof eventIdParamsSchema }>;
type UserTimelineRequest = ZodRequest<{ params: typeof userIdParamsSchema; query: typeof userTimelineQuerySchema }>;

export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  recordEvent = asyncHandler(async (req: RecordEventRequest, res: Response) => {
    const body = recordEventSchema.parse(req.body);

    try {
      const event = await this.analyticsService.recordEvent(body);
      return successResponse(res, {
        statusCode: 201,
        message: 'Event recorded successfully',
        data: event,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 400,
        message: error.message ?? 'Failed to record event',
      });
    }
  });

  bulkRecordEvents = asyncHandler(async (req: BulkRecordRequest, res: Response) => {
    const events = bulkRecordSchema.parse(req.body);
    const count = await this.analyticsService.bulkRecordEvents(events);
    return successResponse(res, {
      statusCode: 201,
      message: 'Events recorded successfully',
      data: { inserted: count },
    });
  });

  listEvents = asyncHandler(async (req: ListEventsRequest, res: Response) => {
    const query = listEventsQuerySchema.parse(req.query);
    const result = await this.analyticsService.listEvents(query);
    return successResponse(res, {
      message: 'Events retrieved successfully',
      data: {
        items: result.items,
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          pages: Math.ceil(result.total / Math.max(result.limit, 1)),
        },
      },
    });
  });

  getEventById = asyncHandler(async (req: EventIdRequest, res: Response) => {
    const { eventId } = eventIdParamsSchema.parse(req.params);
    const event = await Analytics.findById(eventId).exec();
    if (!event) {
      return errorResponse(res, { statusCode: 404, message: 'Event not found' });
    }

    return successResponse(res, {
      message: 'Event retrieved successfully',
      data: event,
    });
  });

  getEventTypeMetrics = asyncHandler(async (req: EventTypeMetricsRequest, res: Response) => {
    const query = eventTypeMetricsQuerySchema.parse(req.query);
    const metrics = await this.analyticsService.getEventTypeMetrics(query);
    return successResponse(res, {
      message: 'Event type metrics retrieved successfully',
      data: metrics,
    });
  });

  getTopCourses = asyncHandler(async (req: TopCoursesRequest, res: Response) => {
    const query = topCoursesQuerySchema.parse(req.query);
    const courses = await this.analyticsService.getTopCourses(query);
    return successResponse(res, {
      message: 'Top courses retrieved successfully',
      data: courses,
    });
  });

  getEventTrends = asyncHandler(async (req: TrendsRequest, res: Response) => {
    const query = trendsQuerySchema.parse(req.query);
    const trends = await this.analyticsService.getEventTrends(query);
    return successResponse(res, {
      message: 'Event trends retrieved successfully',
      data: trends,
    });
  });

  getUserTimeline = asyncHandler(async (req: UserTimelineRequest, res: Response) => {
    const { userId } = userIdParamsSchema.parse(req.params);
    const options = userTimelineQuerySchema.parse(req.query);
    const timeline = await this.analyticsService.getUserTimeline(userId, options);
    return successResponse(res, {
      message: 'User timeline retrieved successfully',
      data: timeline,
    });
  });
}

