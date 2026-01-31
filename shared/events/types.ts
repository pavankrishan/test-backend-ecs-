/**
 * Business Event Types
 * 
 * All business events that trigger state updates in the frontend.
 * Events are emitted after state changes in backend services.
 */

export type BusinessEventType =
  | 'PURCHASE_CONFIRMED' // Payment verified, ready for purchase creation
  | 'PURCHASE_CREATED' // Purchase record created in database
  | 'COURSE_ACCESS_GRANTED' // Course access granted to student (after purchase creation)
  | 'COURSE_PURCHASED' // Legacy event (deprecated, use PURCHASE_CREATED)
  | 'TRAINER_ALLOCATED'
  | 'SESSIONS_GENERATED' // Sessions created for an allocation
  | 'STUDENT_DEALLOCATED'
  | 'SESSION_RESCHEDULED'
  | 'SESSION_SUBSTITUTED'
  | 'SESSION_COMPLETED'
  | 'COURSE_PROGRESS_UPDATED' // Course progress recalculated after session completion
  | 'COURSE_COMPLETED'
  | 'CERTIFICATE_ISSUED'
  | 'ADMIN_OVERRIDE'
  | 'PAYROLL_RECALCULATED'
  | 'NOTIFICATION_REQUESTED'; // Notification requested (consumed by notification-worker)

export interface BaseBusinessEvent {
  type: BusinessEventType;
  timestamp: number;
  userId: string;
  role: 'student' | 'trainer' | 'admin';
  metadata?: Record<string, unknown>;
}

export interface PurchaseConfirmedEvent extends BaseBusinessEvent {
  type: 'PURCHASE_CONFIRMED';
  paymentId: string;
  studentId: string;
  courseId: string;
  amountCents: number;
  metadata: Record<string, unknown>;
}

export interface PurchaseCreatedEvent extends BaseBusinessEvent {
  type: 'PURCHASE_CREATED';
  purchaseId: string;
  studentId: string;
  courseId: string;
  purchaseTier: number;
  metadata: Record<string, unknown>;
}

export interface CourseAccessGrantedEvent extends BaseBusinessEvent {
  type: 'COURSE_ACCESS_GRANTED';
  purchaseId: string;
  studentId: string;
  courseId: string;
  purchaseTier: number;
  metadata: Record<string, unknown>;
}

export interface CoursePurchasedEvent extends BaseBusinessEvent {
  type: 'COURSE_PURCHASED';
  courseId: string;
  studentId: string;
  purchaseId: string;
  sessionCount: number;
  startDate: string;
  endDate: string;
}

export interface TrainerAllocatedEvent extends BaseBusinessEvent {
  type: 'TRAINER_ALLOCATED';
  allocationId: string;
  trainerId: string;
  studentId: string;
  courseId: string;
  sessionCount: number;
  startDate: string;
  endDate: string;
}

export interface SessionsGeneratedEvent extends BaseBusinessEvent {
  type: 'SESSIONS_GENERATED';
  allocationId: string;
  trainerId: string;
  studentId: string;
  courseId: string;
  sessionCount: number;
  sessionIds: string[];
  startDate: string;
}

export interface StudentDeallocatedEvent extends BaseBusinessEvent {
  type: 'STUDENT_DEALLOCATED';
  allocationId: string;
  trainerId: string;
  studentId: string;
  courseId: string;
  reason: string;
  deallocatedAt: string;
}

export interface SessionRescheduledEvent extends BaseBusinessEvent {
  type: 'SESSION_RESCHEDULED';
  sessionId: string;
  oldDate: string;
  newDate: string;
  oldTimeSlot: string;
  newTimeSlot: string;
  trainerId: string;
  studentId: string;
}

export interface SessionSubstitutedEvent extends BaseBusinessEvent {
  type: 'SESSION_SUBSTITUTED';
  sessionId: string;
  originalTrainerId: string;
  substituteTrainerId: string;
  studentId: string;
  date: string;
  timeSlot: string;
}

export interface SessionCompletedEvent extends BaseBusinessEvent {
  type: 'SESSION_COMPLETED';
  sessionId: string;
  trainerId: string;
  studentId: string;
  courseId?: string;
  completedAt: string;
  duration: number; // minutes
}

export interface CourseProgressUpdatedEvent extends BaseBusinessEvent {
  type: 'COURSE_PROGRESS_UPDATED';
  studentId: string;
  courseId: string;
  completedSessions: number;
  totalSessions: number;
  percentage: number;
  lastCompletedAt: string;
}

export interface CourseCompletedEvent extends BaseBusinessEvent {
  type: 'COURSE_COMPLETED';
  courseId: string;
  studentId: string;
  completionDate: string;
  totalSessions: number;
  completedSessions: number;
}

export interface CertificateIssuedEvent extends BaseBusinessEvent {
  type: 'CERTIFICATE_ISSUED';
  certificateId: string;
  studentId: string;
  courseId: string;
  issuedAt: string;
  certificateUrl: string;
}

export interface AdminOverrideEvent extends BaseBusinessEvent {
  type: 'ADMIN_OVERRIDE';
  action: string;
  targetId: string;
  targetType: 'allocation' | 'payroll' | 'session';
  changes: Record<string, unknown>;
  reason: string;
}

export interface PayrollRecalculatedEvent extends BaseBusinessEvent {
  type: 'PAYROLL_RECALCULATED';
  trainerId: string;
  month: string; // YYYY-MM-01
  snapshotId: string;
  recalculatedBy: 'system' | 'admin';
}

export interface NotificationRequestedEvent extends BaseBusinessEvent {
  type: 'NOTIFICATION_REQUESTED';
  notificationType: 'info' | 'success' | 'warning' | 'error' | 'session' | 'payment' | 'allocation' | 'system';
  title: string;
  body: string;
  deviceToken?: string; // Optional: for push notifications
  data?: Record<string, unknown>; // Optional: additional data for notification
}

export type BusinessEvent =
  | PurchaseConfirmedEvent
  | PurchaseCreatedEvent
  | CourseAccessGrantedEvent
  | CoursePurchasedEvent
  | TrainerAllocatedEvent
  | SessionsGeneratedEvent
  | StudentDeallocatedEvent
  | SessionRescheduledEvent
  | SessionSubstitutedEvent
  | SessionCompletedEvent
  | CourseProgressUpdatedEvent
  | CourseCompletedEvent
  | CertificateIssuedEvent
  | AdminOverrideEvent
  | PayrollRecalculatedEvent
  | NotificationRequestedEvent;

