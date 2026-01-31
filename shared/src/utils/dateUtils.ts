/**
 * Date utility functions
 * Shared across backend services
 */

/**
 * Check if a date is a Sunday holiday
 * Business rule: Every Sunday is a holiday until July 31st
 * After July 31st, Sundays are allowed (for Sunday-only courses)
 * 
 * @param date - Date to check (Date object or date string)
 * @returns true if the date is a Sunday before July 31st, false otherwise
 */
export function isSundayHoliday(date: Date | string): boolean {
	let dateObj: Date;
	
	if (typeof date === 'string') {
		// Parse date string (handle both ISO and YYYY-MM-DD formats)
		if (date.includes('T')) {
			dateObj = new Date(date);
		} else {
			// YYYY-MM-DD format - parse as local date
			const parts = date.split('-');
			if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
				const year = parseInt(parts[0], 10);
				const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
				const day = parseInt(parts[2], 10);
				dateObj = new Date(year, month, day);
			} else {
				dateObj = new Date(date);
			}
		}
	} else {
		dateObj = date;
	}
	
	// Check if date is valid
	if (isNaN(dateObj.getTime())) {
		return false;
	}
	
	// Check if it's a Sunday (0 = Sunday in JavaScript)
	const dayOfWeek = dateObj.getDay();
	if (dayOfWeek !== 0) {
		return false; // Not a Sunday
	}
	
	// Check if date is before or on July 31st of the current year
	// Compare year and month/day
	const year = dateObj.getFullYear();
	const month = dateObj.getMonth(); // 0-indexed (0 = January, 6 = July)
	const day = dateObj.getDate();
	const currentYear = new Date().getFullYear();
	
	// If the date is in a past year, it's not a current holiday
	// If the date is in a future year, it's not a current holiday
	if (year !== currentYear) {
		return false;
	}
	
	// July is month 6 (0-indexed)
	// If month is before July (0-5), it's a holiday
	// If month is July (6) and day <= 31, it's a holiday
	// If month is after July (7-11), it's NOT a holiday
	if (month < 6) {
		return true; // Before July
	} else if (month === 6 && day <= 31) {
		return true; // July 31st or earlier
	} else {
		return false; // After July 31st
	}
}

/**
 * Check if a date should be skipped for session creation
 * This includes Sunday holidays and any other business rules
 * 
 * @param date - Date to check
 * @returns true if the date should be skipped, false otherwise
 */
export function shouldSkipDateForSessions(date: Date | string): boolean {
	return isSundayHoliday(date);
}

