/**
 * Pre-Booking Service
 * Handles pre-booking creation with all validations
 */

import { PreBookingRepository, type PreBookingCreateInput } from '../models/preBooking.model';
import { PreBookingCapacityRepository } from '../models/preBookingCapacity.model';
import { FeatureFlagRepository } from '../models/featureFlag.model';
import { PricingService, type ClassType } from './pricing.service';
import { CouponRepository } from '../models/coupon.model';
import type { Pool, PoolClient } from 'pg';

export class PreBookingService {
	private preBookingRepo: PreBookingRepository;
	private capacityRepo: PreBookingCapacityRepository;
	private featureFlagRepo: FeatureFlagRepository;
	private pricingService: PricingService;
	private couponRepo: CouponRepository;

	constructor(pool: Pool) {
		this.preBookingRepo = new PreBookingRepository(pool);
		this.capacityRepo = new PreBookingCapacityRepository(pool);
		this.featureFlagRepo = new FeatureFlagRepository(pool);
		this.pricingService = new PricingService(pool);
		this.couponRepo = new CouponRepository(pool);
	}

	/**
	 * Validate day is NOT Sunday
	 */
	private validateDayOfWeek(date: Date): void {
		const dayOfWeek = date.getDay(); // 0 = Sunday
		if (dayOfWeek === 0) {
			throw new Error('Sunday bookings are not allowed');
		}
	}

	/**
	 * Validate timeslot is 6 AM - 8 PM
	 */
	private validateTimeslot(timeslot: string): void {
		const [hours, minutes] = timeslot.split(':').map(Number);
		const hour = hours || 0;

		if (hour < 6 || hour >= 20) {
			throw new Error('Time slot must be between 6 AM and 8 PM');
		}
	}

	/**
	 * Validate session package based on feature flags
	 */
	private async validateSessionPackage(sessionCount: 10 | 20 | 30): Promise<void> {
		if (sessionCount === 10) {
			const enabled = await this.featureFlagRepo.isEnabled('enable_10_session_packages');
			if (!enabled) {
				throw new Error('10-session packages are currently disabled');
			}
		}

		if (sessionCount === 20) {
			const enabled = await this.featureFlagRepo.isEnabled('enable_20_session_packages');
			if (!enabled) {
				throw new Error('20-session packages are currently disabled');
			}
		}
	}

	/**
	 * Create pre-booking with all validations
	 */
	async createPreBooking(
		input: PreBookingCreateInput & { startDate: Date },
		client?: PoolClient
	): Promise<{
		preBooking: Awaited<ReturnType<PreBookingRepository['create']>>;
		capacityRemaining: number;
		pricing: Awaited<ReturnType<PricingService['calculatePricing']>>;
	}> {
		// 1. Validate day is NOT Sunday
		this.validateDayOfWeek(input.startDate);

		// 2. Validate timeslot is 6 AM - 8 PM
		this.validateTimeslot(input.timeslot);

		// 3. Check feature flag for session package
		await this.validateSessionPackage(input.sessionCount);

		// 4. Validate coupon if provided
		let couponId: string | null = null;
		let couponCode: string | undefined = undefined;

		// Check if coupon code is in metadata
		if (input.metadata && (input.metadata as any).couponCode) {
			couponCode = (input.metadata as any).couponCode;
		}

		// If couponId is directly provided, use it
		if (input.couponId) {
			couponId = input.couponId;
		}

		// 5. Calculate pricing (official vs summer based on coupon)
		// Map mode to class type: '1on1' -> '1-on-1', '1on2' -> '1-on-2', '1on3' -> '1-on-3'
		const classTypeMap: Record<string, '1-on-1' | '1-on-2' | '1-on-3' | 'hybrid'> = {
			'1on1': '1-on-1',
			'1on2': '1-on-2',
			'1on3': '1-on-3',
		};
		const classType = classTypeMap[input.mode] || '1-on-1';

		const pricingInput: { classType: ClassType; couponCode?: string; date: Date } = {
			classType,
			date: input.startDate,
		};
		if (couponCode) {
			pricingInput.couponCode = couponCode;
		}
		const pricing = await this.pricingService.calculatePricing(pricingInput);

		// If coupon code was provided and validated, get the coupon ID
		if (couponCode && pricing.couponApplied) {
			const validation = await this.couponRepo.validateCoupon(
				couponCode,
				input.sessionCount,
				input.startDate,
				input.studentId ?? undefined
			);
			if (validation.valid && validation.coupon) {
				couponId = validation.coupon.id;
			}
		}

		// 6. Atomic increment pre-booking capacity counter
		const currentCount = await this.capacityRepo.incrementCapacity(
			input.courseId,
			input.timeslot,
			client
		);

		const capacity = await this.capacityRepo.getCapacity(input.courseId, input.timeslot);
		const capacityRemaining = capacity ? capacity.maxCapacity - capacity.currentCount : 0;

		// 7. Create pre-booking record
		const preBooking = await this.preBookingRepo.create(
			{
				...input,
				couponId,
				pricingType: pricing.pricingType,
				basePrice: pricing.basePrice,
				gstAmount: pricing.gstAmount,
				totalAmount: pricing.total,
				bookingDayOfWeek: input.startDate.getDay() === 0 ? null : input.startDate.getDay(),
			},
			client
		);

		return {
			preBooking,
			capacityRemaining,
			pricing,
		};
	}
}

