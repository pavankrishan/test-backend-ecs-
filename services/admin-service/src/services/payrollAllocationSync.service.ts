import { getPool } from '../config/database';
import type { TrainerAllocationRecord } from '../models/trainerAllocation.model';

/**
 * Service to sync trainer_allocations with trainer_student_allocations
 * for payroll calculations
 */
export class PayrollAllocationSyncService {
	private pool = getPool();

	/**
	 * Sync an approved allocation to trainer_student_allocations
	 * Called when a trainer allocation is approved
	 */
	async syncAllocationToPayroll(allocation: TrainerAllocationRecord): Promise<void> {
		if (!allocation.trainerId || !allocation.studentId) {
			console.warn('[PayrollSync] Skipping sync - missing trainerId or studentId', {
				allocationId: allocation.id,
				hasTrainerId: !!allocation.trainerId,
				hasStudentId: !!allocation.studentId,
			});
			return;
		}

		if (allocation.status !== 'approved' && allocation.status !== 'active') {
			console.log('[PayrollSync] Skipping sync - allocation not approved/active', {
				allocationId: allocation.id,
				status: allocation.status,
			});
			return;
		}

		try {
			// Check if payroll allocation already exists
			const existing = await this.pool.query(
				`
					SELECT id, end_date
					FROM trainer_student_allocations
					WHERE trainer_id = $1
						AND student_id = $2
						AND end_date IS NULL
					LIMIT 1
				`,
				[allocation.trainerId, allocation.studentId]
			);

			if (existing.rows.length > 0) {
				console.log('[PayrollSync] Payroll allocation already exists (active)', {
					allocationId: allocation.id,
					payrollAllocationId: existing.rows[0].id,
				});
				return;
			}

			// Use allocated_at or requested_at as start_date
			const startDate = allocation.allocatedAt 
				? new Date(allocation.allocatedAt).toISOString().split('T')[0]
				: new Date(allocation.requestedAt).toISOString().split('T')[0];

			// Create payroll allocation
			const result = await this.pool.query(
				`
					INSERT INTO trainer_student_allocations (
						trainer_id,
						student_id,
						start_date,
						end_date,
						created_at,
						updated_at
					)
					VALUES ($1, $2, $3, NULL, NOW(), NOW())
					ON CONFLICT DO NOTHING
					RETURNING id
				`,
				[allocation.trainerId, allocation.studentId, startDate]
			);

			if (result.rows.length > 0) {
				console.log('[PayrollSync] ✅ Created payroll allocation', {
					allocationId: allocation.id,
					payrollAllocationId: result.rows[0].id,
					trainerId: allocation.trainerId,
					studentId: allocation.studentId,
					startDate,
				});
			} else {
				console.log('[PayrollSync] Payroll allocation already exists (conflict)', {
					allocationId: allocation.id,
				});
			}
		} catch (error: any) {
			console.error('[PayrollSync] ❌ Failed to sync allocation to payroll', {
				allocationId: allocation.id,
				error: error?.message || String(error),
				stack: error?.stack,
			});
			// Don't throw - payroll sync failure shouldn't break allocation
		}
	}

	/**
	 * End a payroll allocation when trainer allocation is cancelled/completed
	 */
	async endPayrollAllocation(
		trainerId: string,
		studentId: string,
		endDate?: Date
	): Promise<void> {
		if (!trainerId || !studentId) {
			return;
		}

		try {
			const endDateStr = endDate 
				? endDate.toISOString().split('T')[0]
				: new Date().toISOString().split('T')[0];

			const result = await this.pool.query(
				`
					UPDATE trainer_student_allocations
					SET end_date = $3,
						updated_at = NOW()
					WHERE trainer_id = $1
						AND student_id = $2
						AND end_date IS NULL
					RETURNING id
				`,
				[trainerId, studentId, endDateStr]
			);

			if (result.rows.length > 0) {
				console.log('[PayrollSync] ✅ Ended payroll allocation', {
					trainerId,
					studentId,
					endDate: endDateStr,
					payrollAllocationId: result.rows[0].id,
				});
			} else {
				console.log('[PayrollSync] No active payroll allocation found to end', {
					trainerId,
					studentId,
				});
			}
		} catch (error: any) {
			console.error('[PayrollSync] ❌ Failed to end payroll allocation', {
				trainerId,
				studentId,
				error: error?.message || String(error),
			});
			// Don't throw - payroll sync failure shouldn't break allocation
		}
	}

	/**
	 * Sync all existing approved allocations to payroll
	 * Useful for migration/backfill
	 */
	async syncAllExistingAllocations(): Promise<{ synced: number; errors: number }> {
		let synced = 0;
		let errors = 0;

		try {
			const allocations = await this.pool.query<TrainerAllocationRecord>(
				`
					SELECT 
						id,
						student_id,
						trainer_id,
						status,
						allocated_at,
						requested_at
					FROM trainer_allocations
					WHERE status IN ('approved', 'active')
						AND trainer_id IS NOT NULL
						AND student_id IS NOT NULL
				`
			);

			console.log(`[PayrollSync] Found ${allocations.rows.length} approved allocations to sync`);

			for (const allocation of allocations.rows) {
				try {
					await this.syncAllocationToPayroll(allocation as TrainerAllocationRecord);
					synced++;
				} catch (error: any) {
					console.error('[PayrollSync] Error syncing allocation', {
						allocationId: allocation.id,
						error: error?.message || String(error),
					});
					errors++;
				}
			}

			console.log(`[PayrollSync] ✅ Sync complete: ${synced} synced, ${errors} errors`);
		} catch (error: any) {
			console.error('[PayrollSync] ❌ Failed to sync existing allocations', {
				error: error?.message || String(error),
			});
		}

		return { synced, errors };
	}
}

