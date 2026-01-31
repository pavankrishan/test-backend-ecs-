import axios from 'axios';

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3006';

export interface CreateNotificationInput {
	userId: string;
	title: string;
	message: string;
	type: 'info' | 'success' | 'warning' | 'error' | 'session' | 'payment' | 'allocation';
}

export class NotificationClient {
	private baseUrl: string;

	constructor(baseUrl: string = NOTIFICATION_SERVICE_URL) {
		this.baseUrl = baseUrl;
	}

	async createNotification(input: CreateNotificationInput): Promise<void> {
		try {
			await axios.post(`${this.baseUrl}/api/notifications`, {
				userId: input.userId,
				title: input.title,
				message: input.message,
				type: input.type,
			});
		} catch (error: any) {
			console.error('[Notification Client] Failed to send notification:', error.message);
			// Don't throw - notification failure shouldn't break the main flow
		}
	}

	async sendSessionOtpNotification(studentId: string, otp: string, trainerName: string): Promise<void> {
		await this.createNotification({
			userId: studentId,
			title: 'Trainer Arrived - Share OTP',
			message: `Your trainer ${trainerName} has arrived. Share this OTP to start the session: ${otp}`,
			type: 'session',
		});
	}

	async sendSessionConfirmationRequest(studentId: string, sessionId: string): Promise<void> {
		await this.createNotification({
			userId: studentId,
			title: 'Session Completed - Confirm',
			message: 'Your session has been completed. Please confirm if the session was completed successfully.',
			type: 'session',
		});
	}

	async sendAllocationNotification(studentId: string, trainerName: string): Promise<void> {
		await this.createNotification({
			userId: studentId,
			title: 'Trainer Allocated',
			message: `A trainer ${trainerName} has been allocated to you. You will receive session details soon.`,
			type: 'allocation',
		});
	}
}

export const notificationClient = new NotificationClient();

