/**
 * HYBRID Schedule Validator
 * Validates that generated HYBRID schedules meet all business requirements
 */

import type { PurchaseSessionCreateInput } from '../models/purchaseSession.model';

export interface HybridScheduleValidationResult {
	isValid: boolean;
	errors: string[];
	warnings: string[];
	stats: {
		totalSessions: number;
		onlineCount: number;
		offlineCount: number;
		firstSixAreOnline: boolean;
		alternatesAfterSix: boolean;
		consecutiveDays: boolean;
	};
}

/**
 * Validate a HYBRID schedule against all business rules
 */
export function validateHybridSchedule(
	sessions: PurchaseSessionCreateInput[]
): HybridScheduleValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const stats = {
		totalSessions: sessions.length,
		onlineCount: 0,
		offlineCount: 0,
		firstSixAreOnline: true,
		alternatesAfterSix: true,
		consecutiveDays: true,
	};

	// Rule 1: Must have exactly 30 sessions
	if (sessions.length !== 30) {
		errors.push(`Expected 30 sessions, but got ${sessions.length}`);
	}

	// Rule 2: Count online and offline sessions
	for (const session of sessions) {
		if (session.sessionType === 'online') {
			stats.onlineCount++;
		} else if (session.sessionType === 'offline') {
			stats.offlineCount++;
		}
	}

	// Rule 3: Must have exactly 18 online and 12 offline
	if (stats.onlineCount !== 18) {
		errors.push(`Expected 18 online sessions, but got ${stats.onlineCount}`);
	}
	if (stats.offlineCount !== 12) {
		errors.push(`Expected 12 offline sessions, but got ${stats.offlineCount}`);
	}

	// Rule 4: First 6 sessions must be ONLINE
	for (let i = 0; i < Math.min(6, sessions.length); i++) {
		const session = sessions[i];
		if (!session) continue;
		if (session.sessionType !== 'online') {
			stats.firstSixAreOnline = false;
			errors.push(`Session ${i + 1} must be ONLINE, but is ${session.sessionType}`);
		}
	}

	// Rule 5: After session 6, must alternate ONLINE/OFFLINE
	// Expected pattern: ONLINE, OFFLINE, ONLINE, OFFLINE, ...
	let expectedOnline = true; // Session 7 should be ONLINE
	for (let i = 6; i < sessions.length; i++) {
		const session = sessions[i];
		if (!session) continue;
		const shouldBeOnline = expectedOnline;

		// Check if we've already reached the limit
		const onlineSoFar = sessions.slice(0, i + 1).filter(s => s.sessionType === 'online').length;
		const offlineSoFar = sessions.slice(0, i + 1).filter(s => s.sessionType === 'offline').length;

		if (onlineSoFar >= 18 && session.sessionType === 'online') {
			// Already have 18 online, this should be offline
			if (session.sessionType === 'online') {
				errors.push(`Session ${i + 1}: Already have 18 online sessions, but this is online`);
			}
		} else if (offlineSoFar >= 12 && session.sessionType === 'offline') {
			// Already have 12 offline, this should be online
			if (session.sessionType === 'offline') {
				errors.push(`Session ${i + 1}: Already have 12 offline sessions, but this is offline`);
			}
		} else if (onlineSoFar < 18 && offlineSoFar < 12) {
			// Still need both types, check alternation
			if (session.sessionType === 'online' && !shouldBeOnline) {
				stats.alternatesAfterSix = false;
				errors.push(`Session ${i + 1}: Expected OFFLINE (alternation), but got ONLINE`);
			} else if (session.sessionType === 'offline' && shouldBeOnline) {
				stats.alternatesAfterSix = false;
				errors.push(`Session ${i + 1}: Expected ONLINE (alternation), but got OFFLINE`);
			}
		}

		expectedOnline = !expectedOnline; // Toggle for next iteration
	}

	// Rule 6: Sessions must be on consecutive days
	for (let i = 1; i < sessions.length; i++) {
		const prevSession = sessions[i - 1];
		const currSession = sessions[i];
		if (!prevSession || !currSession) continue;
		const prevDate = new Date(prevSession.sessionDate);
		const currDate = new Date(currSession.sessionDate);
		const daysDiff = Math.floor((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));

		if (daysDiff !== 1) {
			stats.consecutiveDays = false;
			errors.push(
				`Sessions ${i} and ${i + 1} are not consecutive: ${daysDiff} days apart`
			);
		}
	}

	// Rule 7: Online sessions must have fixed time metadata
	for (let i = 0; i < sessions.length; i++) {
		const session = sessions[i];
		if (!session) continue;
		if (session.sessionType === 'online') {
			const metadata = session.metadata as Record<string, unknown> | undefined;
			if (!metadata?.isFixedTime) {
				warnings.push(`Session ${i + 1} (online): Missing isFixedTime metadata`);
			}
			if (metadata?.isBookable !== false) {
				warnings.push(`Session ${i + 1} (online): Should have isBookable=false`);
			}
		} else if (session.sessionType === 'offline') {
			const metadata = session.metadata as Record<string, unknown> | undefined;
			if (metadata?.isFixedTime !== false) {
				warnings.push(`Session ${i + 1} (offline): Should have isFixedTime=false`);
			}
			if (metadata?.isBookable !== true) {
				warnings.push(`Session ${i + 1} (offline): Should have isBookable=true`);
			}
		}
	}

	return {
		isValid: errors.length === 0,
		errors,
		warnings,
		stats,
	};
}
