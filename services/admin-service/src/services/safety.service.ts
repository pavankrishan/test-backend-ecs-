import { AppError } from '@kodingcaravan/shared';
import {
	createSafetyIncident,
	findSafetyIncidentById,
	findSafetyIncidentsByUserId,
	findSafetyIncidents,
	updateSafetyIncident,
	type CreateSafetyIncidentInput,
	type UpdateSafetyIncidentInput,
	type SafetyIncidentRecord,
} from '../models/safetyIncident.model';

export async function reportSafetyIncident(input: CreateSafetyIncidentInput): Promise<SafetyIncidentRecord> {
	if (!input.userId) {
		throw new AppError('User ID is required', 400);
	}

	if (!input.description || input.description.trim().length === 0) {
		throw new AppError('Description is required', 400);
	}

	if (!input.location || !input.location.latitude || !input.location.longitude) {
		throw new AppError('Location with latitude and longitude is required', 400);
	}

	const incident = await createSafetyIncident(input);
	return incident;
}

export async function getSafetyIncidentById(id: string): Promise<SafetyIncidentRecord> {
	const incident = await findSafetyIncidentById(id);
	if (!incident) {
		throw new AppError('Safety incident not found', 404);
	}
	return incident;
}

export async function getMySafetyIncidents(
	userId: string,
	options?: {
		status?: string;
		page?: number;
		limit?: number;
	}
): Promise<{
	incidents: SafetyIncidentRecord[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}> {
	return findSafetyIncidentsByUserId(userId, {
		status: options?.status as any,
		page: options?.page,
		limit: options?.limit,
	});
}

export async function getAllSafetyIncidents(options?: {
	status?: string;
	type?: string;
	severity?: string;
	userId?: string;
	userRole?: string;
	page?: number;
	limit?: number;
}): Promise<{
	incidents: SafetyIncidentRecord[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}> {
	return findSafetyIncidents({
		status: options?.status as any,
		type: options?.type as any,
		severity: options?.severity as any,
		userId: options?.userId,
		userRole: options?.userRole as any,
		page: options?.page,
		limit: options?.limit,
	});
}

export async function updateSafetyIncidentStatus(
	id: string,
	input: UpdateSafetyIncidentInput,
	adminId?: string
): Promise<SafetyIncidentRecord> {
	const incident = await findSafetyIncidentById(id);
	if (!incident) {
		throw new AppError('Safety incident not found', 404);
	}

	const updateInput: UpdateSafetyIncidentInput = { ...input };
	if (input.status && adminId) {
		updateInput.resolvedBy = adminId;
	}

	const updated = await updateSafetyIncident(id, updateInput);
	if (!updated) {
		throw new AppError('Failed to update safety incident', 500);
	}

	return updated;
}

