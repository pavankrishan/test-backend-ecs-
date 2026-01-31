import { Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import type { BankDetailsService } from '../services/bankDetails.service';
import type { ZodRequest } from '@kodingcaravan/shared/types/zodRequest';
import { requireAuth } from '../middlewares/authMiddleware';

const bankDetailsBodySchema = z.object({
  accountHolderName: z.string().min(2).max(255),
  accountNumber: z.string().min(9).max(50),
  ifscCode: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code format'),
  bankName: z.string().min(2).max(255),
  branchName: z.string().max(255).nullable().optional(),
  accountType: z.enum(['savings', 'current']).optional().default('savings'),
});

type BankDetailsRequest = ZodRequest<{ body: typeof bankDetailsBodySchema }>;

export class BankDetailsController {
  constructor(private readonly bankDetailsService: BankDetailsService) {}

  getBankDetails = asyncHandler(async (req: any, res: Response) => {
    const trainerId = (req as any).user?.trainerId || (req as any).user?.id;
    
    if (!trainerId) {
      return errorResponse(res, {
        statusCode: 401,
        message: 'Unauthorized',
      });
    }

    const bankDetails = await this.bankDetailsService.getBankDetails(trainerId);

    if (!bankDetails) {
      return successResponse(res, {
        message: 'Bank details not found',
        data: null,
      });
    }

    return successResponse(res, {
      message: 'Bank details fetched successfully',
      data: bankDetails,
    });
  });

  createOrUpdateBankDetails = asyncHandler(async (req: BankDetailsRequest, res: Response) => {
    const trainerId = (req as any).user?.trainerId || (req as any).user?.id;
    
    if (!trainerId) {
      return errorResponse(res, {
        statusCode: 401,
        message: 'Unauthorized',
      });
    }

    const body = bankDetailsBodySchema.parse(req.body);
    const bankDetails = await this.bankDetailsService.createOrUpdateBankDetails(trainerId, body);

    return successResponse(res, {
      message: 'Bank details saved successfully',
      data: bankDetails,
    });
  });

  hasBankDetails = asyncHandler(async (req: any, res: Response) => {
    const trainerId = (req as any).user?.trainerId || (req as any).user?.id;
    
    if (!trainerId) {
      return errorResponse(res, {
        statusCode: 401,
        message: 'Unauthorized',
      });
    }

    const hasDetails = await this.bankDetailsService.hasBankDetails(trainerId);

    return successResponse(res, {
      message: 'Bank details status fetched successfully',
      data: { hasBankDetails: hasDetails },
    });
  });
}

