/**
 * Account Lockout Utility
 * Tracks failed login attempts and locks accounts
 */

interface FailedAttempt {
	userId: string;
	attempts: number;
	lockedUntil: Date | null;
	lastAttemptAt: Date;
}

import { accountLockoutConfig } from '../config/accountLockoutConfig';

// In-memory store (in production, use Redis)
const failedAttempts: Map<string, FailedAttempt> = new Map();

const MAX_ATTEMPTS = accountLockoutConfig.maxAttempts;
const LOCKOUT_DURATION_MS = accountLockoutConfig.lockoutDurationMs;

/**
 * Record a failed login attempt
 */
export function recordFailedAttempt(userId: string): void {
	const now = new Date();
	const existing = failedAttempts.get(userId);

	if (!existing) {
		failedAttempts.set(userId, {
			userId,
			attempts: 1,
			lockedUntil: null,
			lastAttemptAt: now,
		});
		return;
	}

	// Reset if lockout expired
	if (existing.lockedUntil && existing.lockedUntil < now) {
		failedAttempts.set(userId, {
			userId,
			attempts: 1,
			lockedUntil: null,
			lastAttemptAt: now,
		});
		return;
	}

	// Increment attempts
	existing.attempts++;
	existing.lastAttemptAt = now;

	// Lock account if max attempts reached
	if (existing.attempts >= MAX_ATTEMPTS && !existing.lockedUntil) {
		existing.lockedUntil = new Date(now.getTime() + LOCKOUT_DURATION_MS);
	}

	failedAttempts.set(userId, existing);
}

/**
 * Clear failed attempts (on successful login)
 */
export function clearFailedAttempts(userId: string): void {
	failedAttempts.delete(userId);
}

/**
 * Check if account is locked
 */
export function isAccountLocked(userId: string): { locked: boolean; lockedUntil?: Date } {
	const attempt = failedAttempts.get(userId);
	
	if (!attempt) {
		return { locked: false };
	}

	const now = new Date();

	// Check if lockout expired
	if (attempt.lockedUntil && attempt.lockedUntil < now) {
		// Clear expired lockout
		failedAttempts.delete(userId);
		return { locked: false };
	}

	if (attempt.lockedUntil && attempt.lockedUntil >= now) {
		return { locked: true, lockedUntil: attempt.lockedUntil };
	}

	return { locked: false };
}

/**
 * Get remaining attempts
 */
export function getRemainingAttempts(userId: string): number {
	const attempt = failedAttempts.get(userId);
	if (!attempt) {
		return MAX_ATTEMPTS;
	}

	const now = new Date();
	if (attempt.lockedUntil && attempt.lockedUntil >= now) {
		return 0;
	}

	return Math.max(0, MAX_ATTEMPTS - attempt.attempts);
}

/**
 * Cleanup old failed attempts
 */
function cleanupOldAttempts(): void {
	const now = new Date();
	const maxAge = accountLockoutConfig.maxAttemptAgeMs;
	
	for (const [userId, attempt] of failedAttempts.entries()) {
		const age = now.getTime() - attempt.lastAttemptAt.getTime();
		if (age > maxAge && (!attempt.lockedUntil || attempt.lockedUntil < now)) {
			failedAttempts.delete(userId);
		}
	}
}

// Run cleanup at configured interval
setInterval(cleanupOldAttempts, accountLockoutConfig.cleanupIntervalMs);

