import { Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import type { VerificationService } from '../services/verification.service';
import type { ZodRequest } from '@kodingcaravan/shared/types/zodRequest';

const documentParamsSchema = z.object({
  documentId: z.string().uuid(),
});

const trainerParamsSchema = z.object({
  trainerId: z.string().uuid(),
});

const documentCreateSchema = z.object({
  trainerId: z.string().uuid(),
  documentType: z.string().min(2).max(100),
  fileUrl: z.string().url(),
  metadata: z.record(z.any()).nullable().optional(),
});

const documentUpdateSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'resubmitted']).optional(),
  reviewerId: z.string().uuid().nullable().optional(),
  rejectionReason: z.string().nullable().optional(),
  metadata: z.record(z.any()).nullable().optional(),
});

const listPendingQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});

type DocumentParamsRequest = ZodRequest<{ params: typeof documentParamsSchema }>;
type TrainerParamsRequest = ZodRequest<{ params: typeof trainerParamsSchema }>;
type CreateDocumentRequest = ZodRequest<{ body: typeof documentCreateSchema }>;
type UpdateDocumentRequest = ZodRequest<{ params: typeof documentParamsSchema; body: typeof documentUpdateSchema }>;
type ListPendingRequest = ZodRequest<{ query: typeof listPendingQuerySchema }>;

export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  submitDocument = asyncHandler(async (req: CreateDocumentRequest, res: Response) => {
    const body = documentCreateSchema.parse(req.body);
    const document = await this.verificationService.submitDocument({
      trainerId: body.trainerId,
      documentType: body.documentType,
      fileUrl: body.fileUrl,
      metadata: body.metadata ?? null,
    });

    return successResponse(res, {
      statusCode: 201,
      message: 'Document submitted successfully',
      data: document,
    });
  });

  updateDocument = asyncHandler(async (req: UpdateDocumentRequest, res: Response) => {
    const { documentId } = documentParamsSchema.parse(req.params);
    const body = documentUpdateSchema.parse(req.body);

    const updated = await this.verificationService.updateDocument(documentId, body);
    if (!updated) {
      return errorResponse(res, { statusCode: 404, message: 'Document not found' });
    }

    return successResponse(res, {
      message: 'Document updated successfully',
      data: updated,
    });
  });

  getDocument = asyncHandler(async (req: DocumentParamsRequest, res: Response) => {
    const { documentId } = documentParamsSchema.parse(req.params);
    const document = await this.verificationService.getDocument(documentId);

    if (!document) {
      return errorResponse(res, { statusCode: 404, message: 'Document not found' });
    }

    return successResponse(res, {
      message: 'Document fetched successfully',
      data: document,
    });
  });

  listTrainerDocuments = asyncHandler(async (req: TrainerParamsRequest, res: Response) => {
    const { trainerId } = trainerParamsSchema.parse(req.params);
    const documents = await this.verificationService.listTrainerDocuments(trainerId);

    return successResponse(res, {
      message: 'Trainer documents fetched successfully',
      data: documents,
    });
  });

  listPending = asyncHandler(async (req: ListPendingRequest, res: Response) => {
    const { limit } = listPendingQuerySchema.parse(req.query);
    const documents = await this.verificationService.listPending(limit);

    return successResponse(res, {
      message: 'Pending documents fetched successfully',
      data: documents,
    });
  });
}

