import { AppError } from '../../config/errorHandler';
import { httpGet } from '../../utils/httpClient';
import logger from '../../config/logger';

export interface GeocodeResult {
	latitude: number;
	longitude: number;
	address: string;
	confidence?: number;
	source: 'google' | 'openstreetmap' | 'fallback';
}

export interface GeocodeOptions {
	/**
	 * Geocoding service to use
	 * @default 'google'
	 */
	provider?: 'google' | 'openstreetmap' | 'fallback';

	/**
	 * Country code to bias results (ISO 3166-1 alpha-2)
	 * @default 'IN' for India
	 */
	countryBias?: string;

	/**
	 * Language for results
	 * @default 'en'
	 */
	language?: string;

	/**
	 * Timeout in milliseconds
	 * @default 10000
	 */
	timeout?: number;

	/**
	 * Maximum number of retries
	 * @default 2
	 */
	maxRetries?: number;
}

export class GeocodingService {
	private static instance: GeocodingService;

	public static getInstance(): GeocodingService {
		if (!GeocodingService.instance) {
			GeocodingService.instance = new GeocodingService();
		}
		return GeocodingService.instance;
	}

	/**
	 * Geocode an address to latitude/longitude coordinates
	 */
	async geocodeAddress(
		address: string,
		options: GeocodeOptions = {},
		triedProviders: Set<string> = new Set()
	): Promise<GeocodeResult> {
		const {
			provider = 'google',
			countryBias = 'IN',
			language = 'en',
			timeout = 10000,
			maxRetries = 2,
		} = options;

		if (!address || typeof address !== 'string' || address.trim().length === 0) {
			throw new AppError('Address is required for geocoding', 400);
		}

		const cleanAddress = address.trim();

		// Prevent infinite recursion - if we've tried this provider, skip it
		if (triedProviders.has(provider)) {
			// All providers have been tried, use fallback immediately
			logger.debug('Provider already tried, using fallback', {
				provider,
				address: cleanAddress,
				service: 'geocoding-service',
			});
			return await this.geocodeWithFallback(cleanAddress);
		}

		// Check if all providers have been exhausted
		const allProviders = ['google', 'openstreetmap', 'fallback'];
		if (triedProviders.size >= allProviders.length - 1) {
			// All providers tried, use fallback
			logger.debug('All providers exhausted, using fallback', {
				triedProvidersCount: triedProviders.size,
				address: cleanAddress,
				service: 'geocoding-service',
			});
			return await this.geocodeWithFallback(cleanAddress);
		}

		// Mark this provider as tried
		const updatedTriedProviders = new Set(triedProviders);
		updatedTriedProviders.add(provider);

		// Try primary provider first
		try {
			switch (provider) {
				case 'google':
					return await this.geocodeWithGoogle(cleanAddress, { countryBias, language, timeout });
				case 'openstreetmap':
					return await this.geocodeWithOpenStreetMap(cleanAddress, { language, timeout });
				case 'fallback':
					return await this.geocodeWithFallback(cleanAddress);
				default:
					throw new AppError(`Unsupported geocoding provider: ${provider}`, 400);
			}
		} catch (error) {
			logger.warn('Primary geocoding provider failed', {
				provider,
				address: cleanAddress,
				error: error instanceof Error ? error.message : String(error),
				service: 'geocoding-service',
			});

			// Try fallback providers if primary fails (only if not already tried)
			const fallbackProviders = this.getFallbackProviders(provider);
			const untriedProviders = fallbackProviders.filter(p => !updatedTriedProviders.has(p));

			for (const fallbackProvider of untriedProviders) {
				try {
					logger.debug('Trying fallback geocoding provider', {
						fallbackProvider,
						address: cleanAddress,
						service: 'geocoding-service',
					});
					return await this.geocodeAddress(cleanAddress, { ...options, provider: fallbackProvider }, updatedTriedProviders);
				} catch (fallbackError) {
					logger.warn('Fallback geocoding provider also failed', {
						fallbackProvider,
						address: cleanAddress,
						error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
						service: 'geocoding-service',
					});
					updatedTriedProviders.add(fallbackProvider);
				}
			}

			// All providers failed, use fallback
			logger.info('All geocoding providers failed, using fallback', {
				address: cleanAddress,
				service: 'geocoding-service',
			});
			return await this.geocodeWithFallback(cleanAddress);
		}
	}

	/**
	 * Geocode using Google Maps API
	 */
	private async geocodeWithGoogle(
		address: string,
		options: { countryBias: string; language: string; timeout: number }
	): Promise<GeocodeResult> {
		const apiKey = process.env.GOOGLE_MAPS_API_KEY;

		if (!apiKey) {
			throw new AppError('Google Maps API key not configured', 500);
		}

		const encodedAddress = encodeURIComponent(address);
		const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${apiKey}&language=${options.language}&components=country:${options.countryBias}`;

		try {
			const response = await httpGet(url, { timeout: options.timeout });

			if (response.statusCode !== 200) {
				throw new AppError(`Google Maps API returned status ${response.statusCode}`, 502);
			}

			const data = JSON.parse(response.data);

			if (data.status !== 'OK' || !data.results || data.results.length === 0) {
				throw new AppError(`Google Maps geocoding failed: ${data.status}`, 502);
			}

			const result = data.results[0];
			const location = result.geometry.location;

			return {
				latitude: location.lat,
				longitude: location.lng,
				address: result.formatted_address,
				confidence: this.calculateGoogleConfidence(result),
				source: 'google',
			};
		} catch (error) {
			if (error instanceof AppError) {
				throw error;
			}
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			throw new AppError(`Google Maps geocoding request failed: ${errorMessage}`, 502);
		}
	}

	/**
	 * Geocode using OpenStreetMap Nominatim API (free alternative)
	 */
	private async geocodeWithOpenStreetMap(
		address: string,
		options: { language: string; timeout: number }
	): Promise<GeocodeResult> {
		const encodedAddress = encodeURIComponent(address);
		const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}&limit=1&addressdetails=1&accept-language=${options.language}`;

		try {
			const response = await httpGet(url, {
				timeout: options.timeout,
				headers: {
					'User-Agent': 'KodingCaravan/1.0 (contact@kodingcaravan.com)',
				}
			});

			if (response.statusCode !== 200) {
				throw new AppError(`OpenStreetMap API returned status ${response.statusCode}`, 502);
			}

			const data = JSON.parse(response.data);

			if (!Array.isArray(data) || data.length === 0) {
				throw new AppError('OpenStreetMap geocoding returned no results', 502);
			}

			const result = data[0];

			return {
				latitude: parseFloat(result.lat),
				longitude: parseFloat(result.lon),
				address: result.display_name,
				confidence: this.calculateOSMConfidence(result),
				source: 'openstreetmap',
			};
		} catch (error) {
			if (error instanceof AppError) {
				throw error;
			}
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			throw new AppError(`OpenStreetMap geocoding request failed: ${errorMessage}`, 502);
		}
	}

	/**
	 * Fallback geocoding for Indian addresses (hardcoded coordinates)
	 * This is a last resort when all APIs fail
	 */
	private async geocodeWithFallback(address: string): Promise<GeocodeResult> {
		// Extract city/state information from address for basic geocoding
		const lowerAddress = address.toLowerCase();

		// Indian cities with approximate coordinates
		const cityCoordinates: Record<string, { lat: number; lng: number }> = {
			'mumbai': { lat: 19.0760, lng: 72.8777 },
			'delhi': { lat: 28.7041, lng: 77.1025 },
			'bangalore': { lat: 12.9716, lng: 77.5946 },
			'chennai': { lat: 13.0827, lng: 80.2707 },
			'kolkata': { lat: 22.5726, lng: 88.3639 },
			'hyderabad': { lat: 17.3850, lng: 78.4867 },
			'pune': { lat: 18.5204, lng: 73.8567 },
			'ahmedabad': { lat: 23.0225, lng: 72.5714 },
			'jaipur': { lat: 26.9124, lng: 75.7873 },
			'surat': { lat: 21.1702, lng: 72.8311 },
			'chandigarh': { lat: 30.7333, lng: 76.7794 },
			'guntur': { lat: 16.3067, lng: 80.4365 },
			'andhra pradesh': { lat: 15.9129, lng: 79.7400 },
			'telangana': { lat: 18.1124, lng: 79.0193 },
			'karnataka': { lat: 15.3173, lng: 75.7139 },
			'tamil nadu': { lat: 11.1271, lng: 78.6569 },
			'maharashtra': { lat: 19.7515, lng: 75.7139 },
			'gujarat': { lat: 22.2587, lng: 71.1924 },
			'rajasthan': { lat: 27.0238, lng: 74.2179 },
			'uttar pradesh': { lat: 26.8467, lng: 80.9462 },
		};

		// Try to match city/state from address
		for (const [city, coords] of Object.entries(cityCoordinates)) {
			if (lowerAddress.includes(city)) {
				logger.debug('Using fallback coordinates for city', {
					city,
					coordinates: coords,
					address,
					service: 'geocoding-service',
				});
				return {
					latitude: coords.lat,
					longitude: coords.lng,
					address: address,
					confidence: 0.1, // Very low confidence
					source: 'fallback',
				};
			}
		}

		// Default to center of India if no match
		logger.debug('Using default India coordinates for unknown address', {
			address,
			service: 'geocoding-service',
		});
		return {
			latitude: 20.5937, // Center of India
			longitude: 78.9629,
			address: address,
			confidence: 0.05, // Minimal confidence
			source: 'fallback',
		};
	}

	/**
	 * Calculate confidence score for Google Maps result
	 */
	private calculateGoogleConfidence(result: any): number {
		// Google doesn't provide explicit confidence, so we use location type and geometry bounds
		const locationType = result.geometry?.location_type;
		const hasBounds = result.geometry?.bounds;

		let confidence = 0.5; // Base confidence

		switch (locationType) {
			case 'ROOFTOP':
				confidence = 0.95; // Exact address match
				break;
			case 'RANGE_INTERPOLATED':
				confidence = 0.85; // Interpolated between ranges
				break;
			case 'GEOMETRIC_CENTER':
				confidence = 0.75; // Center of area
				break;
			case 'APPROXIMATE':
				confidence = 0.6; // Approximate location
				break;
		}

		// Boost confidence if bounds are provided (more precise)
		if (hasBounds) {
			confidence += 0.1;
		}

		return Math.min(confidence, 1.0);
	}

	/**
	 * Calculate confidence score for OpenStreetMap result
	 */
	private calculateOSMConfidence(result: any): number {
		// OSM provides importance score which we can use as confidence
		const importance = parseFloat(result.importance || '0');
		const placeRank = parseInt(result.place_rank || '30');

		// Convert importance to confidence (importance ranges from ~0.01 to ~0.9)
		let confidence = Math.min(importance * 2, 0.9);

		// Adjust based on place rank (lower rank = more specific)
		if (placeRank <= 10) {
			confidence = Math.max(confidence, 0.8); // Very specific places
		} else if (placeRank <= 20) {
			confidence = Math.max(confidence, 0.6); // Specific addresses/landmarks
		} else if (placeRank <= 25) {
			confidence = Math.max(confidence, 0.4); // Neighborhoods/streets
		}

		return Math.min(confidence, 1.0);
	}

	/**
	 * Get fallback providers in order of preference
	 */
	private getFallbackProviders(primaryProvider: string): ('google' | 'openstreetmap' | 'fallback')[] {
		const allProviders: ('google' | 'openstreetmap' | 'fallback')[] = ['google', 'openstreetmap', 'fallback'];

		// Return providers except the one that failed
		return allProviders.filter(provider => provider !== primaryProvider);
	}

	/**
	 * Validate coordinates
	 */
	static validateCoordinates(latitude: number, longitude: number): boolean {
		return (
			typeof latitude === 'number' &&
			typeof longitude === 'number' &&
			!isNaN(latitude) &&
			!isNaN(longitude) &&
			latitude >= -90 &&
			latitude <= 90 &&
			longitude >= -180 &&
			longitude <= 180
		);
	}

	/**
	 * Calculate distance between two coordinates using Haversine formula
	 */
	static calculateDistance(
		lat1: number,
		lon1: number,
		lat2: number,
		lon2: number
	): number {
		const R = 6371; // Earth's radius in kilometers
		const dLat = this.toRadians(lat2 - lat1);
		const dLon = this.toRadians(lon2 - lon1);
		const a =
			Math.sin(dLat / 2) * Math.sin(dLat / 2) +
			Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
			Math.sin(dLon / 2) * Math.sin(dLon / 2);
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
		return R * c;
	}

	private static toRadians(degrees: number): number {
		return degrees * (Math.PI / 180);
	}
}

// Export singleton instance
export const geocodingService = GeocodingService.getInstance();
