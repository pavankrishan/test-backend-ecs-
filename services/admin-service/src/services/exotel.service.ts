import axios from 'axios';
import { getPool } from '../config/database';

interface ExotelCallRequest {
	from: string; // Trainer or student phone number
	to: string; // Student or trainer phone number
	callerId: string; // Exotel virtual number
	customField?: string;
}

interface ExotelCallResponse {
	Call?: {
		Sid: string;
		Status: string;
		From: string;
		To: string;
		Direction: string;
	};
	RestException?: {
		Status: string;
		Message: string;
	};
}

interface ExotelWebhookPayload {
	CallSid: string;
	From: string;
	To: string;
	Direction: string;
	Status: string;
	CallType: string;
	Duration?: string;
	RecordingUrl?: string;
	StartTime?: string;
	EndTime?: string;
}

export class ExotelService {
	private apiKey: string;
	private apiToken: string;
	private subdomain: string;
	private virtualNumber: string;
	private baseUrl: string;

	constructor() {
		this.apiKey = process.env.EXOTEL_API_KEY || '';
		this.apiToken = process.env.EXOTEL_API_TOKEN || '';
		this.subdomain = process.env.EXOTEL_SUBDOMAIN || '';
		this.virtualNumber = process.env.EXOTEL_VIRTUAL_NUMBER || '';
		
		if (!this.subdomain) {
			throw new Error('EXOTEL_SUBDOMAIN is required');
		}
		
		this.baseUrl = `https://${this.apiKey}:${this.apiToken}@api.exotel.com/v1/Accounts/${this.subdomain}`;
	}

	/**
	 * Initiate a call between trainer and student using Exotel Click-to-Call
	 * @param trainerPhone Trainer's phone number
	 * @param studentPhone Student's phone number
	 * @param metadata Additional metadata for the call
	 */
	async initiateCall(
		trainerPhone: string,
		studentPhone: string,
		metadata: {
			trainerId: string;
			studentId: string;
			sessionId?: string;
			callerRole: 'trainer' | 'student';
		}
	): Promise<{ callSid: string; status: string }> {
		try {
			// Determine caller and receiver based on role
			const from = metadata.callerRole === 'trainer' ? trainerPhone : studentPhone;
			const to = metadata.callerRole === 'trainer' ? studentPhone : trainerPhone;

			// Prepare custom field with metadata
			const customField = JSON.stringify({
				trainerId: metadata.trainerId,
				studentId: metadata.studentId,
				sessionId: metadata.sessionId,
				callerRole: metadata.callerRole,
			});

			const requestData: ExotelCallRequest = {
				from: this.normalizePhone(from),
				to: this.normalizePhone(to),
				callerId: this.virtualNumber,
				customField,
			};

			console.log('[Exotel] Initiating call:', {
				from: requestData.from,
				to: requestData.to,
				callerId: requestData.callerId,
			});

			// Exotel API requires form-encoded data
			const formData = new URLSearchParams();
			formData.append('From', requestData.from);
			formData.append('To', requestData.to);
			formData.append('CallerId', requestData.callerId);
			if (requestData.customField) {
				formData.append('CustomField', requestData.customField);
			}

			const response = await axios.post<ExotelCallResponse>(
				`${this.baseUrl}/Calls/connect.json`,
				formData.toString(),
				{
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded',
					},
				}
			);

			if (response.data.RestException) {
				throw new Error(
					`Exotel API Error: ${response.data.RestException.Message}`
				);
			}

			if (!response.data.Call?.Sid) {
				throw new Error('Invalid response from Exotel API');
			}

			const callSid = response.data.Call.Sid;
			const status = response.data.Call.Status;

			// Log call in database
			await this.logCall({
				callSid,
				trainerId: metadata.trainerId,
				studentId: metadata.studentId,
				sessionId: metadata.sessionId,
				trainerPhone: this.normalizePhone(trainerPhone),
				studentPhone: this.normalizePhone(studentPhone),
				callerRole: metadata.callerRole,
				status,
				direction: 'outbound',
			});

			console.log('[Exotel] Call initiated successfully:', { callSid, status });

			return { callSid, status };
		} catch (error: any) {
			console.error('[Exotel] Error initiating call:', error);
			throw new Error(
				error.response?.data?.RestException?.Message ||
				error.message ||
				'Failed to initiate call'
			);
		}
	}

	/**
	 * Handle Exotel webhook events (call status updates)
	 */
	async handleWebhook(payload: ExotelWebhookPayload): Promise<void> {
		try {
			const { CallSid, Status, Duration, RecordingUrl, StartTime, EndTime } = payload;

			console.log('[Exotel] Webhook received:', {
				callSid: CallSid,
				status: Status,
				duration: Duration,
			});

			// Update call log in database
			await this.updateCallLog(CallSid, {
				status: Status,
				duration: Duration ? parseInt(Duration, 10) : null,
				recordingUrl: RecordingUrl || null,
				startTime: StartTime ? new Date(StartTime) : null,
				endTime: EndTime ? new Date(EndTime) : null,
			});
		} catch (error: any) {
			console.error('[Exotel] Error handling webhook:', error);
			throw error;
		}
	}

	/**
	 * Log call in database
	 */
	private async logCall(data: {
		callSid: string;
		trainerId: string;
		studentId: string;
		sessionId?: string | null;
		trainerPhone: string;
		studentPhone: string;
		callerRole: 'trainer' | 'student';
		status: string;
		direction: string;
	}): Promise<void> {
		const pool = getPool();
		try {
			await pool.query(
				`INSERT INTO call_logs (
					call_sid, trainer_id, student_id, session_id,
					trainer_phone, student_phone, caller_role,
					status, direction, created_at
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
				ON CONFLICT (call_sid) DO UPDATE SET
					status = EXCLUDED.status,
					updated_at = NOW()`,
				[
					data.callSid,
					data.trainerId,
					data.studentId,
					data.sessionId || null,
					data.trainerPhone,
					data.studentPhone,
					data.callerRole,
					data.status,
					data.direction,
				]
			);
		} catch (error: any) {
			console.error('[Exotel] Error logging call:', error);
			// Don't throw - call logging failure shouldn't break the call
		}
	}

	/**
	 * Update call log with webhook data
	 */
	private async updateCallLog(
		callSid: string,
		updates: {
			status?: string;
			duration?: number | null;
			recordingUrl?: string | null;
			startTime?: Date | null;
			endTime?: Date | null;
		}
	): Promise<void> {
		const pool = getPool();
		try {
			const updateFields: string[] = [];
			const values: any[] = [];
			let paramIndex = 1;

			if (updates.status !== undefined) {
				updateFields.push(`status = $${paramIndex++}`);
				values.push(updates.status);
			}
			if (updates.duration !== undefined) {
				updateFields.push(`duration = $${paramIndex++}`);
				values.push(updates.duration);
			}
			if (updates.recordingUrl !== undefined) {
				updateFields.push(`recording_url = $${paramIndex++}`);
				values.push(updates.recordingUrl);
			}
			if (updates.startTime !== undefined) {
				updateFields.push(`start_time = $${paramIndex++}`);
				values.push(updates.startTime);
			}
			if (updates.endTime !== undefined) {
				updateFields.push(`end_time = $${paramIndex++}`);
				values.push(updates.endTime);
			}

			if (updateFields.length === 0) {
				return;
			}

			updateFields.push(`updated_at = NOW()`);
			values.push(callSid);

			await pool.query(
				`UPDATE call_logs 
				SET ${updateFields.join(', ')}
				WHERE call_sid = $${paramIndex}`,
				values
			);
		} catch (error: any) {
			console.error('[Exotel] Error updating call log:', error);
			// Don't throw - call update failure shouldn't break the webhook
		}
	}

	/**
	 * Get call history for a trainer-student pair
	 */
	async getCallHistory(
		trainerId: string,
		studentId: string,
		limit: number = 50
	): Promise<any[]> {
		const pool = getPool();
		try {
			const result = await pool.query(
				`SELECT 
					call_sid, trainer_id, student_id, session_id,
					trainer_phone, student_phone, caller_role,
					status, direction, duration, recording_url,
					start_time, end_time, created_at, updated_at
				FROM call_logs
				WHERE trainer_id = $1 AND student_id = $2
				ORDER BY created_at DESC
				LIMIT $3`,
				[trainerId, studentId, limit]
			);
			return result.rows;
		} catch (error: any) {
			console.error('[Exotel] Error fetching call history:', error);
			throw error;
		}
	}

	/**
	 * Normalize phone number (remove spaces, dashes, etc.)
	 */
	private normalizePhone(phone: string): string {
		// Remove all non-digit characters except +
		return phone.replace(/[^\d+]/g, '');
	}
}

// Lazy initialization - only create instance when needed
let exotelServiceInstance: ExotelService | null = null;

export function getExotelService(): ExotelService {
	if (!exotelServiceInstance) {
		// Check if Exotel is configured
		if (!process.env.EXOTEL_SUBDOMAIN) {
			throw new Error(
				'Exotel is not configured. Please set EXOTEL_SUBDOMAIN, EXOTEL_API_KEY, EXOTEL_API_TOKEN, and EXOTEL_VIRTUAL_NUMBER environment variables.'
			);
		}
		exotelServiceInstance = new ExotelService();
	}
	return exotelServiceInstance;
}

// For backward compatibility, export a getter that throws if not configured
export const exotelService = {
	get initiateCall() {
		return getExotelService().initiateCall.bind(getExotelService());
	},
	get handleWebhook() {
		return getExotelService().handleWebhook.bind(getExotelService());
	},
	get getCallHistory() {
		return getExotelService().getCallHistory.bind(getExotelService());
	},
};

