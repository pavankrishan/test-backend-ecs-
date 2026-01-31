/**
 * Pre-Booking Demand Calculator Service
 * Calculates trainer requirements based on pre-bookings
 */

import { PreBookingRepository, type PreBooking } from '../models/preBooking.model';
import type { Pool } from 'pg';

export interface TrainerRequirementSummary {
	cityId: string | null;
	cityName: string | null;
	totalPreBookings: number;
	clusterBreakdown: Array<{
		clusterId: string;
		clusterName: string;
		preBookings: number;
		trainersNeeded: number;
	}>;
	timeslotBreakdown: Array<{
		timeslot: string;
		preBookings: number;
		trainersNeeded: number;
	}>;
	totalTrainersNeeded: number;
	withBuffer: number; // 30% buffer added
}

export class DemandCalculatorService {
	constructor(
		private readonly preBookingRepo: PreBookingRepository,
		private readonly pool: Pool
	) {}

	/**
	 * Calculate trainer demand from pre-bookings
	 * Algorithm:
	 * 1. Group by: city → cluster → timeslot
	 * 2. Count number of bookings (not students)
	 * 3. trainersNeeded = numberOfBookings (since trainerNeeded = 1 regardless of groupSize)
	 * 4. Add 30% buffer
	 */
	async calculateTrainerDemand(
		cityName?: string,
		trainerCapacity: number = 50
	): Promise<TrainerRequirementSummary | TrainerRequirementSummary[]> {
		// Get all pending pre-bookings
		const preBookings = await this.preBookingRepo.findAll({
			status: 'pending',
			limit: 10000, // Large limit to get all
		});

		if (preBookings.length === 0) {
			return cityName
				? {
						cityId: null,
						cityName,
						totalPreBookings: 0,
						clusterBreakdown: [],
						timeslotBreakdown: [],
						totalTrainersNeeded: 0,
						withBuffer: 0,
					}
				: [];
		}

		// Group by city
		const byCity = new Map<string, PreBooking[]>();
		for (const booking of preBookings) {
			const cityKey = booking.cityId || 'unknown';
			if (!byCity.has(cityKey)) {
				byCity.set(cityKey, []);
			}
			byCity.get(cityKey)!.push(booking);
		}

		// If cityName is specified, filter to that city
		if (cityName) {
			// Find city by name (simplified - in production, use proper city lookup)
			const cityBookings = Array.from(byCity.values()).flat();
			const filteredBookings = cityBookings; // In production, filter by actual city name

			return this.calculateForCity(filteredBookings, cityName);
		}

		// Return summary for all cities
		const summaries: TrainerRequirementSummary[] = [];
		for (const [cityId, bookings] of byCity.entries()) {
			const summary = await this.calculateForCity(bookings, cityId);
			summaries.push(summary);
		}

		return summaries;
	}

	private async calculateForCity(
		preBookings: PreBooking[],
		cityIdentifier: string
	): Promise<TrainerRequirementSummary> {
		// Group by cluster
		const byCluster = new Map<string, PreBooking[]>();
		for (const booking of preBookings) {
			const clusterKey = booking.clusterId || 'no-cluster';
			if (!byCluster.has(clusterKey)) {
				byCluster.set(clusterKey, []);
			}
			byCluster.get(clusterKey)!.push(booking);
		}

		// Group by timeslot
		const byTimeslot = new Map<string, PreBooking[]>();
		for (const booking of preBookings) {
			if (!byTimeslot.has(booking.timeslot)) {
				byTimeslot.set(booking.timeslot, []);
			}
			byTimeslot.get(booking.timeslot)!.push(booking);
		}

		// Calculate cluster breakdown
		const clusterBreakdown = Array.from(byCluster.entries()).map(([clusterId, bookings]) => {
			// trainersNeeded = numberOfBookings (not students)
			// Since trainerNeeded = 1 regardless of groupSize (1on1, 1on2, 1on3)
			const trainersNeeded = bookings.length;
			return {
				clusterId,
				clusterName: clusterId === 'no-cluster' ? 'Unassigned' : clusterId,
				preBookings: bookings.length,
				trainersNeeded,
			};
		});

		// Calculate timeslot breakdown
		const timeslotBreakdown = Array.from(byTimeslot.entries()).map(([timeslot, bookings]) => {
			const trainersNeeded = bookings.length;
			return {
				timeslot,
				preBookings: bookings.length,
				trainersNeeded,
			};
		});

		// Total trainers needed = total number of bookings
		// Since each booking needs 1 trainer (regardless of groupSize)
		const totalTrainersNeeded = preBookings.length;

		// Add 30% buffer
		const withBuffer = Math.ceil(totalTrainersNeeded * 1.3);

		return {
			cityId: preBookings[0]?.cityId || null,
			cityName: cityIdentifier,
			totalPreBookings: preBookings.length,
			clusterBreakdown,
			timeslotBreakdown,
			totalTrainersNeeded,
			withBuffer,
		};
	}
}

