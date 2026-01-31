/**
 * Script to sync all existing purchase sessions to tutoring_sessions
 * Run this once to sync all purchases that were created before the sync was implemented
 * 
 * Usage:
 *   ts-node scripts/sync-all-purchases.ts
 *   or
 *   npm run sync-sessions
 */

import { getPool } from '../services/booking-service/src/config/database';
import { CoursePurchaseRepository } from '../services/booking-service/src/models/coursePurchase.model';
import { PurchaseSessionRepository } from '../services/booking-service/src/models/purchaseSession.model';
import { SessionSyncService } from '../services/booking-service/src/services/sessionSync.service';

async function syncAllPurchases() {
	const pool = getPool();
	const purchaseRepo = new CoursePurchaseRepository(pool);
	const purchaseSessionRepo = new PurchaseSessionRepository(pool);
	const sessionSyncService = new SessionSyncService(pool);

	console.log('🔄 Starting sync of all purchase sessions...\n');

	try {
		// Get all purchases with assigned trainers
		const purchasesResult = await pool.query(
			`
				SELECT id
				FROM course_purchases
				WHERE trainer_id IS NOT NULL
					AND status = 'ASSIGNED'
				ORDER BY created_at DESC
			`
		);

		const purchaseIds = purchasesResult.rows.map((r: any) => r.id);
		
		if (purchaseIds.length === 0) {
			console.log('✅ No purchases with assigned trainers found.');
			return;
		}

		console.log(`📦 Found ${purchaseIds.length} purchases with assigned trainers\n`);

		let totalSynced = 0;
		let totalErrors = 0;
		const errors: Array<{ purchaseId: string; error: string }> = [];

		for (let i = 0; i < purchaseIds.length; i++) {
			const purchaseId = purchaseIds[i];
			
			try {
				const purchase = await purchaseRepo.findById(purchaseId);
				if (!purchase || !purchase.trainerId) {
					console.log(`⏭️  Purchase ${purchaseId}: Skipping (no trainer)`);
					continue;
				}

				const purchaseSessions = await purchaseSessionRepo.findByPurchaseId(purchaseId);
				if (purchaseSessions.length === 0) {
					console.log(`⏭️  Purchase ${purchaseId}: Skipping (no sessions)`);
					continue;
				}

				// Check how many are already synced
				const alreadySynced = await pool.query(
					`
						SELECT COUNT(*) as count
						FROM tutoring_sessions
						WHERE id = ANY($1::uuid[])
					`,
					[purchaseSessions.map(s => s.id)]
				);

				const syncedCount = parseInt(alreadySynced.rows[0].count, 10);
				if (syncedCount === purchaseSessions.length) {
					console.log(`✅ Purchase ${purchaseId}: Already synced (${syncedCount}/${purchaseSessions.length})`);
					continue;
				}

				console.log(`🔄 Purchase ${purchaseId} (${i + 1}/${purchaseIds.length}): Syncing ${purchaseSessions.length} sessions...`);

				const result = await sessionSyncService.syncPurchaseSessionsToTutoringSessions(
					purchase,
					purchaseSessions,
					purchase.trainerId
				);

				if (result.success && result.errors.length === 0) {
					totalSynced += result.sessionsCreated + result.sessionsUpdated;
					console.log(`   ✅ Synced: ${result.sessionsCreated} created, ${result.sessionsUpdated} updated`);
				} else {
					totalSynced += result.sessionsCreated + result.sessionsUpdated;
					totalErrors += result.errors.length;
					result.errors.forEach(error => {
						errors.push({ purchaseId, error: error.error });
					});
					console.log(`   ⚠️  Partial sync: ${result.sessionsCreated} created, ${result.sessionsUpdated} updated, ${result.errors.length} errors`);
				}
			} catch (error: any) {
				totalErrors++;
				const errorMsg = error.message || String(error);
				errors.push({ purchaseId, error: errorMsg });
				console.error(`   ❌ Error: ${errorMsg}`);
			}

			// Small delay to avoid overwhelming the database
			if (i < purchaseIds.length - 1) {
				await new Promise(resolve => setTimeout(resolve, 100));
			}
		}

		console.log('\n' + '='.repeat(60));
		console.log('📊 SYNC SUMMARY');
		console.log('='.repeat(60));
		console.log(`Total purchases processed: ${purchaseIds.length}`);
		console.log(`Total sessions synced: ${totalSynced}`);
		console.log(`Total errors: ${totalErrors}`);

		if (errors.length > 0) {
			console.log('\n❌ ERRORS:');
			errors.forEach(({ purchaseId, error }) => {
				console.log(`   ${purchaseId}: ${error}`);
			});
		}

		console.log('\n✅ Sync completed!\n');
	} catch (error: any) {
		console.error('❌ Fatal error:', error);
		process.exit(1);
	} finally {
		await pool.end();
	}
}

// Run the script
if (require.main === module) {
	syncAllPurchases()
		.then(() => process.exit(0))
		.catch((error) => {
			console.error('Fatal error:', error);
			process.exit(1);
		});
}

export { syncAllPurchases };

