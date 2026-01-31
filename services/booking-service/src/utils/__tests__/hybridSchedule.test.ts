/**
 * HYBRID Schedule Generation Test
 * Validates that the schedule generator produces correct HYBRID schedules
 */

import { SessionScheduleGeneratorService } from '../../services/sessionScheduleGenerator.service';
import { validateHybridSchedule } from '../hybridScheduleValidator';

describe('HYBRID Schedule Generation', () => {
	const generator = new SessionScheduleGeneratorService();

	it('should generate correct HYBRID schedule with 30 sessions', () => {
		const startDate = new Date('2024-01-01');
		const schedule = generator.generateSchedule(
			'purchase-123',
			'booking-123',
			'HYBRID',
			30,
			'WEEKDAY_DAILY',
			startDate,
			'16:00'
		);

		expect(schedule.sessions).toHaveLength(30);

		const validation = validateHybridSchedule(schedule.sessions);
		expect(validation.isValid).toBe(true);
		expect(validation.errors).toHaveLength(0);
		expect(validation.stats.onlineCount).toBe(18);
		expect(validation.stats.offlineCount).toBe(12);
		expect(validation.stats.firstSixAreOnline).toBe(true);
		expect(validation.stats.consecutiveDays).toBe(true);
	});

	it('should have first 6 sessions as ONLINE', () => {
		const startDate = new Date('2024-01-01');
		const schedule = generator.generateSchedule(
			'purchase-123',
			'booking-123',
			'HYBRID',
			30,
			'WEEKDAY_DAILY',
			startDate,
			'16:00'
		);

		for (let i = 0; i < 6; i++) {
			expect(schedule.sessions[i].sessionType).toBe('online');
			expect(schedule.sessions[i].sessionNumber).toBe(i + 1);
		}
	});

	it('should alternate ONLINE/OFFLINE after session 6', () => {
		const startDate = new Date('2024-01-01');
		const schedule = generator.generateSchedule(
			'purchase-123',
			'booking-123',
			'HYBRID',
			30,
			'WEEKDAY_DAILY',
			startDate,
			'16:00'
		);

		// Session 7 should be ONLINE (first after the initial 6)
		expect(schedule.sessions[6].sessionType).toBe('online');
		expect(schedule.sessions[6].sessionNumber).toBe(7);

		// Session 8 should be OFFLINE
		expect(schedule.sessions[7].sessionType).toBe('offline');
		expect(schedule.sessions[7].sessionNumber).toBe(8);

		// Verify alternation continues (with limits respected)
		let onlineCount = 6; // First 6 are online
		let offlineCount = 0;

		for (let i = 6; i < schedule.sessions.length; i++) {
			if (schedule.sessions[i].sessionType === 'online') {
				onlineCount++;
			} else {
				offlineCount++;
			}
		}

		expect(onlineCount).toBe(18);
		expect(offlineCount).toBe(12);
	});

	it('should have correct metadata for online sessions', () => {
		const startDate = new Date('2024-01-01');
		const schedule = generator.generateSchedule(
			'purchase-123',
			'booking-123',
			'HYBRID',
			30,
			'WEEKDAY_DAILY',
			startDate,
			'16:00'
		);

		const onlineSessions = schedule.sessions.filter(s => s.sessionType === 'online');
		for (const session of onlineSessions) {
			const metadata = session.metadata as Record<string, unknown>;
			expect(metadata.isBookable).toBe(false);
			expect(metadata.isFixedTime).toBe(true);
			expect(metadata.requiresBooking).toBe(false);
		}
	});

	it('should have correct metadata for offline sessions', () => {
		const startDate = new Date('2024-01-01');
		const schedule = generator.generateSchedule(
			'purchase-123',
			'booking-123',
			'HYBRID',
			30,
			'WEEKDAY_DAILY',
			startDate,
			'16:00'
		);

		const offlineSessions = schedule.sessions.filter(s => s.sessionType === 'offline');
		for (const session of offlineSessions) {
			const metadata = session.metadata as Record<string, unknown>;
			expect(metadata.isBookable).toBe(true);
			expect(metadata.isFixedTime).toBe(false);
			expect(metadata.requiresBooking).toBe(true);
			expect(metadata.initialTimeSlot).toBe('16:00');
		}
	});

	it('should generate sessions on consecutive days', () => {
		const startDate = new Date('2024-01-01');
		const schedule = generator.generateSchedule(
			'purchase-123',
			'booking-123',
			'HYBRID',
			30,
			'WEEKDAY_DAILY',
			startDate,
			'16:00'
		);

		for (let i = 1; i < schedule.sessions.length; i++) {
			const prevDate = new Date(schedule.sessions[i - 1].sessionDate);
			const currDate = new Date(schedule.sessions[i].sessionDate);
			const daysDiff = Math.floor(
				(currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)
			);
			expect(daysDiff).toBe(1);
		}
	});

	it('should throw error if totalSessions is not 30', () => {
		const startDate = new Date('2024-01-01');
		expect(() => {
			generator.generateSchedule(
				'purchase-123',
				'booking-123',
				'HYBRID',
				20, // Invalid: must be 30
				'WEEKDAY_DAILY',
				startDate,
				'16:00'
			);
		}).toThrow('HYBRID mode requires exactly 30 sessions');
	});
});
