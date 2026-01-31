import { Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import type { ZodRequest } from '@kodingcaravan/shared/types/zodRequest';
import logger from '@kodingcaravan/shared/config/logger';
import { DoubtService } from '../services/doubt.service';
import { successResponse, errorResponse } from '../utils/response';

const createDoubtSchema = z.object({
  studentId: z.string().uuid(), // UUID from PostgreSQL
  trainerId: z.string().uuid().optional().nullable(), // UUID from PostgreSQL
  subject: z.string().min(1).max(200),
  topic: z.string().min(1).max(200),
  question: z.string().min(1).max(5000),
  type: z.enum(['text', 'image', 'voice']).default('text'),
  attachments: z
    .array(
      z.object({
        url: z.string().url(),
        type: z.enum(['image', 'audio', 'pdf']),
        size: z.number().int().positive().optional(),
        mimeType: z.string().optional(),
        metadata: z.record(z.any()).nullable().optional(),
      }),
    )
    .optional(),
});

const createReplySchema = z.object({
  trainerId: z.string().uuid(), // UUID from PostgreSQL
  reply: z.string().min(1).max(5000),
  attachments: z
    .array(
      z.object({
        url: z.string().url(),
        type: z.enum(['image', 'audio', 'pdf']),
        size: z.number().int().positive().optional(),
        mimeType: z.string().optional(),
        metadata: z.record(z.any()).nullable().optional(),
      }),
    )
    .optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'answered', 'closed']),
  updatedBy: z.string().uuid(), // UUID from PostgreSQL
});

const reassignDoubtSchema = z.object({
  newTrainerId: z.string().uuid(), // UUID from PostgreSQL
});

const doubtIdParamsSchema = z.object({
  doubtId: z.string().length(24), // MongoDB ObjectId (24 hex chars)
});

const doubtListQuerySchema = z.object({
  studentId: z.string().uuid().optional(), // UUID from PostgreSQL
  trainerId: z
    .union([
      z.string().uuid(),
      z.literal(''),
      z.undefined(),
    ])
    .optional()
    .transform((val: string | undefined) => (val === '' ? undefined : val)), // Convert empty string to undefined
  status: z.enum(['pending', 'in_progress', 'answered', 'closed']).optional(),
  subject: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().optional(),
});



type CreateDoubtRequest = ZodRequest<{ body: typeof createDoubtSchema }>;
type CreateReplyRequest = ZodRequest<{ params: typeof doubtIdParamsSchema; body: typeof createReplySchema }>;
type UpdateStatusRequest = ZodRequest<{ params: typeof doubtIdParamsSchema; body: typeof updateStatusSchema }>;
type ReassignDoubtRequest = ZodRequest<{ params: typeof doubtIdParamsSchema; body: typeof reassignDoubtSchema }>;
type GetDoubtRequest = ZodRequest<{ params: typeof doubtIdParamsSchema }>;
type ListDoubtsRequest = ZodRequest<{ query: typeof doubtListQuerySchema }>;

export class DoubtController {
  constructor(private readonly doubtService: DoubtService) {}

  /**
   * POST /doubts
   * Student submits a doubt
   */
  createDoubt = asyncHandler(async (req: CreateDoubtRequest, res: Response) => {
    const body = createDoubtSchema.parse(req.body);

    try {
      const doubt = await this.doubtService.createDoubt(body);
      return successResponse(res, {
        statusCode: 201,
        message: 'Doubt submitted successfully',
        data: this.doubtService.formatDoubt(doubt),
      });
    } catch (error: any) {
      // Log error details for debugging
      logger.error('createDoubt error', {
        errorName: error?.name,
        errorMessage: error?.message,
        stack: error?.stack?.substring(0, 300),
        studentId: body.studentId,
        trainerId: body.trainerId,
        subject: body.subject,
        topic: body.topic,
        correlationId: (req as any).correlationId,
        service: 'chat-service',
      });
      
      // Check if it's a MongoDB connection/timeout error (server error, not client error)
      const isMongoTimeout = 
        error?.message?.includes('buffering timed out') ||
        error?.message?.includes('MongoNetworkError') ||
        error?.message?.includes('MongoServerSelectionError') ||
        error?.message?.includes('connection timeout') ||
        error?.message?.includes('Database connection') ||
        error?.name === 'MongoServerSelectionError' ||
        error?.name === 'MongoNetworkTimeoutError' ||
        error?.name === 'MongoTimeoutError';
      
      // Return 500 for server/database errors, 400 for client errors
      const statusCode = isMongoTimeout ? 500 : 400;
      
      return errorResponse(res, {
        statusCode,
        message: error.message ?? 'Failed to submit doubt',
      });
    }
  });

  /**
   * GET /doubts/:doubtId
   * Get a specific doubt with replies
   */
  getDoubt = asyncHandler(async (req: GetDoubtRequest, res: Response) => {
    const { doubtId } = doubtIdParamsSchema.parse(req.params);

    // Debug logging for incoming request
    logger.debug('getDoubt request', {
      doubtId,
      correlationId: (req as any).correlationId,
      service: 'chat-service',
    });

    try {
      const { doubt, replies } = await this.doubtService.getDoubtWithReplies(doubtId);
      
      logger.debug('getDoubt service result', {
        hasDoubt: !!doubt,
        doubtId: doubt?._id || doubt?.id || 'none',
        repliesCount: replies.length,
        correlationId: (req as any).correlationId,
        service: 'chat-service',
      });
      
      if (!doubt) {
        logger.warn('getDoubt: Doubt not found', {
          doubtId,
          correlationId: (req as any).correlationId,
          service: 'chat-service',
        });
        return errorResponse(res, {
          statusCode: 404,
          message: 'Doubt not found',
        });
      }

      const formattedDoubt = this.doubtService.formatDoubt(doubt);
      logger.debug('getDoubt formatted doubt', {
        id: formattedDoubt.id,
        _id: formattedDoubt._id,
        studentId: formattedDoubt.studentId,
        subject: formattedDoubt.subject,
        correlationId: (req as any).correlationId,
        service: 'chat-service',
      });

      return successResponse(res, {
        message: 'Doubt fetched successfully',
        data: {
          doubt: formattedDoubt,
          replies: replies.map((reply) => this.doubtService.formatReply(reply)),
        },
      });
    } catch (error: any) {
      logger.error('getDoubt error', {
        doubtId,
        error: error?.message,
        name: error?.name,
        stack: error?.stack?.substring(0, 200),
        correlationId: (req as any).correlationId,
        service: 'chat-service',
      });
      
      // Check if it's a MongoDB timeout/connection error
      const isMongoTimeout = 
        error?.message?.includes('buffering timed out') ||
        error?.message?.includes('Operation timeout') ||
        error?.message?.includes('Operation `doubt_replies.find()') ||
        error?.name === 'MongoServerSelectionError' ||
        error?.name === 'MongoNetworkTimeoutError' ||
        error?.message?.includes('Database connection');
      
      return errorResponse(res, {
        statusCode: isMongoTimeout ? 500 : 400,
        message: error.message ?? 'Failed to fetch doubt',
      });
    }
  });

  /**
   * GET /doubts
   * List doubts with filters
   */
  listDoubts = asyncHandler(async (req: ListDoubtsRequest, res: Response) => {
    const filters = doubtListQuerySchema.parse(req.query);

    // Debug logging for incoming request
    logger.debug('listDoubts request', {
      query: req.query,
      parsedFilters: filters,
      correlationId: (req as any).correlationId,
      service: 'chat-service',
    });

    try {
      const result = await this.doubtService.listDoubts(filters);
      
      // Service always returns a result (never throws) - check if it's empty
      // Debug logging for service result
      logger.debug('listDoubts service result', {
        itemsCount: result.items.length,
        total: result.total,
        page: result.page,
        limit: result.limit,
        correlationId: (req as any).correlationId,
        service: 'chat-service',
      });

      const formattedItems = result.items.map((doubt) => this.doubtService.formatDoubt(doubt));
      
      // Debug logging for formatted items
      logger.debug('listDoubts formatted items', {
        formattedCount: formattedItems.length,
        correlationId: (req as any).correlationId,
        service: 'chat-service',
      });

      // CRITICAL: Always return success response, even if results are empty
      // Service returns empty results on errors instead of throwing
      return successResponse(res, {
        message: formattedItems.length > 0 ? 'Doubts fetched successfully' : 'No doubts found',
        data: {
          items: formattedItems,
          pagination: {
            total: result.total,
            page: result.page,
            limit: result.limit,
            pages: Math.ceil(result.total / Math.max(result.limit, 1)),
          },
        },
      });
    } catch (error: any) {
      // CRITICAL FIX: Service should NEVER throw (returns empty results instead)
      // But if it does throw (unexpected error), return empty results instead of 500 error
      // This ensures frontend gets a response (even if empty) instead of infinite loading
      logger.error('Unexpected error (service should return empty results)', {
        error: error?.message,
        name: error?.name,
        stack: error?.stack,
        correlationId: (req as any).correlationId,
        service: 'chat-service',
      });
      
      // Return empty results instead of error response - prevents frontend from hanging
      return successResponse(res, {
        message: 'No doubts found',
        data: {
          items: [],
          pagination: {
            total: 0,
            page: 1,
            limit: filters.limit || 20,
            pages: 0,
          },
        },
      });
    }
  });

  /**
   * POST /doubts/:doubtId/reply
   * Trainer replies to a doubt
   */
  createReply = asyncHandler(async (req: CreateReplyRequest, res: Response) => {
    const { doubtId } = doubtIdParamsSchema.parse(req.params);
    const body = createReplySchema.parse(req.body);

    try {
      const { reply, doubt } = await this.doubtService.createDoubtReply({
        doubtId,
        ...body,
      });

      return successResponse(res, {
        statusCode: 201,
        message: 'Reply submitted successfully',
        data: {
          reply: this.doubtService.formatReply(reply),
          doubt: this.doubtService.formatDoubt(doubt),
        },
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 400,
        message: error.message ?? 'Failed to submit reply',
      });
    }
  });

  /**
   * PATCH /doubts/:doubtId/status
   * Update doubt status
   */
  updateStatus = asyncHandler(async (req: UpdateStatusRequest, res: Response) => {
    const { doubtId } = doubtIdParamsSchema.parse(req.params);
    const body = updateStatusSchema.parse(req.body);

    try {
      const doubt = await this.doubtService.updateDoubtStatus(doubtId, body.status, body.updatedBy);
      return successResponse(res, {
        message: 'Doubt status updated successfully',
        data: this.doubtService.formatDoubt(doubt),
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 400,
        message: error.message ?? 'Failed to update doubt status',
      });
    }
  });

  /**
   * POST /doubts/:doubtId/reassign
   * Admin reassigns doubt to another trainer
   */
  reassignDoubt = asyncHandler(async (req: ReassignDoubtRequest, res: Response) => {
    const { doubtId } = doubtIdParamsSchema.parse(req.params);
    const body = reassignDoubtSchema.parse(req.body);

    try {
      const doubt = await this.doubtService.reassignDoubt(doubtId, body.newTrainerId);
      return successResponse(res, {
        message: 'Doubt reassigned successfully',
        data: this.doubtService.formatDoubt(doubt),
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 400,
        message: error.message ?? 'Failed to reassign doubt',
      });
    }
  });

  /**
   * GET /trainer/doubts
   * Get doubts assigned to a trainer
   */
  getTrainerDoubts = asyncHandler(async (req: ListDoubtsRequest, res: Response) => {
    // Preprocess query to handle empty strings
    const query = { ...req.query };
    if (query.trainerId === '' || query.trainerId === null || query.trainerId === undefined) {
      delete query.trainerId;
    }

    const filters = doubtListQuerySchema.parse(query);

    if (!filters.trainerId) {
      return errorResponse(res, {
        statusCode: 400,
        message: 'trainerId is required',
      });
    }

    try {
      const result = await this.doubtService.listDoubts(filters);
      return successResponse(res, {
        message: 'Trainer doubts fetched successfully',
        data: {
          items: result.items.map((doubt) => this.doubtService.formatDoubt(doubt)),
          pagination: {
            total: result.total,
            page: result.page,
            limit: result.limit,
            pages: Math.ceil(result.total / Math.max(result.limit, 1)),
          },
        },
      });
    } catch (error: any) {
      // Check if it's a MongoDB timeout/connection error
      const isMongoTimeout = 
        error?.message?.includes('buffering timed out') ||
        error?.message?.includes('Operation timeout') ||
        error?.name === 'MongoServerSelectionError' ||
        error?.name === 'MongoNetworkTimeoutError' ||
        error?.message?.includes('Database connection');
      
      return errorResponse(res, {
        statusCode: isMongoTimeout ? 500 : 400,
        message: error.message ?? 'Failed to fetch trainer doubts',
      });
    }
  });

  /**
   * GET /admin/doubts
   * Admin dashboard - view all doubts
   */
  getAdminDoubts = asyncHandler(async (req: ListDoubtsRequest, res: Response) => {
    const filters = doubtListQuerySchema.parse(req.query);

    try {
      const result = await this.doubtService.listDoubts(filters);
      return successResponse(res, {
        message: 'Admin doubts fetched successfully',
        data: {
          items: result.items.map((doubt) => this.doubtService.formatDoubt(doubt)),
          pagination: {
            total: result.total,
            page: result.page,
            limit: result.limit,
            pages: Math.ceil(result.total / Math.max(result.limit, 1)),
          },
        },
      });
    } catch (error: any) {
      // Check if it's a MongoDB timeout/connection error
      const isMongoTimeout = 
        error?.message?.includes('buffering timed out') ||
        error?.message?.includes('Operation timeout') ||
        error?.name === 'MongoServerSelectionError' ||
        error?.name === 'MongoNetworkTimeoutError' ||
        error?.message?.includes('Database connection');
      
      return errorResponse(res, {
        statusCode: isMongoTimeout ? 500 : 400,
        message: error.message ?? 'Failed to fetch admin doubts',
      });
    }
  });
}

