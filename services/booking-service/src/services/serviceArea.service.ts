/**
 * Service Area Service
 * Handles city activation, cluster detection, and service availability
 */

import { CityRepository } from '../models/city.model';
import { ClusterRepository } from '../models/cluster.model';
import { calculateDistance, isWithinRadius, type Coordinates } from '../utils/distance';
import type { Pool } from 'pg';

export interface ServiceAvailabilityResult {
	available: boolean;
	message: string;
	city: {
		id: string;
		name: string;
		isActive: boolean;
	} | null;
	nearestCluster: {
		id: string;
		name: string;
		distance: number;
	} | null;
	trainersAvailable: number;
}

export interface TrainerLocation {
	id: string;
	latitude: number;
	longitude: number;
	clusterId: string | null;
	isActive: boolean;
}

/**
 * Result type for zone lookup by city + GPS coordinates.
 * Each "zone" here is a cluster enriched with distance from the query point.
 */
export interface CityZoneMatch {
	id: string;
	cityId: string;
	name: string;
	centerLatitude: number;
	centerLongitude: number;
	radiusKm: number;
	distanceKm: number;
}

export class ServiceAreaService {
	constructor(
		private readonly cityRepo: CityRepository,
		private readonly clusterRepo: ClusterRepository,
		private readonly pool: Pool
	) {}

	/**
	 * Find all zones (clusters) in a given city that cover the provided location.
	 * Uses Haversine distance against each cluster's center and radius_km.
	 *
	 * Returns an array of matching zones ordered by proximity,
	 * or the sentinel string "SERVICE_NOT_AVAILABLE" when:
	 * - city does not exist or is inactive
	 * - city has no active clusters
	 * - location is outside all cluster radii
	 */
	async findZonesByCityAndLocation(
		cityId: string,
		latitude: number,
		longitude: number
	): Promise<CityZoneMatch[] | 'SERVICE_NOT_AVAILABLE'> {
		const city = await this.cityRepo.findById(cityId);

		if (!city || !city.isActive) {
			return 'SERVICE_NOT_AVAILABLE';
		}

		const clusters = await this.clusterRepo.findByCityId(cityId);

		if (!clusters.length) {
			return 'SERVICE_NOT_AVAILABLE';
		}

		const point: Coordinates = { latitude, longitude };

		const matches: CityZoneMatch[] = clusters
			.map((cluster) => {
				const distanceKm = calculateDistance(point, {
					latitude: cluster.centerLatitude,
					longitude: cluster.centerLongitude,
				});

				return {
					id: cluster.id,
					cityId: cluster.cityId,
					name: cluster.name,
					centerLatitude: cluster.centerLatitude,
					centerLongitude: cluster.centerLongitude,
					radiusKm: cluster.radiusKm,
					distanceKm,
				};
			})
			.filter((zone) => zone.distanceKm <= zone.radiusKm)
			.sort((a, b) => a.distanceKm - b.distanceKm);

		if (!matches.length) {
			return 'SERVICE_NOT_AVAILABLE';
		}

		return matches;
	}

	/**
	 * Check service availability for a location
	 */
	async checkServiceAvailability(
		latitude: number,
		longitude: number,
		courseId: string,
		timeslot: string,
		getAvailableTrainers: (location: Coordinates, courseId: string, timeslot: string) => Promise<TrainerLocation[]>
	): Promise<ServiceAvailabilityResult> {
		// Step 1: Detect city from coordinates (simplified - in production, use reverse geocoding)
		const city = await this.detectCity(latitude, longitude);

		if (!city) {
			return {
				available: false,
				message: 'Service not available in this location',
				city: null,
				nearestCluster: null,
				trainersAvailable: 0,
			};
		}

		// Step 2: Check if city is active
		if (!city.isActive) {
			return {
				available: false,
				message: 'Service not available in this city yet',
				city: {
					id: city.id,
					name: city.name,
					isActive: false,
				},
				nearestCluster: null,
				trainersAvailable: 0,
			};
		}

		// Step 3: Find nearest cluster
		const nearestCluster = await this.clusterRepo.findNearestCluster(latitude, longitude, city.id);

		if (!nearestCluster) {
			return {
				available: false,
				message: 'No clusters configured for this city',
				city: {
					id: city.id,
					name: city.name,
					isActive: true,
				},
				nearestCluster: null,
				trainersAvailable: 0,
			};
		}

		// Step 4: Check for available trainers within 5km
		const studentLocation: Coordinates = { latitude, longitude };
		const availableTrainers = await getAvailableTrainers(studentLocation, courseId, timeslot);

		// Filter trainers within 5km radius
		const trainersWithin5km = availableTrainers.filter((trainer) =>
			isWithinRadius(
				studentLocation,
				{ latitude: trainer.latitude, longitude: trainer.longitude },
				5
			)
		);

		if (trainersWithin5km.length === 0) {
			return {
				available: false,
				message: 'Coming Soon in your area',
				city: {
					id: city.id,
					name: city.name,
					isActive: true,
				},
				nearestCluster: {
					id: nearestCluster.id,
					name: nearestCluster.name,
					distance: calculateDistance(
						studentLocation,
						{ latitude: nearestCluster.centerLatitude, longitude: nearestCluster.centerLongitude }
					),
				},
				trainersAvailable: 0,
			};
		}

		return {
			available: true,
			message: 'Service Available',
			city: {
				id: city.id,
				name: city.name,
				isActive: true,
			},
			nearestCluster: {
				id: nearestCluster.id,
				name: nearestCluster.name,
				distance: calculateDistance(
					studentLocation,
					{ latitude: nearestCluster.centerLatitude, longitude: nearestCluster.centerLongitude }
				),
			},
			trainersAvailable: trainersWithin5km.length,
		};
	}

	/**
	 * Detect city from coordinates
	 * In production, use reverse geocoding API (Google Maps, Mapbox, etc.)
	 * For now, this is a placeholder that would need to be implemented
	 */
	private async detectCity(latitude: number, longitude: number): Promise<{ id: string; name: string; isActive: boolean } | null> {
		// TODO: Implement reverse geocoding
		// For now, return null - this should be implemented with a geocoding service
		// You can use Google Maps Geocoding API, Mapbox, or similar
		
		// Placeholder: Query cities and find by proximity
		// In production, use a proper geocoding service
		const cities = await this.cityRepo.findAll({ limit: 100 });
		
		// This is a simplified approach - in production, use PostGIS or geocoding API
		return cities.length > 0 && cities[0] ? {
			id: cities[0].id,
			name: cities[0].name,
			isActive: cities[0].isActive,
		} : null;
	}

	/**
	 * Find nearest cluster to a location
	 */
	async findNearestCluster(latitude: number, longitude: number, cityId?: string) {
		return this.clusterRepo.findNearestCluster(latitude, longitude, cityId);
	}
}

