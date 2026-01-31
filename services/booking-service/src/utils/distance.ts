/**
 * Haversine Distance Calculation
 * Calculates the great-circle distance between two points on Earth
 * Returns distance in kilometers
 */

export interface Coordinates {
	latitude: number;
	longitude: number;
}

const EARTH_RADIUS_KM = 6371; // Earth's radius in kilometers

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param point1 First coordinate (lat, lng)
 * @param point2 Second coordinate (lat, lng)
 * @returns Distance in kilometers
 */
export function calculateDistance(point1: Coordinates, point2: Coordinates): number {
	const lat1Rad = toRadians(point1.latitude);
	const lat2Rad = toRadians(point2.latitude);
	const deltaLatRad = toRadians(point2.latitude - point1.latitude);
	const deltaLngRad = toRadians(point2.longitude - point1.longitude);

	const a =
		Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
		Math.cos(lat1Rad) *
			Math.cos(lat2Rad) *
			Math.sin(deltaLngRad / 2) *
			Math.sin(deltaLngRad / 2);

	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	const distance = EARTH_RADIUS_KM * c;

	return distance;
}

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
	return degrees * (Math.PI / 180);
}

/**
 * Check if a point is within a radius (in km) of another point
 */
export function isWithinRadius(
	point1: Coordinates,
	point2: Coordinates,
	radiusKm: number
): boolean {
	return calculateDistance(point1, point2) <= radiusKm;
}

/**
 * Filter coordinates by distance from a center point
 */
export function filterByDistance(
	center: Coordinates,
	points: Array<{ coordinates: Coordinates; [key: string]: any }>,
	maxDistanceKm: number
): Array<{ coordinates: Coordinates; distance: number; [key: string]: any }> {
	return points
		.map((point) => ({
			...point,
			distance: calculateDistance(center, point.coordinates),
		}))
		.filter((point) => point.distance <= maxDistanceKm)
		.sort((a, b) => a.distance - b.distance); // Sort by distance ascending
}

