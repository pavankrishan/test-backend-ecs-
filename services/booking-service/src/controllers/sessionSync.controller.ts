/**
 * Session Sync Controller
 * Provides endpoints to sync purchase_sessions to tutoring_sessions table
 */

import { Request, Response } from 'express';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import { SessionSyncService } from '../services/sessionSync.service';
import { getPool } from '../config/database';
import { CoursePurchaseRepository } from '../models/coursePurchase.model';
import { PurchaseSessionRepository } from '../models/purchaseSession.model';

const pool = getPool();
const sessionSyncService = new SessionSyncService(pool);
const purchaseRepo = new CoursePurchaseRepository(pool);
const purchaseSessionRepo = new PurchaseSessionRepository(pool);

export class SessionSyncController {
	/**
	 * Sync all purchase sessions for a specific purchase
	 * POST /api/v1/booking/sync-sessions/:purchaseId
	 */
	syncPurchaseSessions = asyncHandler(async (req: Request, res: Response) => {
		const { purchaseId } = req.params;

		if (!purchaseId) {
			return errorResponse(res, {
				statusCode: 400,
				message: 'Purchase ID is required',
			});
		}

		// Get purchase
		const purchase = await purchaseRepo.findById(purchaseId);
		if (!purchase) {
			return errorResponse(res, {
				statusCode: 404,
				message: 'Purchase not found',
			});
		}

		if (!purchase.trainerId) {
			return errorResponse(res, {
				statusCode: 400,
				message: 'Purchase does not have an assigned trainer',
			});
		}

		// Get all purchase sessions
		const purchaseSessions = await purchaseSessionRepo.findByPurchaseId(purchaseId);

		if (purchaseSessions.length === 0) {
			return errorResponse(res, {
				statusCode: 404,
				message: 'No purchase sessions found for this purchase',
			});
		}

		// Sync sessions
		const result = await sessionSyncService.syncPurchaseSessionsToTutoringSessions(
			purchase,
			purchaseSessions,
			purchase.trainerId
		);

		if (!result.success) {
			return errorResponse(res, {
				statusCode: 500,
				message: 'Session sync completed with errors',
				errors: result,
			});
		}

		return successResponse(res, {
			message: 'Sessions synced successfully',
			data: result,
		});
	});

	/**
	 * Sync all un-synced purchase sessions (background job endpoint)
	 * POST /api/v1/booking/sync-sessions/all
	 */
	syncAllPurchaseSessions = asyncHandler(async (req: Request, res: Response) => {
		// Get all purchases with assigned trainers that have ANY unsynced sessions
		// This finds purchases where at least one session hasn't been synced
		const result = await pool.query(
			`
				SELECT DISTINCT cp.id as purchase_id
				FROM course_purchases cp
				JOIN purchase_sessions ps ON ps.purchase_id = cp.id
				WHERE cp.trainer_id IS NOT NULL
					AND cp.status = 'ASSIGNED'
					AND NOT EXISTS (
						SELECT 1 FROM tutoring_sessions ts 
						WHERE ts.id = ps.id
					)
				ORDER BY cp.created_at DESC
				LIMIT 200
			`
		);

		const purchaseIds = result.rows.map((r: any) => r.purchase_id);
		
		if (purchaseIds.length === 0) {
			return successResponse(res, {
				message: 'No unsynced sessions found',
				data: {
					synced: 0,
					errors: [],
				},
			});
		}

		const syncResults = [];
		let totalSynced = 0;
		const errors: Array<{ purchaseId: string; error: string }> = [];

		for (const purchaseId of purchaseIds) {
			try {
				const purchase = await purchaseRepo.findById(purchaseId);
				if (!purchase || !purchase.trainerId) {
					continue;
				}

				const purchaseSessions = await purchaseSessionRepo.findByPurchaseId(purchaseId);
				if (purchaseSessions.length === 0) {
					continue;
				}

				const result = await sessionSyncService.syncPurchaseSessionsToTutoringSessions(
					purchase,
					purchaseSessions,
					purchase.trainerId
				);

				syncResults.push({ purchaseId, ...result });
				totalSynced += result.sessionsCreated + result.sessionsUpdated;

				if (result.errors.length > 0) {
					errors.push(...result.errors.map(e => ({ purchaseId, error: e.error })));
				}
			} catch (error: any) {
				errors.push({
					purchaseId,
					error: error.message || String(error),
				});
			}
		}

		return successResponse(res, {
			message: `Synced ${totalSynced} sessions from ${purchaseIds.length} purchases`,
			data: {
				purchasesProcessed: purchaseIds.length,
				totalSessionsSynced: totalSynced,
				errors: errors.length > 0 ? errors : undefined,
				results: syncResults,
			},
		});
	});

	/**
	 * Sync a single purchase session by ID
	 * POST /api/v1/booking/sync-sessions/session/:sessionId
	 */
	syncSingleSession = asyncHandler(async (req: Request, res: Response) => {
		const { sessionId } = req.params;

		if (!sessionId) {
			return errorResponse(res, {
				statusCode: 400,
				message: 'Session ID is required',
			});
		}

		const result = await sessionSyncService.syncPurchaseSessionById(sessionId);

		if (!result.success) {
			return errorResponse(res, {
				statusCode: 500,
				message: result.error || 'Failed to sync session',
			});
		}

		return successResponse(res, {
			message: 'Session synced successfully',
		});
	});
}

