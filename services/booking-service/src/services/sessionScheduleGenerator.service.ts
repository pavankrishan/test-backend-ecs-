/**
 * Session Schedule Generator Service
 * Generates session schedules based on delivery mode and class type
 */

import type { ClassType, DeliveryMode } from '../models/coursePurchase.model';
import type { PurchaseSessionCreateInput, SessionType } from '../models/purchaseSession.model';

export interface SessionSchedule {
	sessions: PurchaseSessionCreateInput[];
}

export class SessionScheduleGeneratorService {
	/**
	 * Generate session schedule based on delivery mode and class type
	 */
	generateSchedule(
		purchaseId: string,
		bookingId: string,
		classType: ClassType,
		totalSessions: 10 | 20 | 30,
		deliveryMode: DeliveryMode,
		startDate: Date,
		preferredTimeSlot: string
	): SessionSchedule {
		if (classType === 'HYBRID') {
			return this.generateHybridSchedule(
				purchaseId,
				bookingId,
				totalSessions,
				startDate,
				preferredTimeSlot
			);
		}

		if (deliveryMode === 'WEEKDAY_DAILY') {
			return this.generateWeekdayDailySchedule(
				purchaseId,
				bookingId,
				totalSessions,
				startDate,
				preferredTimeSlot
			);
		}

		if (deliveryMode === 'SUNDAY_ONLY') {
			return this.generateSundayOnlySchedule(
				purchaseId,
				bookingId,
				totalSessions,
				startDate,
				preferredTimeSlot
			);
		}

		throw new Error(`Unsupported delivery mode: ${deliveryMode}`);
	}

	/**
	 * Generate schedule for WEEKDAY_DAILY mode
	 * 1 session per school day (Mon-Sun), consecutive days
	 * All 7 days of the week are included
	 */
	private generateWeekdayDailySchedule(
		purchaseId: string,
		bookingId: string,
		totalSessions: number,
		startDate: Date,
		preferredTimeSlot: string
	): SessionSchedule {
		const sessions: PurchaseSessionCreateInput[] = [];
		let currentDate = new Date(startDate);
		let sessionNumber = 1;

		while (sessions.length < totalSessions) {
			// Include all days of the week (Mon-Sun, consecutive)
			sessions.push({
				purchaseId,
				bookingId,
				sessionNumber: sessionNumber++,
				sessionDate: new Date(currentDate),
				sessionTime: preferredTimeSlot,
				sessionType: 'offline',
				status: 'scheduled',
			});

			// Move to next day
			currentDate.setDate(currentDate.getDate() + 1);
		}

		// Validate that we generated the correct number of sessions
		if (sessions.length !== totalSessions) {
			throw new Error(
				`WEEKDAY_DAILY schedule generation failed: Expected ${totalSessions} sessions, but generated ${sessions.length}`
			);
		}

		return { sessions };
	}

	/**
	 * Generate schedule for SUNDAY_ONLY mode
	 * 2 sessions back-to-back every Sunday (80 minutes total)
	 */
	private generateSundayOnlySchedule(
		purchaseId: string,
		bookingId: string,
		totalSessions: number,
		startDate: Date,
		preferredTimeSlot: string
	): SessionSchedule {
		const sessions: PurchaseSessionCreateInput[] = [];
		let currentDate = new Date(startDate);

		// Find the first Sunday on or after startDate
		while (currentDate.getDay() !== 0) {
			currentDate.setDate(currentDate.getDate() + 1);
		}

		let sessionNumber = 1;
		const totalSundays = Math.ceil(totalSessions / 2);

		for (let sunday = 0; sunday < totalSundays && sessions.length < totalSessions; sunday++) {
			const sessionDate = new Date(currentDate);

			// First session of the day
			sessions.push({
				purchaseId,
				bookingId,
				sessionNumber: sessionNumber++,
				sessionDate: new Date(sessionDate),
				sessionTime: preferredTimeSlot,
				sessionType: 'offline',
				status: 'scheduled',
			});

			// Second session of the day (40 minutes after first session)
			if (sessions.length < totalSessions) {
				const secondSessionTime = this.addMinutesToTimeSlot(preferredTimeSlot, 40);
				sessions.push({
					purchaseId,
					bookingId,
					sessionNumber: sessionNumber++,
					sessionDate: new Date(sessionDate),
					sessionTime: secondSessionTime,
					sessionType: 'offline',
					status: 'scheduled',
				});
			}

			// Move to next Sunday
			currentDate.setDate(currentDate.getDate() + 7);
		}

		// Validate that we generated the correct number of sessions
		if (sessions.length !== totalSessions) {
			throw new Error(
				`SUNDAY_ONLY schedule generation failed: Expected ${totalSessions} sessions, but generated ${sessions.length}`
			);
		}

		return { sessions };
	}

	/**
	 * Generate schedule for HYBRID mode
	 * 
	 * HYBRID CLASS REQUIREMENTS:
	 * - Total sessions per batch: 30
	 * - Online sessions: 18 (fixed time, defined by admin/client via preferredTimeSlot)
	 * - Offline sessions: 12 (flexible time, student books slots)
	 * - First 6 sessions must be ONLINE only
	 * - After session 6, sessions must ALTERNATE:
	 *   - One ONLINE (fixed time)
	 *   - One OFFLINE (flexible booking)
	 * - Do not exceed 18 online or 12 offline sessions
	 * - Sessions occur on consecutive days (no gaps unless specified)
	 * 
	 * ONLINE SESSION RULES:
	 * - Time is FIXED by client/admin (preferredTimeSlot)
	 * - Students can only JOIN
	 * - Students CANNOT choose or modify time
	 * - Capacity-based (many students per session)
	 * 
	 * OFFLINE SESSION RULES:
	 * - Time is FLEXIBLE (initially set to preferredTimeSlot, but student can book different slot)
	 * - Student selects available slot
	 * - Must validate trainer availability
	 * - Prevent double booking
	 * - Capacity depends on class type (1-1, 1-2, 1-3)
	 */
	private generateHybridSchedule(
		purchaseId: string,
		bookingId: string,
		totalSessions: number,
		startDate: Date,
		preferredTimeSlot: string
	): SessionSchedule {
		if (totalSessions !== 30) {
			throw new Error('HYBRID mode requires exactly 30 sessions');
		}

		const sessions: PurchaseSessionCreateInput[] = [];
		let currentDate = new Date(startDate);
		let sessionNumber = 1;
		let onlineCount = 0;
		let offlineCount = 0;
		const targetOnlineSessions = 18;
		const targetOfflineSessions = 12;

		// Phase 1: First 6 sessions must be ONLINE only
		// Sessions 1-6: All ONLINE
		for (let i = 0; i < 6; i++) {
			sessions.push({
				purchaseId,
				bookingId,
				sessionNumber: sessionNumber++,
				sessionDate: new Date(currentDate),
				sessionTime: preferredTimeSlot, // Fixed time for online sessions
				sessionType: 'online',
				status: 'scheduled',
				metadata: {
					isBookable: false, // Online sessions: students can only JOIN, not book
					isFixedTime: true, // Time is fixed by admin/client
					requiresBooking: false, // No booking required, just join
				},
			});
			onlineCount++;
			currentDate.setDate(currentDate.getDate() + 1); // Move to next consecutive day
		}

		// Phase 2: After session 6, alternate ONLINE and OFFLINE
		// Continue until we reach exactly 18 online and 12 offline
		// Pattern: ONLINE, OFFLINE, ONLINE, OFFLINE, ...
		let shouldBeOnline = true; // Start with ONLINE after the first 6

		while (onlineCount < targetOnlineSessions || offlineCount < targetOfflineSessions) {
			// Determine session type based on alternation pattern and remaining counts
			let sessionType: 'online' | 'offline';
			
			if (onlineCount >= targetOnlineSessions) {
				// Already have 18 online, remaining must be offline
				sessionType = 'offline';
			} else if (offlineCount >= targetOfflineSessions) {
				// Already have 12 offline, remaining must be online
				sessionType = 'online';
			} else {
				// Follow alternation pattern
				sessionType = shouldBeOnline ? 'online' : 'offline';
				shouldBeOnline = !shouldBeOnline; // Toggle for next iteration
			}

			// Create session based on type
			if (sessionType === 'online') {
				sessions.push({
					purchaseId,
					bookingId,
					sessionNumber: sessionNumber++,
					sessionDate: new Date(currentDate),
					sessionTime: preferredTimeSlot, // Fixed time for online sessions
					sessionType: 'online',
					status: 'scheduled',
					metadata: {
						isBookable: false, // Online sessions: students can only JOIN, not book
						isFixedTime: true, // Time is fixed by admin/client
						requiresBooking: false, // No booking required, just join
					},
				});
				onlineCount++;
			} else {
				sessions.push({
					purchaseId,
					bookingId,
					sessionNumber: sessionNumber++,
					sessionDate: new Date(currentDate),
					sessionTime: preferredTimeSlot, // Initial time, but student can book different slot
					sessionType: 'offline',
					status: 'scheduled',
					metadata: {
						isBookable: true, // Offline sessions: student must book a slot
						isFixedTime: false, // Time is flexible, student selects slot
						requiresBooking: true, // Student must book a time slot
						initialTimeSlot: preferredTimeSlot, // Store initial preference
					},
				});
				offlineCount++;
			}

			currentDate.setDate(currentDate.getDate() + 1); // Move to next consecutive day
		}

		// Validation: Ensure exact counts
		if (onlineCount !== targetOnlineSessions) {
			throw new Error(
				`HYBRID schedule generation failed: Expected ${targetOnlineSessions} online sessions, but generated ${onlineCount}`
			);
		}

		if (offlineCount !== targetOfflineSessions) {
			throw new Error(
				`HYBRID schedule generation failed: Expected ${targetOfflineSessions} offline sessions, but generated ${offlineCount}`
			);
		}

		if (sessions.length !== totalSessions) {
			throw new Error(
				`HYBRID schedule generation failed: Expected ${totalSessions} total sessions, but generated ${sessions.length}`
			);
		}

		// Sessions are already in chronological order (consecutive days)
		// No need to sort or re-number as we generated them sequentially

		return { sessions };
	}

	/**
	 * Add minutes to a time slot string (HH:MM format)
	 */
	private addMinutesToTimeSlot(timeSlot: string, minutes: number): string {
		const parts = timeSlot.split(':').map(Number);
		const hours = parts[0] || 0;
		const mins = parts[1] || 0;
		const totalMinutes = hours * 60 + mins + minutes;
		const newHours = Math.floor(totalMinutes / 60) % 24;
		const newMins = totalMinutes % 60;
		return `${String(newHours).padStart(2, '0')}:${String(newMins).padStart(2, '0')}`;
	}
}

