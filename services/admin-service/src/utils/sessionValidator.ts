/**
 * Session validation utilities for production
 * Validates session creation and updates
 */

import { AppError } from '@kodingcaravan/shared';

export interface SessionValidationInput {
  trainerId: string;
  studentId: string;
  scheduledDate: Date;
  scheduledTime: string;
  studentHomeLocation: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  courseId?: string | null;
}

/**
 * Validate session creation input
 */
export function validateSessionCreation(input: SessionValidationInput): void {
  // Validate required fields
  if (!input.trainerId) {
    throw new AppError('Trainer ID is required', 400);
  }

  if (!input.studentId) {
    throw new AppError('Student ID is required', 400);
  }

  if (!input.scheduledDate) {
    throw new AppError('Scheduled date is required', 400);
  }

  if (!input.scheduledTime) {
    throw new AppError('Scheduled time is required', 400);
  }

  // Validate GPS coordinates
  if (!input.studentHomeLocation) {
    throw new AppError('Student home location is required', 400);
  }

  if (typeof input.studentHomeLocation.latitude !== 'number') {
    throw new AppError('Student home latitude must be a number', 400);
  }

  if (typeof input.studentHomeLocation.longitude !== 'number') {
    throw new AppError('Student home longitude must be a number', 400);
  }

  if (input.studentHomeLocation.latitude < -90 || input.studentHomeLocation.latitude > 90) {
    throw new AppError('Student home latitude must be between -90 and 90', 400);
  }

  if (input.studentHomeLocation.longitude < -180 || input.studentHomeLocation.longitude > 180) {
    throw new AppError('Student home longitude must be between -180 and 180', 400);
  }

  // Validate date is not in the past (compare dates only, ignore time)
  const scheduledDate = new Date(input.scheduledDate);
  scheduledDate.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (scheduledDate < today) {
    throw new AppError('Scheduled date cannot be in the past', 400);
  }

  // Validate time format (basic check)
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]\s?(AM|PM)$/i;
  if (!timeRegex.test(input.scheduledTime)) {
    // Allow flexible time formats but log warning
    console.warn(`[SessionValidator] Unusual time format: ${input.scheduledTime}`);
  }
}

/**
 * Validate GPS coordinates
 */
export function validateGPSCoordinates(latitude: number, longitude: number): void {
  if (typeof latitude !== 'number' || isNaN(latitude)) {
    throw new AppError('Latitude must be a valid number', 400);
  }

  if (typeof longitude !== 'number' || isNaN(longitude)) {
    throw new AppError('Longitude must be a valid number', 400);
  }

  if (latitude < -90 || latitude > 90) {
    throw new AppError('Latitude must be between -90 and 90', 400);
  }

  if (longitude < -180 || longitude > 180) {
    throw new AppError('Longitude must be between -180 and 180', 400);
  }
}

/**
 * Check if session time conflicts with existing sessions
 */
export async function checkSessionConflict(
  pool: any,
  trainerId: string,
  scheduledDate: Date,
  scheduledTime: string,
  excludeSessionId?: string
): Promise<boolean> {
  try {
    const dateStr = scheduledDate.toISOString().split('T')[0];
    
    const result = await pool.query(
      `
        SELECT id, scheduled_time, status
        FROM tutoring_sessions
        WHERE trainer_id = $1
          AND scheduled_date = $2::DATE
          AND scheduled_time = $3
          AND status IN ('scheduled', 'pending_verification', 'in_progress')
          ${excludeSessionId ? 'AND id != $4' : ''}
        LIMIT 1
      `,
      excludeSessionId ? [trainerId, dateStr, scheduledTime, excludeSessionId] : [trainerId, dateStr, scheduledTime]
    );

    return result.rows.length > 0;
  } catch (error: any) {
    console.error('[SessionValidator] Error checking session conflict:', error);
    // Don't throw - allow session creation if check fails
    return false;
  }
}

