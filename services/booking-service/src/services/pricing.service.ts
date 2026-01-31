/**
 * Pricing Service
 * Handles pricing calculation with coupon support and welcome offer
 * 
 * IMPORTANT: Pricing is based on CLASS TYPE only, not on course.
 * All courses use the same pricing structure based on class type:
 * - 1-on-1: Official ₹9,000 | With Coupon: ₹7,000 (₹2,000 discount)
 * - 1-on-2: Official ₹7,500 | With Coupon: ₹6,000 (₹1,500 discount)
 * - 1-on-3: Official ₹6,000 | With Coupon: ₹5,000 (₹1,000 discount)
 * - Hybrid: Official ₹5,000 | With Coupon: ₹4,000 (₹1,000 discount)
 * 
 * COUPON DISCOUNTS:
 * - Coupons circulated on social media apply class-type-specific discounts
 * - Discount amounts vary by class type (not stored in coupon, calculated dynamically)
 * - Summer pricing is NOT directly applied - only through coupon discounts
 * 
 * WELCOME OFFER:
 * - Welcome offer (claimDeal) applies ₹1,000 discount for all class types
 * - Only applied when user explicitly claims it on home screen and enters code
 * 
 * The pricing_config table stores pricing by class_type and pricing_type only.
 * No course_id is used in pricing calculations.
 */

import { PricingConfigRepository } from '../models/pricingConfig.model';
import { CouponRepository } from '../models/coupon.model';
import type { Pool } from 'pg';
import logger from '@kodingcaravan/shared/config/logger';

export type ClassType = '1-on-1' | '1-on-2' | '1-on-3' | 'hybrid';

export interface PricingCalculationInput {
	classType: ClassType;
	couponCode?: string;
	claimDeal?: boolean; // New: flag to indicate if user is claiming their deal (₹1000 discount)
	date?: Date;
}

export interface PricingResult {
	classType: ClassType;
	pricingType: 'official' | 'summer';
	basePrice: number;
	originalPrice: number; // Original price before any discounts
	gstPercentage: number;
	gstAmount: number;
	subtotal: number;
	total: number;
	couponApplied: {
		code: string;
		type: string;
		discountType: string;
	} | null;
	claimDealApplied: boolean; // New: flag to indicate if claim deal discount was applied
	isSummerPricing: boolean;
	requiresCoupon: boolean;
}

export class PricingService {
	private pricingConfigRepo: PricingConfigRepository;
	private couponRepo: CouponRepository;

	constructor(pool: Pool) {
		this.pricingConfigRepo = new PricingConfigRepository(pool);
		this.couponRepo = new CouponRepository(pool);
	}

	/**
	 * Check if current date is within summer period (Apr 1 - Jul 31)
	 */
	private isSummerPeriod(date: Date = new Date()): boolean {
		const month = date.getMonth() + 1; // 1-12
		const day = date.getDate();

		// April (4) to July (7)
		if (month >= 4 && month <= 7) {
			// April 1 to July 31
			if (month === 4 && day >= 1) return true;
			if (month > 4 && month < 7) return true;
			if (month === 7 && day <= 31) return true;
		}

		return false;
	}

	/**
	 * Get discount amount based on class type for coupon codes
	 * Coupons circulated on social media apply class-type-specific discounts
	 */
	private getCouponDiscountByClassType(classType: ClassType): number {
		const discountMap: Record<ClassType, number> = {
			'1-on-1': 2000,  // ₹2,000 discount for 1-on-1
			'1-on-2': 1500,  // ₹1,500 discount for 1-on-2
			'1-on-3': 1000,  // ₹1,000 discount for 1-on-3
			'hybrid': 1000,  // ₹1,000 discount for hybrid
		};
		return discountMap[classType] || 0;
	}

	/**
	 * Calculate pricing with coupon validation and claim deal support
	 * IMPORTANT: Coupons apply class-type-specific discounts, not summer pricing directly
	 */
	async calculatePricing(input: PricingCalculationInput): Promise<PricingResult> {
		// Don't use default value for claimDeal - explicitly check if it's provided
		const { classType, couponCode, date = new Date() } = input;
		// Handle claimDeal - it can be boolean true, string 'true', number 1, or undefined/false
		// CRITICAL: Check the input value directly, don't use default
		const claimDealValue = input.claimDeal;
		// Normalize claimDeal to boolean - handles all possible input types
		const claimDeal = claimDealValue === true || 
			(typeof claimDealValue === 'string' && (claimDealValue === 'true' || claimDealValue === '1')) ||
			(typeof claimDealValue === 'number' && claimDealValue === 1);
		
		// Log input parameters for debugging
		logger.debug('calculatePricing called', {
			classType,
			hasCouponCode: !!couponCode,
			claimDeal,
			claimDealValue,
			claimDealValueType: typeof claimDealValue,
			date: date.toISOString(),
			service: 'booking-service',
		});

		// Always use official pricing - summer pricing is NOT directly applied
		// Coupons apply class-type-specific discounts instead
		let pricingType: 'official' | 'summer' = 'official';
		let coupon = null;
		let requiresCoupon = false;
		let claimDealApplied = false;

		// Validate coupon if provided (coupon and claim deal are mutually exclusive)
		if (couponCode) {
			if (claimDeal) {
				throw new Error('Cannot use both coupon code and claim deal. Please use only one discount option.');
			}
			// For coupon validation, we use a default session count (30) since pricing is now by class type
			const validation = await this.couponRepo.validateCoupon(couponCode, 30, date);
			if (!validation.valid) {
				throw new Error(validation.error || 'Invalid coupon');
			}

			coupon = validation.coupon!;
			// Note: We don't use summer pricing even if coupon enables it
			// Instead, we apply class-type-specific discount amounts
		}

		// Get pricing config by class type (always use official pricing)
		const pricing = await this.pricingConfigRepo.calculatePricing(classType, pricingType, date);

		// Store original price before any discounts
		const originalPrice = pricing.total;

		// Apply coupon discount if applicable
		// Welcome offer (claimDeal) is ONLY applied when user explicitly claims it on home screen
		// and enters the code - it is NOT auto-applied for users without coupons
		let finalBasePrice = pricing.basePrice;
		let finalSubtotal = pricing.subtotal;
		let finalGstAmount = pricing.gstAmount;
		let finalTotal = pricing.total;
		let discountAmount = 0;

		if (coupon) {
			// Coupons apply class-type-specific discounts (not the discountValue from coupon)
			// Discount amounts vary by class type:
			// - 1-on-1: ₹2,000 discount (₹9,000 → ₹7,000)
			// - 1-on-2: ₹1,500 discount (₹7,500 → ₹6,000)
			// - 1-on-3: ₹1,000 discount (₹6,000 → ₹5,000)
			// - Hybrid: ₹1,000 discount (₹5,000 → ₹4,000)
			discountAmount = this.getCouponDiscountByClassType(classType);
			logger.info('Applying coupon discount', {
				discountAmount,
				classType,
				couponCode: couponCode?.substring(0, 4) + '***',
				service: 'booking-service',
			});
			// Apply discount to base price (before GST)
			finalBasePrice = Math.max(0, pricing.basePrice - discountAmount);
			finalSubtotal = finalBasePrice;
			// Recalculate GST on discounted amount
			finalGstAmount = (finalBasePrice * pricing.gstPercentage) / 100;
			finalTotal = finalBasePrice + finalGstAmount;
		} else if (claimDeal) {
			// Apply claim deal discount (₹1000 fixed discount) - welcome offer
			discountAmount = 1000;
			logger.info('Applying welcome offer discount', {
				discountAmount,
				classType,
				originalBasePrice: pricing.basePrice,
				originalTotal: pricing.total,
				service: 'booking-service',
			});
			// Apply discount to base price (before GST)
			finalBasePrice = Math.max(0, pricing.basePrice - discountAmount);
			finalSubtotal = finalBasePrice;
			// Recalculate GST on discounted amount
			finalGstAmount = (finalBasePrice * pricing.gstPercentage) / 100;
			finalTotal = finalBasePrice + finalGstAmount;
			claimDealApplied = true;
			logger.debug('Welcome offer discount applied', {
				finalBasePrice,
				finalGstAmount,
				finalTotal,
				classType,
				service: 'booking-service',
			});
		} else {
			logger.debug('No discount applied', {
				claimDeal,
				claimDealValue,
				claimDealValueType: typeof claimDealValue,
				classType,
				service: 'booking-service',
			});
		}

		return {
			classType,
			pricingType,
			basePrice: finalBasePrice,
			originalPrice: originalPrice, // Original price before discounts
			gstPercentage: pricing.gstPercentage,
			gstAmount: Math.round(finalGstAmount * 100) / 100,
			subtotal: finalSubtotal,
			total: Math.round(finalTotal * 100) / 100,
			couponApplied: coupon
				? {
						code: coupon.code,
						type: coupon.type,
						discountType: coupon.discountType,
					}
				: null,
			claimDealApplied,
			isSummerPricing: false, // Summer pricing is not directly applied - coupons use class-type discounts
			requiresCoupon: false, // No longer require coupons for summer pricing
		};
	}
}

