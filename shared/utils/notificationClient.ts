import axios from 'axios';
import logger from '../config/logger';

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3006';

export interface CreateNotificationInput {
	userId: string;
	title: string;
	message: string;
	type: 'info' | 'success' | 'warning' | 'error' | 'session' | 'payment' | 'allocation' | 'system';
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
			}, {
				timeout: 5000, // 5 seconds - non-critical operation
			});
			logger.info('Notification sent to user', {
				userId: input.userId,
				title: input.title,
				service: 'notification-client',
			});
		} catch (error: any) {
			logger.error('Failed to send notification', {
				error: error?.message || String(error),
				userId: input.userId,
				service: 'notification-client',
			});
			// Don't throw - notification failure shouldn't break the main flow
		}
	}

	/**
	 * Send notification when course is purchased
	 */
	async sendCoursePurchaseNotification(studentId: string, courseName: string, amount: number): Promise<void> {
		await this.createNotification({
			userId: studentId,
			title: 'Course Purchased Successfully! 🎉',
			message: `Congratulations! You have successfully purchased "${courseName}". Your course is now available in your learning section.`,
			type: 'payment',
		});
	}

	/**
	 * Send notification when trainer is assigned to student
	 */
	async sendTrainerAssignmentNotification(studentId: string, trainerName: string, courseName?: string): Promise<void> {
		const message = courseName
			? `Great news! Trainer ${trainerName} has been assigned to your course "${courseName}". You will receive session details soon.`
			: `Great news! Trainer ${trainerName} has been assigned to you. You will receive session details soon.`;

		await this.createNotification({
			userId: studentId,
			title: 'Trainer Assigned',
			message,
			type: 'allocation',
		});
	}

	/**
	 * Send notification to trainer when they are assigned
	 */
	async sendTrainerAssignedNotification(trainerId: string, studentName: string, courseName?: string): Promise<void> {
		const message = courseName
			? `You have been assigned to teach "${courseName}" for student ${studentName}. Check your schedule for session details.`
			: `You have been assigned to teach student ${studentName}. Check your schedule for session details.`;

		await this.createNotification({
			userId: trainerId,
			title: 'New Assignment',
			message,
			type: 'allocation',
		});
	}

	/**
	 * Send notification when trainer application is submitted
	 */
	async sendApplicationSubmittedNotification(trainerId: string): Promise<void> {
		await this.createNotification({
			userId: trainerId,
			title: 'Application Submitted',
			message: 'Your trainer application has been submitted successfully! Our team will review it and get back to you soon.',
			type: 'system',
		});
	}

	/**
	 * Send notification when trainer application is approved
	 */
	async sendApplicationApprovedNotification(trainerId: string): Promise<void> {
		await this.createNotification({
			userId: trainerId,
			title: 'Application Approved! 🎉',
			message: 'Congratulations! Your trainer application has been approved. You can now start teaching and accept students.',
			type: 'success',
		});
	}

	/**
	 * Send notification when trainer application is rejected
	 */
	async sendApplicationRejectedNotification(trainerId: string, reason?: string): Promise<void> {
		const message = reason
			? `Your trainer application has been reviewed. Unfortunately, it was not approved at this time. Reason: ${reason}. You can reapply with updated information.`
			: 'Your trainer application has been reviewed. Unfortunately, it was not approved at this time. You can reapply with updated information.';

		await this.createNotification({
			userId: trainerId,
			title: 'Application Status Update',
			message,
			type: 'warning',
		});
	}

	/**
	 * Send notification when course is completed
	 */
	async sendCourseCompletionNotification(studentId: string, courseName: string): Promise<void> {
		await this.createNotification({
			userId: studentId,
			title: 'Course Completed! 🎓🎉',
			message: `Congratulations! You have successfully completed "${courseName}". Great job on your learning journey!`,
			type: 'success',
		});
	}

	/**
	 * Send notification when session is scheduled
	 */
	async sendSessionScheduledNotification(
		studentId: string,
		trainerName: string,
		scheduledDate: Date,
		scheduledTime: string
	): Promise<void> {
		const dateStr = scheduledDate.toLocaleDateString('en-US', {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric',
		});

		await this.createNotification({
			userId: studentId,
			title: 'Session Scheduled',
			message: `Your session with ${trainerName} has been scheduled for ${dateStr} at ${scheduledTime}. Please be ready!`,
			type: 'session',
		});
	}

	/**
	 * Send notification to trainer when session is scheduled
	 */
	async sendTrainerSessionScheduledNotification(
		trainerId: string,
		studentName: string,
		scheduledDate: Date,
		scheduledTime: string
	): Promise<void> {
		const dateStr = scheduledDate.toLocaleDateString('en-US', {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric',
		});

		await this.createNotification({
			userId: trainerId,
			title: 'New Session Scheduled',
			message: `You have a session scheduled with ${studentName} on ${dateStr} at ${scheduledTime}.`,
			type: 'session',
		});
	}

	/**
	 * Send notification to trainer when they reach 6 allocations
	 * Asks if they want more allocations (up to their max based on rating)
	 */
	async sendTrainerAllocationCapacityNotification(
		trainerId: string,
		currentAllocations: number,
		maxAllocations: number,
		rating: number | string
	): Promise<void> {
		// Ensure rating is a number before calling toFixed()
		const ratingNum = typeof rating === 'number' ? rating : parseFloat(String(rating)) || 0;
		const formattedRating = ratingNum.toFixed(1);
		
		const message = maxAllocations > 6
			? `You currently have ${currentAllocations} student allocations. Based on your rating (${formattedRating}), you can accept up to ${maxAllocations} allocations. Would you like to receive more student assignments? Open the app to respond.`
			: `You currently have ${currentAllocations} student allocations, which is your maximum capacity based on your rating (${formattedRating}).`;

		await this.createNotification({
			userId: trainerId,
			title: 'Allocation Capacity Reached',
			message,
			type: 'allocation',
		});
	}

	/**
	 * Send SMS notification
	 */
	async sendSms(phone: string, message: string, templateId?: string): Promise<void> {
		try {
			await axios.post(`${this.baseUrl}/api/notifications/sms`, {
				phone,
				message,
				templateId,
			}, {
				timeout: 5000, // 5 seconds - non-critical operation
			});
			logger.info('SMS sent', {
				phone,
				service: 'notification-client',
			});
		} catch (error: any) {
			logger.error('Failed to send SMS', {
				error: error?.message || String(error),
				phone,
				service: 'notification-client',
			});
			// Don't throw - SMS failure shouldn't break the main flow
		}
	}

	/**
	 * Send OTP SMS
	 */
	async sendOtpSms(phone: string, otpCode: string, customMessage?: string): Promise<void> {
		try {
			await axios.post(`${this.baseUrl}/api/notifications/sms/otp`, {
				phone,
				otpCode,
				message: customMessage,
			}, {
				timeout: 5000, // 5 seconds - non-critical operation
			});
			logger.info('OTP SMS sent', {
				phone,
				service: 'notification-client',
			});
		} catch (error: any) {
			logger.error('Failed to send OTP SMS', {
				error: error?.message || String(error),
				phone,
				service: 'notification-client',
			});
			// Don't throw - SMS failure shouldn't break the main flow
		}
	}

	/**
	 * Send bulk SMS
	 */
	async sendBulkSms(recipients: Array<{ phone: string; message: string }>): Promise<void> {
		try {
			await axios.post(`${this.baseUrl}/api/notifications/sms/bulk`, {
				recipients,
			}, {
				timeout: 10000, // 10 seconds - bulk operation may take longer
			});
			logger.info('Bulk SMS sent', {
				recipientCount: recipients.length,
				service: 'notification-client',
			});
		} catch (error: any) {
			logger.error('Failed to send bulk SMS', {
				error: error?.message || String(error),
				recipientCount: recipients.length,
				service: 'notification-client',
			});
			// Don't throw - SMS failure shouldn't break the main flow
		}
	}
}

export const notificationClient = new NotificationClient();

