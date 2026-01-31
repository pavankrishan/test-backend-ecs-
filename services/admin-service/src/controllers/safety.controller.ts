import { Request, Response, NextFunction } from 'express';
import { AppError } from '@kodingcaravan/shared';
import {
	reportSafetyIncident,
	getSafetyIncidentById,
	getMySafetyIncidents,
	getAllSafetyIncidents,
	updateSafetyIncidentStatus,
} from '../services/safety.service';

export async function createIncident(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const { type, description, location, severity, metadata } = req.body || {};
		
		// Get user info from request (set by requireUserAuth middleware)
		const userId = (req as any).userId || req.body.userId;
		const userRole = (req as any).userRole || req.body.userRole || 'student';

		if (!userId) {
			throw new AppError('User ID is required', 400);
		}

		if (!type || !description || !location) {
			throw new AppError('Type, description, and location are required', 400);
		}

		if (!location.latitude || !location.longitude) {
			throw new AppError('Location must include latitude and longitude', 400);
		}

		const incident = await reportSafetyIncident({
			userId,
			userRole: userRole as 'student' | 'trainer' | 'admin',
			type: type as 'emergency' | 'safety' | 'medical' | 'security' | 'other',
			description,
			location: {
				latitude: parseFloat(location.latitude),
				longitude: parseFloat(location.longitude),
				address: location.address,
			},
			severity: (severity || 'medium') as 'low' | 'medium' | 'high' | 'critical',
			metadata: metadata || {},
		});

		res.status(201).json({
			success: true,
			message: 'Safety incident reported successfully',
			data: incident,
		});
	} catch (error) {
		next(error);
	}
}

export async function getIncident(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const { id } = req.params;
		if (!id) {
			throw new AppError('Incident ID is required', 400);
		}

		const incident = await getSafetyIncidentById(id);
		
		res.status(200).json({
			success: true,
			data: incident,
		});
	} catch (error) {
		next(error);
	}
}

export async function getMyIncidents(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		// Get userId from token, query params, or request body
		const userId = (req as any).userId || req.query.userId || req.body.userId;
		if (!userId) {
			throw new AppError('User ID is required', 400);
		}

		const { status, page, limit } = req.query;
		
		const result = await getMySafetyIncidents(userId as string, {
			status: status as string,
			page: page ? parseInt(page as string, 10) : undefined,
			limit: limit ? parseInt(limit as string, 10) : undefined,
		});

		res.status(200).json({
			success: true,
			data: result,
		});
	} catch (error) {
		next(error);
	}
}

export async function getAllIncidents(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const { status, type, severity, userId, userRole, page, limit } = req.query;
		
		const result = await getAllSafetyIncidents({
			status: status as string,
			type: type as string,
			severity: severity as string,
			userId: userId as string,
			userRole: userRole as string,
			page: page ? parseInt(page as string, 10) : undefined,
			limit: limit ? parseInt(limit as string, 10) : undefined,
		});

		res.status(200).json({
			success: true,
			data: result,
		});
	} catch (error) {
		next(error);
	}
}

export async function updateIncident(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const { id } = req.params;
		if (!id) {
			throw new AppError('Incident ID is required', 400);
		}

		const { status, notes } = req.body || {};
		const adminId = (req as any).adminId || (req as any).userId;

		const incident = await updateSafetyIncidentStatus(id, { status, notes }, adminId);

		res.status(200).json({
			success: true,
			message: 'Safety incident updated successfully',
			data: incident,
		});
	} catch (error) {
		next(error);
	}
}

