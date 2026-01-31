/**
 * Input Validation Middleware
 * Validates request inputs using basic validation rules
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export interface ValidationErrorDetail {
	field: string;
	message: string;
}

export class ValidationError extends Error {
	constructor(public errors: ValidationErrorDetail[]) {
		super('Validation failed');
		this.name = 'ValidationError';
	}
}

/**
 * Validate UUID format
 */
export function validateUUID(value: any, fieldName: string): string | null {
	if (typeof value !== 'string') {
		return `${fieldName} must be a string`;
	}
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	if (!uuidRegex.test(value)) {
		return `${fieldName} must be a valid UUID`;
	}
	return null;
}

/**
 * Validate date is not in the past
 */
export function validateFutureDate(value: any, fieldName: string): string | null {
	if (!value) {
		return `${fieldName} is required`;
	}
	const date = new Date(value);
	if (isNaN(date.getTime())) {
		return `${fieldName} must be a valid date`;
	}
	const now = new Date();
	now.setHours(0, 0, 0, 0);
	if (date < now) {
		return `${fieldName} cannot be in the past`;
	}
	return null;
}

/**
 * Validate coordinates (latitude/longitude)
 */
export function validateCoordinates(lat: any, lng: any): string | null {
	if (typeof lat !== 'number' || typeof lng !== 'number') {
		return 'Latitude and longitude must be numbers';
	}
	if (lat < -90 || lat > 90) {
		return 'Latitude must be between -90 and 90';
	}
	if (lng < -180 || lng > 180) {
		return 'Longitude must be between -180 and 180';
	}
	return null;
}

/**
 * Validate enum value
 */
export function validateEnum<T extends string>(
	value: any,
	allowedValues: readonly T[],
	fieldName: string
): string | null {
	if (!allowedValues.includes(value as T)) {
		return `${fieldName} must be one of: ${allowedValues.join(', ')}`;
	}
	return null;
}

/**
 * Auto-assign trainer endpoint validation
 */
export function validateAutoAssignTrainer(req: Request, res: Response, next: NextFunction): void {
	const errors: ValidationErrorDetail[] = [];
	const { bookingId, courseId, classType, deliveryMode, startDate, studentLocation, totalSessions } = req.body;

	// Validate required fields
	if (!bookingId) {
		errors.push({ field: 'bookingId', message: 'bookingId is required' });
	} else {
		const uuidError = validateUUID(bookingId, 'bookingId');
		if (uuidError) errors.push({ field: 'bookingId', message: uuidError });
	}

	if (!courseId) {
		errors.push({ field: 'courseId', message: 'courseId is required' });
	} else {
		const uuidError = validateUUID(courseId, 'courseId');
		if (uuidError) errors.push({ field: 'courseId', message: uuidError });
	}

	if (!classType) {
		errors.push({ field: 'classType', message: 'classType is required' });
	} else {
		// classType can be 'ONE_ON_ONE', 'ONE_ON_TWO', 'ONE_ON_THREE', or 'HYBRID'
		const enumError = validateEnum(classType, ['ONE_ON_ONE', 'ONE_ON_TWO', 'ONE_ON_THREE', 'HYBRID'] as const, 'classType');
		if (enumError) errors.push({ field: 'classType', message: enumError });
	}

	if (!deliveryMode) {
		errors.push({ field: 'deliveryMode', message: 'deliveryMode is required' });
	} else {
		// deliveryMode can be 'WEEKDAY_DAILY' or 'SUNDAY_ONLY'
		const enumError = validateEnum(deliveryMode, ['WEEKDAY_DAILY', 'SUNDAY_ONLY'] as const, 'deliveryMode');
		if (enumError) errors.push({ field: 'deliveryMode', message: enumError });
	}

	if (!startDate) {
		errors.push({ field: 'startDate', message: 'startDate is required' });
	} else {
		const dateError = validateFutureDate(startDate, 'startDate');
		if (dateError) errors.push({ field: 'startDate', message: dateError });
	}

	if (!studentLocation || typeof studentLocation !== 'object') {
		errors.push({ field: 'studentLocation', message: 'studentLocation is required and must be an object' });
	} else {
		const coordError = validateCoordinates(studentLocation.latitude, studentLocation.longitude);
		if (coordError) errors.push({ field: 'studentLocation', message: coordError });
	}

	if (totalSessions !== undefined) {
		if (typeof totalSessions !== 'number' || totalSessions < 1 || totalSessions > 100) {
			errors.push({ field: 'totalSessions', message: 'totalSessions must be a number between 1 and 100' });
		}
	}

	if (errors.length > 0) {
		logger.warn('Validation failed for auto-assign trainer', { errors, body: req.body });
		res.status(400).json({
			success: false,
			message: 'Validation failed',
			errors,
		});
		return;
	}

	next();
}

