import { Request, Response, NextFunction } from 'express';
import { AppError } from '@kodingcaravan/shared';
import {
	startLocationTrackingSession,
	stopLocationTrackingSession,
	getActiveTrackingSessionForUser,
	sendLocationUpdateToServer,
	getLiveLocationForUser,
	getMultipleLiveLocationsForUsers,
	getLocationHistoryForUser,
	getLocationHistoryForTutoringSession,
	checkLocationSafety,
} from '../services/locationTracking.service';

export async function createTrackingSession(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const { userId, userRole, metadata } = req.body || {};
		
		// Get user info from request (set by requireUserAuth middleware)
		const finalUserId = (req as any).userId || userId;
		const finalUserRole = (req as any).userRole || userRole || 'student';

		if (!finalUserId) {
			throw new AppError('User ID is required', 400);
		}

		const session = await startLocationTrackingSession({
			userId: finalUserId,
			userRole: finalUserRole as 'student' | 'trainer',
			metadata: metadata || {},
		});

		res.status(201).json({
			success: true,
			message: 'Location tracking session started',
			data: {
				id: session.id,
				userId: session.userId,
				userRole: session.userRole,
				startedAt: session.startedAt.toISOString(),
				endedAt: session.endedAt?.toISOString(),
				isActive: session.isActive,
				totalUpdates: session.totalUpdates,
				metadata: session.metadata,
			},
		});
	} catch (error) {
		next(error);
	}
}

export async function stopTrackingSession(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const { id } = req.params;
		if (!id) {
			throw new AppError('Session ID is required', 400);
		}

		const session = await stopLocationTrackingSession(id);

		res.status(200).json({
			success: true,
			message: 'Location tracking session stopped',
			data: {
				id: session.id,
				userId: session.userId,
				userRole: session.userRole,
				startedAt: session.startedAt.toISOString(),
				endedAt: session.endedAt?.toISOString(),
				isActive: session.isActive,
				totalUpdates: session.totalUpdates,
				metadata: session.metadata,
			},
		});
	} catch (error) {
		next(error);
	}
}

export async function getActiveSession(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const userId = (req as any).userId || req.query.userId;
		if (!userId) {
			throw new AppError('User ID is required', 400);
		}

		const session = await getActiveTrackingSessionForUser(userId as string);

		if (!session) {
			res.status(200).json({
				success: true,
				data: null,
			});
			return;
		}

		res.status(200).json({
			success: true,
			data: {
				id: session.id,
				userId: session.userId,
				userRole: session.userRole,
				startedAt: session.startedAt.toISOString(),
				endedAt: session.endedAt?.toISOString(),
				isActive: session.isActive,
				totalUpdates: session.totalUpdates,
				metadata: session.metadata,
			},
		});
	} catch (error) {
		next(error);
	}
}

export async function createLocationUpdate(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const {
			sessionId,
			userId,
			userRole,
			latitude,
			longitude,
			accuracy,
			altitude,
			heading,
			speed,
			address,
			metadata,
		} = req.body || {};

		const finalUserId = (req as any).userId || userId;
		const finalUserRole = (req as any).userRole || userRole || 'student';

		if (!finalUserId) {
			throw new AppError('User ID is required', 400);
		}

		if (typeof latitude !== 'number' || typeof longitude !== 'number') {
			throw new AppError('Latitude and longitude are required', 400);
		}

		const update = await sendLocationUpdateToServer({
			sessionId,
			userId: finalUserId,
			userRole: finalUserRole as 'student' | 'trainer',
			latitude: parseFloat(latitude as any),
			longitude: parseFloat(longitude as any),
			accuracy: accuracy ? parseFloat(accuracy as any) : undefined,
			altitude: altitude ? parseFloat(altitude as any) : undefined,
			heading: heading ? parseFloat(heading as any) : undefined,
			speed: speed ? parseFloat(speed as any) : undefined,
			address,
			metadata: metadata || {},
		});

		res.status(201).json({
			success: true,
			message: 'Location update recorded',
			data: {
				id: update.id,
				sessionId: update.sessionId,
				userId: update.userId,
				userRole: update.userRole,
				latitude: update.latitude,
				longitude: update.longitude,
				accuracy: update.accuracy,
				altitude: update.altitude,
				heading: update.heading,
				speed: update.speed,
				address: update.address,
				timestamp: update.timestamp.toISOString(),
				isActive: update.isActive,
				metadata: update.metadata,
			},
		});
	} catch (error) {
		next(error);
	}
}

export async function getLiveLocation(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const userId = (req as any).userId || req.query.userId;
		if (!userId) {
			throw new AppError('User ID is required', 400);
		}

		const location = await getLiveLocationForUser(userId as string);

		if (!location) {
			res.status(200).json({
				success: true,
				data: null,
			});
			return;
		}

		res.status(200).json({
			success: true,
			data: {
				id: location.id,
				sessionId: location.sessionId,
				userId: location.userId,
				userRole: location.userRole,
				latitude: location.latitude,
				longitude: location.longitude,
				accuracy: location.accuracy,
				altitude: location.altitude,
				heading: location.heading,
				speed: location.speed,
				address: location.address,
				timestamp: location.timestamp.toISOString(),
				isActive: location.isActive,
				metadata: location.metadata,
			},
		});
	} catch (error) {
		next(error);
	}
}

export async function getMultipleLiveLocations(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const { userIds } = req.body || {};

		if (!Array.isArray(userIds) || userIds.length === 0) {
			throw new AppError('User IDs array is required', 400);
		}

		const locations = await getMultipleLiveLocationsForUsers(userIds);

		res.status(200).json({
			success: true,
			data: locations.map((location) => ({
				id: location.id,
				sessionId: location.sessionId,
				userId: location.userId,
				userRole: location.userRole,
				latitude: location.latitude,
				longitude: location.longitude,
				accuracy: location.accuracy,
				altitude: location.altitude,
				heading: location.heading,
				speed: location.speed,
				address: location.address,
				timestamp: location.timestamp.toISOString(),
				isActive: location.isActive,
				metadata: location.metadata,
			})),
		});
	} catch (error) {
		next(error);
	}
}

export async function getLocationHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const userId = (req as any).userId || req.query.userId;
		const { sessionId, startTime, endTime, page, limit } = req.query;

		const result = await getLocationHistoryForUser({
			userId: userId as string,
			sessionId: sessionId as string,
			startTime: startTime as string,
			endTime: endTime as string,
			page: page ? parseInt(page as string, 10) : undefined,
			limit: limit ? parseInt(limit as string, 10) : undefined,
		});

		res.status(200).json({
			success: true,
			data: {
				updates: result.updates.map((update) => ({
					id: update.id,
					sessionId: update.sessionId,
					userId: update.userId,
					userRole: update.userRole,
					latitude: update.latitude,
					longitude: update.longitude,
					accuracy: update.accuracy,
					altitude: update.altitude,
					heading: update.heading,
					speed: update.speed,
					address: update.address,
					timestamp: update.timestamp.toISOString(),
					isActive: update.isActive,
					metadata: update.metadata,
				})),
				total: result.total,
				page: result.page,
				limit: result.limit,
				totalPages: result.totalPages,
			},
		});
	} catch (error) {
		next(error);
	}
}

export async function getTutoringSessionLocationHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const { tutoringSessionId } = req.params;
		const { startTime, endTime, page, limit } = req.query;

		if (!tutoringSessionId) {
			throw new AppError('Tutoring session ID is required', 400);
		}

		const result = await getLocationHistoryForTutoringSession(tutoringSessionId, {
			startTime: startTime as string,
			endTime: endTime as string,
			page: page ? parseInt(page as string, 10) : undefined,
			limit: limit ? parseInt(limit as string, 10) : undefined,
		});

		res.status(200).json({
			success: true,
			data: {
				updates: result.updates.map((update) => ({
					id: update.id,
					sessionId: update.sessionId,
					userId: update.userId,
					userRole: update.userRole,
					latitude: update.latitude,
					longitude: update.longitude,
					accuracy: update.accuracy,
					altitude: update.altitude,
					heading: update.heading,
					speed: update.speed,
					address: update.address,
					timestamp: update.timestamp.toISOString(),
					isActive: update.isActive,
					metadata: update.metadata,
				})),
				total: result.total,
				page: result.page,
				limit: result.limit,
				totalPages: result.totalPages,
			},
		});
	} catch (error) {
		next(error);
	}
}

export async function checkLocationSafetyForSession(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const { tutoringSessionId } = req.params;
		const { userId, latitude, longitude } = req.body;

		if (!tutoringSessionId) {
			throw new AppError('Tutoring session ID is required', 400);
		}

		if (!userId) {
			throw new AppError('User ID is required', 400);
		}

		if (typeof latitude !== 'number' || typeof longitude !== 'number') {
			throw new AppError('Latitude and longitude are required', 400);
		}

		const result = await checkLocationSafety(
			userId,
			tutoringSessionId,
			{ latitude, longitude }
		);

		res.status(200).json({
			success: true,
			data: {
				safe: result.safe,
				distance: result.distance,
				alert: result.alert,
			},
		});
	} catch (error) {
		next(error);
	}
}
