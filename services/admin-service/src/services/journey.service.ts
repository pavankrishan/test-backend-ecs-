/**
 * Journey Service - Tracking bound to journeyId only.
 * - One journey per session, bound to exactly one trainer
 * - Redis: live:journey:{journeyId} TTL 120s, sequence validation
 * - No DB reads on location hot path
 * - Trainer replacement revokes tracking (journey ended)
 */

import { AppError } from '@kodingcaravan/shared';
import { getRedisClient } from '@kodingcaravan/shared';
import {
	redisGetWithTimeout,
	redisSetexWithTimeout,
	redisDelWithTimeout,
} from '@kodingcaravan/shared/utils/redisWithTimeout';
import { getPool } from '../config/database';
import { SessionRepository } from '../models/session.model';
import { JourneyRepository } from '../models/journey.model';
import {
	publishTrainerJourneyStarted,
	publishTrainerJourneyEnded,
} from '@kodingcaravan/shared/utils/eventBridgeClient';
import logger from '@kodingcaravan/shared/config/logger';

const LIVE_JOURNEY_TTL_SEC = 120;
const LIVE_JOURNEY_PREFIX = 'live:journey:';

export interface StartJourneyInput {
	sessionId: string;
	trainerId: string;
}

export interface UpdateLocationInput {
	journeyId: string;
	trainerId: string;
	sequence: number;
	latitude: number;
	longitude: number;
	accuracy?: number;
	speed?: number;
	heading?: number;
}

export interface LiveLocationResponse {
	journeyId: string;
	sessionId: string;
	trainerId: string;
	location: {
		latitude: number;
		longitude: number;
		accuracy?: number;
		speed?: number;
		heading?: number;
		timestamp: string;
		sequence: number;
	} | null;
	isActive: boolean;
	lastUpdate: string | null;
}

interface LiveJourneyRedisValue {
	journeyId: string;
	sessionId: string;
	trainerId: string;
	studentId: string;
	sequence: number;
	location?: {
		latitude: number;
		longitude: number;
		accuracy?: number;
		speed?: number;
		heading?: number;
		timestamp: string;
	};
	startedAt: string;
}

export class JourneyService {
	private pool = getPool();
	private sessionRepo = new SessionRepository(this.pool);
	private journeyRepo = new JourneyRepository(this.pool);

	/**
	 * Start journey: create journey row, set Redis key (TTL 120s), return journeyId.
	 * DB read only on start (not on hot path).
	 */
	async startJourney(input: StartJourneyInput): Promise<{
		journeyId: string;
		sessionId: string;
		trainerId: string;
		studentId: string;
		startedAt: string;
	}> {
		const { sessionId, trainerId } = input;

		const session = await this.sessionRepo.findById(sessionId);
		if (!session) throw new AppError('Session not found', 404);
		if (session.trainerId !== trainerId) throw new AppError('Trainer does not own this session', 403);
		if (session.status !== 'scheduled') {
			throw new AppError(`Cannot start journey for session with status: ${session.status}`, 400);
		}

		// Only one active journey per session (substitute creates new journey via new session assignment)
		const existingActive = await this.journeyRepo.getActiveBySessionId(sessionId);
		if (existingActive) {
			throw new AppError('An active journey already exists for this session', 409);
		}

		const journey = await this.journeyRepo.create({
			sessionId,
			trainerId,
			studentId: session.studentId,
		});

		const updated = await this.journeyRepo.setActive(journey.id);
		if (!updated) throw new AppError('Failed to activate journey', 500);

		const liveKey = `${LIVE_JOURNEY_PREFIX}${journey.id}`;
		const liveValue: LiveJourneyRedisValue = {
			journeyId: journey.id,
			sessionId,
			trainerId,
			studentId: session.studentId,
			sequence: 0,
			startedAt: new Date().toISOString(),
		};

		try {
			const ok = await redisSetexWithTimeout(
				liveKey,
				LIVE_JOURNEY_TTL_SEC,
				JSON.stringify(liveValue)
			);
			if (!ok) {
				logger.warn('Redis set failed for journey start; journey still created', {
					journeyId: journey.id,
					service: 'admin-service',
				});
			}
		} catch (e) {
			logger.error('Redis unavailable during journey start', {
				journeyId: journey.id,
				error: e instanceof Error ? e.message : String(e),
				service: 'admin-service',
			});
			throw new AppError('Service temporarily unavailable. Please try again.', 503);
		}

		await publishTrainerJourneyStarted({
			trainerId,
			studentId: session.studentId,
			sessionId,
			startTime: liveValue.startedAt,
		}).catch(() => {});

		logger.info('Journey started', {
			service: 'admin-service',
			journeyId: journey.id,
			sessionId,
			trainerId,
			studentId: session.studentId,
		});

		return {
			journeyId: journey.id,
			sessionId,
			trainerId,
			studentId: session.studentId,
			startedAt: liveValue.startedAt,
		};
	}

	/**
	 * Update location - hot path: Redis only, no DB. Validate trainer ownership and sequence.
	 */
	async updateLocation(input: UpdateLocationInput): Promise<{
		journeyId: string;
		timestamp: string;
		sequence: number;
		ttl: number;
	}> {
		const { journeyId, trainerId, sequence, latitude, longitude, accuracy, speed, heading } = input;

		if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
			throw new AppError('Invalid coordinates', 400);
		}

		const liveKey = `${LIVE_JOURNEY_PREFIX}${journeyId}`;
		const raw = await redisGetWithTimeout(liveKey);
		if (!raw) {
			throw new AppError('Journey not active or expired', 410);
		}

		let data: LiveJourneyRedisValue;
		try {
			data = JSON.parse(raw) as LiveJourneyRedisValue;
		} catch {
			throw new AppError('Journey not active', 410);
		}

		if (data.trainerId !== trainerId) {
			throw new AppError('Trainer does not own this journey', 403);
		}

		if (sequence <= data.sequence) {
			throw new AppError('Stale sequence; rejected', 409);
		}

		// Anti-spoof: speed check if we have previous location
		if (data.location) {
			const dist = this.haversineMeters(
				data.location.latitude,
				data.location.longitude,
				latitude,
				longitude
			);
			const tsPrev = new Date(data.location.timestamp).getTime();
			const tsNow = Date.now();
			const sec = (tsNow - tsPrev) / 1000;
			if (sec > 0) {
				const speedKmh = (dist / 1000) / (sec / 3600);
				if (speedKmh > 120) throw new AppError('Suspicious location (speed too high)', 400);
			}
		}

		const timestamp = new Date().toISOString();
		const updated: LiveJourneyRedisValue = {
			...data,
			sequence,
			location: {
				latitude,
				longitude,
				accuracy,
				speed,
				heading,
				timestamp,
			},
		};

		const ok = await redisSetexWithTimeout(
			liveKey,
			LIVE_JOURNEY_TTL_SEC,
			JSON.stringify(updated)
		);
		if (!ok) {
			logger.warn('Redis set failed for location update', { journeyId, service: 'admin-service' });
			throw new AppError('Service temporarily unavailable.', 503);
		}

		// Publish for WebSocket delivery (student subscribers)
		try {
			getRedisClient().publish(
				'journey:updates',
				JSON.stringify({
					journeyId,
					location: updated.location,
					sequence,
					timestamp,
				})
			);
		} catch (_) {}

		return {
			journeyId,
			timestamp,
			sequence,
			ttl: LIVE_JOURNEY_TTL_SEC,
		};
	}

	/**
	 * Get live location for student (e.g. WebSocket server or single GET).
	 * No DB read: Redis only.
	 */
	async getLiveLocation(journeyId: string, studentId: string): Promise<LiveLocationResponse | null> {
		const liveKey = `${LIVE_JOURNEY_PREFIX}${journeyId}`;
		const raw = await redisGetWithTimeout(liveKey);
		if (!raw) {
			return {
				journeyId,
				sessionId: '',
				trainerId: '',
				location: null,
				isActive: false,
				lastUpdate: null,
			};
		}

		let data: LiveJourneyRedisValue;
		try {
			data = JSON.parse(raw) as LiveJourneyRedisValue;
		} catch {
			return {
				journeyId,
				sessionId: '',
				trainerId: '',
				location: null,
				isActive: false,
				lastUpdate: null,
			};
		}

		if (data.studentId !== studentId) {
			return null; // caller should treat as 403
		}

		return {
			journeyId: data.journeyId,
			sessionId: data.sessionId,
			trainerId: data.trainerId,
			location: data.location
				? {
						...data.location,
						sequence: data.sequence,
					}
				: null,
			isActive: true,
			lastUpdate: data.location?.timestamp ?? null,
		};
	}

	/**
	 * End journey: update DB, delete Redis key. Caller should notify WebSocket and close subscriptions.
	 */
	async endJourney(
		journeyId: string,
		trainerId: string,
		reason: 'arrived' | 'cancelled' = 'cancelled'
	): Promise<{ journeyId: string; endedAt: string }> {
		const journey = await this.journeyRepo.findById(journeyId);
		if (!journey) throw new AppError('Journey not found', 404);
		if (journey.trainerId !== trainerId) throw new AppError('Trainer does not own this journey', 403);
		if (journey.status !== 'active' && journey.status !== 'created') {
			throw new AppError('Journey already ended', 410);
		}

		await this.journeyRepo.setEnded(journeyId, reason);
		const liveKey = `${LIVE_JOURNEY_PREFIX}${journeyId}`;
		await redisDelWithTimeout(liveKey);

		const endedAt = new Date().toISOString();
		try {
			getRedisClient().publish('journey:ended', JSON.stringify({ journeyId, endedAt }));
		} catch (_) {}

		await publishTrainerJourneyEnded({
			trainerId: journey.trainerId,
			studentId: journey.studentId,
			sessionId: journey.sessionId,
			endTime: endedAt,
			reason,
		}).catch(() => {});

		logger.info('Journey ended', {
			service: 'admin-service',
			journeyId,
			trainerId,
			reason,
		});

		return { journeyId, endedAt };
	}

	/**
	 * Mark arrived: validate distance then end journey with reason 'arrived'.
	 * Requires last location in Redis (no DB for student location - use session cache or one-off read).
	 */
	async markArrived(
		journeyId: string,
		trainerId: string,
		studentLat: number,
		studentLng: number,
		maxDistanceMeters: number = 150
	): Promise<{ journeyId: string; arrivedAt: string; distance: number }> {
		const liveKey = `${LIVE_JOURNEY_PREFIX}${journeyId}`;
		const raw = await redisGetWithTimeout(liveKey);
		if (!raw) throw new AppError('Journey not active', 410);

		const data = JSON.parse(raw) as LiveJourneyRedisValue;
		if (data.trainerId !== trainerId) throw new AppError('Trainer does not own this journey', 403);
		if (!data.location) throw new AppError('No location data', 400);

		const distance = this.haversineMeters(
			data.location.latitude,
			data.location.longitude,
			studentLat,
			studentLng
		);
		if (distance > maxDistanceMeters) {
			throw new AppError(
				`Trainer is ${Math.round(distance)}m away. Must be within ${maxDistanceMeters}m.`,
				400
			);
		}

		const { endedAt } = await this.endJourney(journeyId, trainerId, 'arrived');
		return { journeyId, arrivedAt: endedAt, distance: Math.round(distance) };
	}

	/**
	 * Validate student can subscribe to journey (journey exists and student owns session).
	 * Used by WebSocket subscribe - one-time DB check.
	 */
	async validateStudentJourneyAccess(journeyId: string, studentId: string): Promise<boolean> {
		const journey = await this.journeyRepo.findById(journeyId);
		if (!journey) return false;
		if (journey.studentId !== studentId) return false;
		if (journey.status !== 'active' && journey.status !== 'created') return false;
		return true;
	}

	private haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
		const R = 6371000;
		const dLat = ((lat2 - lat1) * Math.PI) / 180;
		const dLon = ((lon2 - lon1) * Math.PI) / 180;
		const a =
			Math.sin(dLat / 2) ** 2 +
			Math.cos((lat1 * Math.PI) / 180) *
				Math.cos((lat2 * Math.PI) / 180) *
				Math.sin(dLon / 2) ** 2;
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
		return R * c;
	}
}
