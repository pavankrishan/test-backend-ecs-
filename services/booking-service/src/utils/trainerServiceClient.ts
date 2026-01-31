/**
 * Trainer Service Client
 * Centralized integration with trainer-service for fetching trainer data
 */

import axios, { AxiosInstance } from 'axios';
import logger from '@kodingcaravan/shared/config/logger';

const TRAINER_SERVICE_URL = process.env.TRAINER_SERVICE_URL || 'http://localhost:3004';

export interface TrainerInfo {
	id: string;
	isActive: boolean;
	franchiseId: string | null;
	zoneId: string | null;
	certifiedCourses: string[];
	location?: {
		latitude: number;
		longitude: number;
	};
}

export interface FetchTrainersFilters {
	franchiseId?: string | null;
	zoneId?: string | null;
	courseId: string;
	isActive?: boolean;
}

export class TrainerServiceClient {
	private axiosInstance: AxiosInstance;

	constructor() {
		this.axiosInstance = axios.create({
			baseURL: TRAINER_SERVICE_URL,
			timeout: 10000,
			headers: {
				'Content-Type': 'application/json',
			},
		});
	}

	/**
	 * Fetch trainers from trainer-service with retry logic
	 */
	async fetchTrainers(filters: FetchTrainersFilters): Promise<TrainerInfo[]> {
		const maxRetries = 3;
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				// Build query parameters
				const params: Record<string, any> = {
					limit: 1000, // Get all trainers
				};

				// Call trainer service API
				const response = await this.axiosInstance.get('/api/v1/trainers', { params });

				// Extract trainers from response
				const trainers = response.data?.data || [];

				// Pre-filter by active status if specified
				const preFilteredTrainers = trainers.filter((trainer: any) => {
					if (filters.isActive !== undefined) {
						// Trainer service uses 'available' field for active status
						return trainer.available === filters.isActive;
					}
					return true;
				});

				// Fetch detailed info for each trainer (location and certifications)
				// TODO: Optimize this by extending trainer-service to include these fields in list endpoint
				const trainerInfos: (TrainerInfo | null)[] = await Promise.all(
					preFilteredTrainers.map(async (trainer: any) => {
						try {
							// Get full trainer overview to get location and certifications
							const overviewResponse = await this.axiosInstance.get(`/api/v1/trainers/${trainer.trainerId}`, {
								timeout: 5000,
							});

							const overview = overviewResponse.data?.data;
							const profile = overview?.profile;
							const location = overview?.location;

							// Map certifications to certifiedCourses
							const certifiedCourses = profile?.certifications || [];

							// Filter by course certification early
							if (filters.courseId && certifiedCourses.length > 0) {
								if (!certifiedCourses.includes(filters.courseId)) {
									return null;
								}
							}

							// Extract franchiseId from trainer data
							// Note: franchiseId may not be available in current trainer-service schema
							// If franchiseId is stored in a different location, update this mapping
							const franchiseId = trainer.franchiseId || overview?.franchiseId || overview?.franchise?.id || null;

							// Build TrainerInfo object
							const trainerInfo: TrainerInfo = {
								id: trainer.trainerId,
								isActive: trainer.available !== false,
								franchiseId,
								zoneId: filters.zoneId || null,
								certifiedCourses: Array.isArray(certifiedCourses) ? certifiedCourses : [],
								...(location ? {
									location: {
										latitude: Number(location.latitude),
										longitude: Number(location.longitude),
									}
								} : {}),
							};

							return trainerInfo;
						} catch (error: any) {
							// Log error but continue with other trainers
							logger.warn('Failed to fetch individual trainer details', {
								trainerId: trainer.trainerId,
								error: error.message,
							});
							return null;
						}
					})
				);

				// Filter out null values
				return trainerInfos.filter((info): info is TrainerInfo => info !== null);
			} catch (error: any) {
				lastError = error;
				const isLastAttempt = attempt === maxRetries;
				
				logger.warn(`Failed to fetch trainers (attempt ${attempt}/${maxRetries})`, {
					error: error.message,
					filters,
					isLastAttempt,
				});

				if (!isLastAttempt) {
					// Exponential backoff: wait 100ms, 200ms, 400ms
					await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
					continue;
				}
			}
		}

		// All retries failed, return empty array (will result in WAITLISTED status)
		logger.error('All retry attempts failed, returning empty array', lastError || new Error('Unknown error'), {
			filters,
		});
		return [];
	}
}

