import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '@kodingcaravan/shared';
import type { BankDetailsController } from '../controllers/bankDetails.controller';
import { requireAuth } from '../middlewares/authMiddleware';

const bankDetailsBodySchema = z.object({
  accountHolderName: z.string().min(2).max(255),
  accountNumber: z.string().min(9).max(50),
  ifscCode: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code format'),
  bankName: z.string().min(2).max(255),
  branchName: z.string().max(255).nullable().optional(),
  accountType: z.enum(['savings', 'current']).optional().default('savings'),
});

export function createBankDetailsRoutes(controller: BankDetailsController): Router {
  const router = Router();

  router.get('/', requireAuth, controller.getBankDetails);
  router.post(
    '/',
    requireAuth,
    validateRequest({
      body: bankDetailsBodySchema,
    }),
    controller.createOrUpdateBankDetails
  );
  router.get('/status', requireAuth, controller.hasBankDetails);

  return router;
}

