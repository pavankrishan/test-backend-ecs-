/**
 * Standardized Error Messages
 * Centralized error message constants for consistency
 */

export const ErrorMessages = {
	// Authentication
	AUTH_INVALID_CREDENTIALS: 'Invalid email or password. Please try again.',
	AUTH_ACCOUNT_LOCKED: 'Account locked due to too many failed login attempts. Please try again later.',
	AUTH_EMAIL_NOT_VERIFIED: 'Please verify your email address before logging in.',
	AUTH_PHONE_NOT_VERIFIED: 'Please verify your phone number before logging in.',
	AUTH_TOKEN_EXPIRED: 'Your session has expired. Please log in again.',
	AUTH_TOKEN_INVALID: 'Invalid authentication token. Please log in again.',
	AUTH_RATE_LIMIT_EXCEEDED: 'Too many authentication attempts. Please try again after a few minutes.',
	
	// OTP
	OTP_INVALID: 'Invalid verification code. Please check and try again.',
	OTP_EXPIRED: 'Verification code has expired. Please request a new one.',
	OTP_MAX_ATTEMPTS: 'Maximum verification attempts exceeded. Please request a new code.',
	OTP_RATE_LIMIT: 'Please wait before requesting a new verification code.',
	
	// Payment
	PAYMENT_NOT_FOUND: 'Payment not found.',
	PAYMENT_ALREADY_PROCESSED: 'This payment has already been processed.',
	PAYMENT_FAILED: 'Payment processing failed. Please try again.',
	PAYMENT_INVALID_AMOUNT: 'Invalid payment amount.',
	PAYMENT_TIMEOUT: 'Payment request timed out. Please try again.',
	
	// Enrollment
	ENROLLMENT_FAILED: 'Failed to enroll in course. Please contact support.',
	ENROLLMENT_ALREADY_ENROLLED: 'You are already enrolled in this course.',
	
	// Course
	COURSE_NOT_FOUND: 'Course not found.',
	COURSE_NOT_ACCESSIBLE: 'You do not have access to this course.',
	
	// Validation
	VALIDATION_REQUIRED_FIELD: 'This field is required.',
	VALIDATION_INVALID_FORMAT: 'Invalid format. Please check your input.',
	VALIDATION_INVALID_EMAIL: 'Please enter a valid email address.',
	VALIDATION_INVALID_PHONE: 'Please enter a valid phone number.',
	
	// General
	GENERIC_ERROR: 'An error occurred. Please try again later.',
	NOT_FOUND: 'Resource not found.',
	UNAUTHORIZED: 'You are not authorized to perform this action.',
	FORBIDDEN: 'Access denied.',
	RATE_LIMIT_EXCEEDED: 'Too many requests. Please slow down.',
	TIMEOUT: 'Request timed out. Please try again.',
	NETWORK_ERROR: 'Network error. Please check your connection and try again.',
} as const;

/**
 * Get error message by key
 */
export function getErrorMessage(key: keyof typeof ErrorMessages): string {
	return ErrorMessages[key];
}

/**
 * Create standardized error response
 */
export function createErrorResponse(message: string, code?: string, details?: unknown) {
	const response: any = {
		success: false,
		message,
		timestamp: new Date().toISOString(),
	};

	if (code) {
		response.code = code;
	}

	if (details) {
		response.details = details;
	}

	return response;
}

