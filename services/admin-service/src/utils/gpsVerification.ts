/**
 * GPS Verification Utility
 * Verifies if trainer is within student's home radius (50-150m)
 */

export interface Location {
	latitude: number;
	longitude: number;
}

export interface GPSVerificationResult {
	passed: boolean;
	distance: number; // in meters
	withinRadius: boolean;
	reason?: string;
}

/**
 * Calculate distance between two GPS coordinates using Haversine formula
 * Returns distance in meters
 */
export function calculateDistance(
	location1: Location,
	location2: Location
): number {
	const R = 6371000; // Earth's radius in meters
	const lat1Rad = (location1.latitude * Math.PI) / 180;
	const lat2Rad = (location2.latitude * Math.PI) / 180;
	const deltaLatRad = ((location2.latitude - location1.latitude) * Math.PI) / 180;
	const deltaLonRad = ((location2.longitude - location1.longitude) * Math.PI) / 180;

	const a =
		Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
		Math.cos(lat1Rad) *
			Math.cos(lat2Rad) *
			Math.sin(deltaLonRad / 2) *
			Math.sin(deltaLonRad / 2);

	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	const distance = R * c;

	return Math.round(distance * 100) / 100; // Round to 2 decimal places
}

/**
 * Verify if trainer is within student's home radius
 * @param studentHomeLocation - Student's home GPS coordinates
 * @param trainerLocation - Trainer's current GPS coordinates
 * @param radiusMeters - Allowed radius in meters (default: 100m, range: 50-150m)
 * @returns Verification result with distance and pass/fail status
 */
export function verifyGPSLocation(
	studentHomeLocation: Location,
	trainerLocation: Location,
	radiusMeters: number = 100
): GPSVerificationResult {
	// Clamp radius between 50-150m
	const clampedRadius = Math.max(50, Math.min(150, radiusMeters));

	// Calculate distance
	const distance = calculateDistance(studentHomeLocation, trainerLocation);

	// Check if within radius
	const withinRadius = distance <= clampedRadius;

	return {
		passed: withinRadius,
		distance,
		withinRadius,
		reason: withinRadius
			? undefined
			: `Trainer is ${Math.round(distance)}m away from student's home. Maximum allowed: ${clampedRadius}m`,
	};
}

/**
 * Get recommended radius based on location accuracy
 * Urban areas: 50m
 * Suburban areas: 100m
 * Rural areas: 150m
 */
export function getRecommendedRadius(areaType: 'urban' | 'suburban' | 'rural'): number {
	switch (areaType) {
		case 'urban':
			return 50;
		case 'suburban':
			return 100;
		case 'rural':
			return 150;
		default:
			return 100;
	}
}

