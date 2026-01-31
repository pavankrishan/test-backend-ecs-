/**
 * Type Guard Utilities
 * Safe type checking functions
 */

/**
 * Check if value is a record (object, not array, not null)
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Check if value is a string
 */
export function isString(value: unknown): value is string {
	return typeof value === 'string';
}

/**
 * Check if value is a number
 */
export function isNumber(value: unknown): value is number {
	return typeof value === 'number' && !isNaN(value);
}

/**
 * Check if value is a boolean
 */
export function isBoolean(value: unknown): value is boolean {
	return typeof value === 'boolean';
}

/**
 * Check if value is an array
 */
export function isArray(value: unknown): value is unknown[] {
	return Array.isArray(value);
}

/**
 * Check if value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
	return isString(value) && value.trim().length > 0;
}

/**
 * Check if value is a valid UUID
 */
export function isUUID(value: unknown): value is string {
	if (!isString(value)) {
		return false;
	}
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	return uuidRegex.test(value);
}

/**
 * Check if value is a valid email
 */
export function isEmail(value: unknown): value is string {
	if (!isString(value)) {
		return false;
	}
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	return emailRegex.test(value);
}

/**
 * Check if value is a valid phone number (basic check)
 */
export function isPhoneNumber(value: unknown): value is string {
	if (!isString(value)) {
		return false;
	}
	// Remove non-digits and check length
	const digits = value.replace(/\D/g, '');
	return digits.length >= 10 && digits.length <= 15;
}

