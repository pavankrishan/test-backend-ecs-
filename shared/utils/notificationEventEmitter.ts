/**
 * Notification Event Emitter
 * 
 * PHASE 3 FIX: Replaces synchronous HTTP calls to notification-service
 * with asynchronous event emissions.
 * 
 * Usage:
 * ```typescript
 * import { emitNotificationRequested } from '@kodingcaravan/shared/utils/notificationEventEmitter';
 * 
 * await emitNotificationRequested({
 *   userId: 'user123',
 *   role: 'student',
 *   notificationType: 'allocation',
 *   title: 'Trainer Assigned',
 *   body: 'Your trainer has been assigned',
 *   deviceToken: 'fcm-token-here', // Optional
 *   data: { allocationId: 'alloc123' }, // Optional
 * });
 * ```
 */

import logger from '../config/logger';
import type { NotificationRequestedEvent } from '../events/types';

/**
 * Emit NOTIFICATION_REQUESTED event
 * 
 * PHASE 3 FIX: This replaces HTTP calls to notification-service.
 * The notification-worker will consume this event and send the notification.
 * 
 * @param event - Notification event data
 * @param correlationId - Optional correlation ID for tracing
 */
export async function emitNotificationRequested(
  event: Omit<NotificationRequestedEvent, 'type' | 'timestamp'>,
  correlationId?: string
): Promise<void> {
  try {
    const notificationEvent: NotificationRequestedEvent = {
      type: 'NOTIFICATION_REQUESTED',
      timestamp: Date.now(),
      userId: event.userId,
      role: event.role,
      notificationType: event.notificationType,
      title: event.title,
      body: event.body,
      ...(event.deviceToken && { deviceToken: event.deviceToken }),
      ...(event.data && { data: event.data }),
      metadata: {
        correlationId,
        ...event.metadata,
      },
    };

    // CRITICAL: Emit to Kafka so notification-worker consumes and sends push
    const { getKafkaEventBus } = await import('../events/kafkaEventBus');
    const kafkaBus = getKafkaEventBus();
    await kafkaBus.connect();
    const eventId = `notif-${correlationId ?? 'nil'}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    await kafkaBus.emit(notificationEvent, {
      eventId,
      correlationId: correlationId ?? eventId,
      source: 'notification-emitter',
      version: '1.0.0',
    });

    logger.info('NOTIFICATION_REQUESTED event emitted to Kafka', {
      userId: event.userId,
      notificationType: event.notificationType,
      title: event.title,
      correlationId,
      eventId,
      service: 'notification-event-emitter',
    });

    // Also emit to Redis for any real-time subscribers (e.g. WebSocket)
    try {
      const { getEventBus } = await import('../events/eventBus');
      const eventBus = getEventBus();
      await eventBus.emit(notificationEvent);
    } catch (redisErr: any) {
      logger.debug('Redis emit for NOTIFICATION_REQUESTED skipped (non-critical)', {
        error: redisErr?.message,
        service: 'notification-event-emitter',
      });
    }
  } catch (error: any) {
    // Log error but don't throw (notification failure shouldn't break main flow)
    logger.error('Failed to emit NOTIFICATION_REQUESTED event', {
      error: error?.message || String(error),
      userId: event.userId,
      notificationType: event.notificationType,
      correlationId,
      service: 'notification-event-emitter',
    });
  }
}

/**
 * Helper: Emit notification for course purchase
 */
export async function emitCoursePurchaseNotification(
  studentId: string,
  courseName: string,
  amount: number,
  correlationId?: string
): Promise<void> {
  await emitNotificationRequested({
    userId: studentId,
    role: 'student',
    notificationType: 'payment',
    title: 'Course Purchased Successfully! 🎉',
    body: `Congratulations! You have successfully purchased "${courseName}". Your course is now available in your learning section.`,
    data: {
      courseName,
      amount,
      type: 'course_purchase',
    },
    metadata: {
      correlationId,
    },
  }, correlationId);
}

/**
 * Helper: Emit notification for trainer assignment
 */
export async function emitTrainerAssignmentNotification(
  studentId: string,
  trainerName: string,
  courseName?: string,
  correlationId?: string
): Promise<void> {
  const message = courseName
    ? `Great news! Trainer ${trainerName} has been assigned to your course "${courseName}". You will receive session details soon.`
    : `Great news! Trainer ${trainerName} has been assigned to you. You will receive session details soon.`;

  await emitNotificationRequested({
    userId: studentId,
    role: 'student',
    notificationType: 'allocation',
    title: 'Trainer Assigned',
    body: message,
    data: {
      trainerName,
      courseName,
      type: 'trainer_assignment',
    },
    metadata: {
      correlationId,
    },
  }, correlationId);
}

/**
 * Helper: Emit notification for trainer when assigned
 */
export async function emitTrainerAssignedNotification(
  trainerId: string,
  studentName: string,
  courseName?: string,
  correlationId?: string
): Promise<void> {
  const message = courseName
    ? `You have been assigned to teach "${courseName}" for student ${studentName}. Check your schedule for session details.`
    : `You have been assigned to teach student ${studentName}. Check your schedule for session details.`;

  await emitNotificationRequested({
    userId: trainerId,
    role: 'trainer',
    notificationType: 'allocation',
    title: 'New Assignment',
    body: message,
    data: {
      studentName,
      courseName,
      type: 'trainer_assigned',
    },
    metadata: {
      correlationId,
    },
  }, correlationId);
}

/**
 * Helper: Emit notification for session OTP
 */
export async function emitSessionOtpNotification(
  studentId: string,
  otp: string,
  trainerName: string,
  correlationId?: string
): Promise<void> {
  await emitNotificationRequested({
    userId: studentId,
    role: 'student',
    notificationType: 'session',
    title: 'Trainer Arrived - Share OTP',
    body: `Your trainer ${trainerName} has arrived. Share this OTP to start the session: ${otp}`,
    data: {
      otp,
      trainerName,
      type: 'session_otp',
    },
    metadata: {
      correlationId,
    },
  }, correlationId);
}

/**
 * Helper: Emit notification for session confirmation request
 */
export async function emitSessionConfirmationRequest(
  studentId: string,
  sessionId: string,
  correlationId?: string
): Promise<void> {
  await emitNotificationRequested({
    userId: studentId,
    role: 'student',
    notificationType: 'session',
    title: 'Session Completed - Confirm',
    body: 'Your session has been completed. Please confirm if the session was completed successfully.',
    data: {
      sessionId,
      type: 'session_confirmation_request',
    },
    metadata: {
      correlationId,
    },
  }, correlationId);
}

/**
 * Helper: Emit notification for course completion
 */
export async function emitCourseCompletionNotification(
  studentId: string,
  courseName: string,
  correlationId?: string
): Promise<void> {
  await emitNotificationRequested({
    userId: studentId,
    role: 'student',
    notificationType: 'success',
    title: 'Course Completed! 🎓🎉',
    body: `Congratulations! You have successfully completed "${courseName}". Great job on your learning journey!`,
    data: {
      courseName,
      type: 'course_completion',
    },
    metadata: {
      correlationId,
    },
  }, correlationId);
}

/**
 * Helper: Emit notification for session scheduled
 */
export async function emitSessionScheduledNotification(
  studentId: string,
  trainerName: string,
  scheduledDate: Date,
  scheduledTime: string,
  correlationId?: string
): Promise<void> {
  const dateStr = scheduledDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  await emitNotificationRequested({
    userId: studentId,
    role: 'student',
    notificationType: 'session',
    title: 'Session Scheduled',
    body: `Your session with ${trainerName} has been scheduled for ${dateStr} at ${scheduledTime}. Please be ready!`,
    data: {
      trainerName,
      scheduledDate: scheduledDate.toISOString(),
      scheduledTime,
      type: 'session_scheduled',
    },
    metadata: {
      correlationId,
    },
  }, correlationId);
}

/**
 * Helper: Emit notification for trainer when session is scheduled
 */
export async function emitTrainerSessionScheduledNotification(
  trainerId: string,
  studentName: string,
  scheduledDate: Date,
  scheduledTime: string,
  correlationId?: string
): Promise<void> {
  const dateStr = scheduledDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  await emitNotificationRequested({
    userId: trainerId,
    role: 'trainer',
    notificationType: 'session',
    title: 'New Session Scheduled',
    body: `You have a session scheduled with ${studentName} on ${dateStr} at ${scheduledTime}.`,
    data: {
      studentName,
      scheduledDate: scheduledDate.toISOString(),
      scheduledTime,
      type: 'trainer_session_scheduled',
    },
    metadata: {
      correlationId,
    },
  }, correlationId);
}

/**
 * Helper: Emit notification for trainer allocation capacity
 */
export async function emitTrainerAllocationCapacityNotification(
  trainerId: string,
  currentAllocations: number,
  maxAllocations: number,
  rating: number | string,
  correlationId?: string
): Promise<void> {
  const ratingNum = typeof rating === 'number' ? rating : parseFloat(String(rating)) || 0;
  const formattedRating = ratingNum.toFixed(1);

  const message = maxAllocations > 6
    ? `You currently have ${currentAllocations} student allocations. Based on your rating (${formattedRating}), you can accept up to ${maxAllocations} allocations. Would you like to receive more student assignments? Open the app to respond.`
    : `You currently have ${currentAllocations} student allocations, which is your maximum capacity based on your rating (${formattedRating}).`;

  await emitNotificationRequested({
    userId: trainerId,
    role: 'trainer',
    notificationType: 'allocation',
    title: 'Allocation Capacity Reached',
    body: message,
    data: {
      currentAllocations,
      maxAllocations,
      rating: formattedRating,
      type: 'trainer_allocation_capacity',
    },
    metadata: {
      correlationId,
    },
  }, correlationId);
}

/**
 * Helper: Emit notification for application submitted
 */
export async function emitApplicationSubmittedNotification(
  trainerId: string,
  correlationId?: string
): Promise<void> {
  await emitNotificationRequested({
    userId: trainerId,
    role: 'trainer',
    notificationType: 'system',
    title: 'Application Submitted',
    body: 'Your trainer application has been submitted successfully! Our team will review it and get back to you soon.',
    data: {
      type: 'application_submitted',
    },
    metadata: {
      correlationId,
    },
  }, correlationId);
}

/**
 * Helper: Emit notification for application approved
 */
export async function emitApplicationApprovedNotification(
  trainerId: string,
  correlationId?: string
): Promise<void> {
  await emitNotificationRequested({
    userId: trainerId,
    role: 'trainer',
    notificationType: 'success',
    title: 'Application Approved! 🎉',
    body: 'Congratulations! Your trainer application has been approved. You can now start teaching and accept students.',
    data: {
      type: 'application_approved',
    },
    metadata: {
      correlationId,
    },
  }, correlationId);
}

/**
 * Helper: Emit notification for application rejected
 */
export async function emitApplicationRejectedNotification(
  trainerId: string,
  reason?: string,
  correlationId?: string
): Promise<void> {
  const message = reason
    ? `Your trainer application has been reviewed. Unfortunately, it was not approved at this time. Reason: ${reason}. You can reapply with updated information.`
    : 'Your trainer application has been reviewed. Unfortunately, it was not approved at this time. You can reapply with updated information.';

  await emitNotificationRequested({
    userId: trainerId,
    role: 'trainer',
    notificationType: 'warning',
    title: 'Application Status Update',
    body: message,
    data: {
      reason,
      type: 'application_rejected',
    },
    metadata: {
      correlationId,
    },
  }, correlationId);
}
