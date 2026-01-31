/**
 * Pricing Controller
 * Handles pricing calculation with coupon support
 */

import { Request, Response } from 'express';
import { PricingService } from '../services/pricing.service';
import { CouponRepository } from '../models/coupon.model';
import { FeatureFlagRepository } from '../models/featureFlag.model';
import { getPool } from '../config/database';
import logger from '@kodingcaravan/shared/config/logger';

export class PricingController {
	private pricingService: PricingService;
	private couponRepo: CouponRepository;
	private featureFlagRepo: FeatureFlagRepository;

	constructor() {
		const pool = getPool();
		this.pricingService = new PricingService(pool);
		this.couponRepo = new CouponRepository(pool);
		this.featureFlagRepo = new FeatureFlagRepository(pool);
	}

	/**
	 * GET /api/v1/pricing/calculate
	 * Calculate pricing with optional coupon
	 */
	calculatePricing = async (req: Request, res: Response): Promise<void> => {
		try {
			const { classType, couponCode, claimDeal } = req.query;

			logger.debug('Pricing calculation request received', {
				classType,
				hasCouponCode: !!couponCode,
				claimDeal,
				claimDealType: typeof claimDeal,
				correlationId: (req as any).correlationId,
				service: 'booking-service',
			});

			if (!classType || !['1-on-1', '1-on-2', '1-on-3', 'hybrid'].includes(classType as string)) {
				res.status(400).json({
					success: false,
					message: 'Invalid classType. Must be 1-on-1, 1-on-2, 1-on-3, or hybrid',
				});
				return;
			}

			const pricingInput: { classType: '1-on-1' | '1-on-2' | '1-on-3' | 'hybrid'; couponCode?: string; claimDeal?: boolean; date: Date } = {
				classType: classType as '1-on-1' | '1-on-2' | '1-on-3' | 'hybrid',
				date: new Date(),
			};
			if (couponCode) {
				pricingInput.couponCode = couponCode as string;
			}
			// Handle claimDeal parameter - explicitly check for true/1
			// Query params come as strings, so 'true' string means true
			// CRITICAL: Must check for string 'true' since query params are always strings
			const claimDealStr = typeof claimDeal === 'string' ? claimDeal : String(claimDeal ?? '');
			const isClaimDeal = claimDealStr === 'true' || claimDealStr === '1';
			if (isClaimDeal) {
				pricingInput.claimDeal = true;
				logger.info('Welcome offer (claimDeal) requested', {
					classType,
					claimDealValue: claimDeal,
					correlationId: (req as any).correlationId,
					service: 'booking-service',
				});
			} else {
				// Explicitly set to false (not undefined) to ensure service knows it's not applied
				pricingInput.claimDeal = false;
				logger.debug('No welcome offer requested', {
					claimDeal,
					claimDealType: typeof claimDeal,
					isClaimDeal,
					classType,
					correlationId: (req as any).correlationId,
					service: 'booking-service',
				});
			}
			
			logger.debug('Calling pricingService', {
				classType: pricingInput.classType,
				hasCouponCode: !!pricingInput.couponCode,
				claimDeal: pricingInput.claimDeal,
				correlationId: (req as any).correlationId,
				service: 'booking-service',
			});
			const result = await this.pricingService.calculatePricing(pricingInput);
			logger.debug('Pricing calculation result', {
				total: result.total,
				basePrice: result.basePrice,
				claimDealApplied: result.claimDealApplied,
				originalPrice: result.originalPrice,
				classType: result.classType,
				correlationId: (req as any).correlationId,
				service: 'booking-service',
			});

			// Ensure response includes all required fields
			const responseData = {
				...result,
				// Explicitly ensure these fields are present
				originalPrice: result.originalPrice ?? result.total,
				claimDealApplied: result.claimDealApplied ?? false,
			};

			res.json({
				success: true,
				data: responseData,
			});
		} catch (error: any) {
			res.status(400).json({
				success: false,
				message: error.message || 'Failed to calculate pricing',
			});
		}
	};

	/**
	 * POST /api/v1/coupons/validate
	 * Validate coupon code
	 */
	validateCoupon = async (req: Request, res: Response): Promise<void> => {
		try {
			const { code, sessionCount, studentId } = req.body;

			if (!code) {
				res.status(400).json({
					success: false,
					message: 'Coupon code is required',
				});
				return;
			}

			const validation = await this.couponRepo.validateCoupon(
				code,
				sessionCount || 30,
				new Date(),
				studentId
			);

			if (!validation.valid) {
				res.status(400).json({
					success: false,
					message: validation.error || 'Invalid coupon',
					data: {
						valid: false,
						coupon: validation.coupon,
					},
				});
				return;
			}

			res.json({
				success: true,
				data: {
					valid: true,
					coupon: {
						id: validation.coupon!.id,
						code: validation.coupon!.code,
						type: validation.coupon!.type,
						discountType: validation.coupon!.discountType,
						validFrom: validation.coupon!.validFrom,
						validUntil: validation.coupon!.validUntil,
						remainingRedemptions: validation.coupon!.maxRedemptions
							? validation.coupon!.maxRedemptions - validation.coupon!.currentRedemptions
							: null,
					},
					appliesSummerPricing: validation.appliesSummerPricing,
				},
			});
		} catch (error: any) {
			res.status(500).json({
				success: false,
				message: error.message || 'Failed to validate coupon',
			});
		}
	};

	/**
	 * GET /api/v1/booking/feature-flags
	 * Get all feature flags
	 */
	getFeatureFlags = async (req: Request, res: Response): Promise<void> => {
		try {
			const flags = {
				enable_10_session_packages: await this.featureFlagRepo.isEnabled('enable_10_session_packages'),
				enable_20_session_packages: await this.featureFlagRepo.isEnabled('enable_20_session_packages'),
				enable_sunday_focus: await this.featureFlagRepo.isEnabled('enable_sunday_focus'),
				summer_pricing_enabled: await this.featureFlagRepo.isEnabled('summer_pricing_enabled'),
			};

			res.json({
				success: true,
				data: flags,
			});
		} catch (error: any) {
			res.status(500).json({
				success: false,
				message: error.message || 'Failed to get feature flags',
			});
		}
	};
}

