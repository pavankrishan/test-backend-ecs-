/**
 * Certificate Generation Service
 * Handles certificate generation after course completion (all sessions completed)
 * 
 * Note: Certificates should only be generated after all sessions are completed and verified.
 * This service should be called by a background job or webhook after session completion.
 */

import type { Pool, PoolClient } from 'pg';
import logger from '@kodingcaravan/shared/config/logger';
import { CertificateRepository } from '../models/certificate.model';
import { CoursePurchaseRepository } from '../models/coursePurchase.model';
import { PurchaseSessionRepository } from '../models/purchaseSession.model';

export interface CertificateGenerationResult {
	generated: number;
	skipped: number;
	errors: Array<{ purchaseId: string; error: string }>;
}

export class CertificateGenerationService {
	constructor(
		private readonly certificateRepo: CertificateRepository,
		private readonly purchaseRepo: CoursePurchaseRepository,
		private readonly sessionRepo: PurchaseSessionRepository,
		private readonly pool: Pool
	) {}

	/**
	 * Generate certificates for purchases with 30 completed sessions
	 * This should be called periodically by a background job
	 * 
	 * @param purchaseId - Optional: Generate for specific purchase, otherwise process all eligible
	 * @returns Certificate generation results
	 */
	async generateCertificatesForCompletedCourses(purchaseId?: string): Promise<CertificateGenerationResult> {
		const result: CertificateGenerationResult = {
			generated: 0,
			skipped: 0,
			errors: [],
		};

		try {
			// Find purchases with 30 completed sessions
			const eligiblePurchases = await this.findEligiblePurchases(purchaseId);

			for (const purchase of eligiblePurchases) {
				try {
					// Check if certificate already exists
					const existingCertificates = await this.certificateRepo.findByPurchaseId(purchase.id);
					if (existingCertificates.length > 0) {
						result.skipped++;
						continue;
					}

					// Verify all 30 sessions are completed
					const allSessions = await this.sessionRepo.findByPurchaseId(purchase.id);
					const completedSessions = allSessions.filter(s => s.status === 'completed');
					if (completedSessions.length !== 30) {
						result.skipped++;
						continue;
					}

					// Generate certificate
					if (!purchase.trainerId) {
						result.errors.push({
							purchaseId: purchase.id,
							error: 'Purchase does not have an assigned trainer',
						});
						continue;
					}

					const client = await this.pool.connect();
					try {
						await client.query('BEGIN');

						await this.certificateRepo.create(
							{
								purchaseId: purchase.id,
								bookingId: purchase.bookingId,
								studentId: purchase.studentId || '', // Should be available in purchase
								trainerId: purchase.trainerId,
								courseId: purchase.courseId,
								// certificateNumber is optional and will be auto-generated
								metadata: {
									totalSessions: 30,
									completedSessions: completedSessions.length,
									generatedAt: new Date().toISOString(),
								},
							},
							client
						);

						await client.query('COMMIT');
						result.generated++;
					} catch (error: any) {
						await client.query('ROLLBACK');
						throw error;
					} finally {
						client.release();
					}
				} catch (error: any) {
					result.errors.push({
						purchaseId: purchase.id,
						error: error.message || String(error),
					});
				}
			}
		} catch (error: any) {
			logger.error('Failed to generate certificates', {
				error: error?.message || String(error),
				stack: error?.stack,
				purchaseId,
				service: 'booking-service',
			});
			throw error;
		}

		return result;
	}

	/**
	 * Find purchases eligible for certificate generation
	 * Eligibility: 30 total sessions, status = ASSIGNED, all sessions completed
	 */
	private async findEligiblePurchases(purchaseId?: string): Promise<any[]> {
		// TODO: Implement query to find purchases with 30 completed sessions
		// This should query course_purchases and join with purchase_sessions
		// Filter: total_sessions = 30, status = 'ASSIGNED', all sessions status = 'completed'
		
		// Placeholder implementation
		if (purchaseId) {
			const purchase = await this.purchaseRepo.findById(purchaseId);
			return purchase && purchase.totalSessions === 30 ? [purchase] : [];
		}

		// For now, return empty array - implement proper query
		// SELECT cp.* FROM course_purchases cp
		// WHERE cp.total_sessions = 30
		//   AND cp.status = 'ASSIGNED'
		//   AND (
		//     SELECT COUNT(*) FROM purchase_sessions ps
		//     WHERE ps.purchase_id = cp.id AND ps.status = 'completed'
		//   ) = 30
		return [];
	}
}

