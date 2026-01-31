/**
 * Purchase Validator Service
 * Validates course purchase combinations and business rules
 */

import type { ClassType, DeliveryMode, StudentDetail } from '../models/coursePurchase.model';

export interface ValidationResult {
	isValid: boolean;
	errorCode?: 'INVALID_PURCHASE';
	message?: string;
}

export class PurchaseValidatorService {
	/**
	 * Validate purchase input
	 */
	validatePurchase(
		classType: ClassType,
		totalSessions: 10 | 20 | 30,
		deliveryMode: DeliveryMode,
		students: StudentDetail[]
	): ValidationResult {
		// Rule 1: HYBRID must have exactly 30 sessions
		if (classType === 'HYBRID' && totalSessions !== 30) {
			return {
				isValid: false,
				errorCode: 'INVALID_PURCHASE',
				message: 'HYBRID class type requires exactly 30 sessions',
			};
		}

		// Rule 2: SUNDAY_ONLY must have even number of sessions (2 sessions per Sunday)
		if (deliveryMode === 'SUNDAY_ONLY' && totalSessions % 2 !== 0) {
			return {
				isValid: false,
				errorCode: 'INVALID_PURCHASE',
				message: 'SUNDAY_ONLY delivery mode requires an even number of sessions',
			};
		}

		// Rule 3: ONE_ON_TWO must have exactly 2 students
		if (classType === 'ONE_ON_TWO' && students.length !== 2) {
			return {
				isValid: false,
				errorCode: 'INVALID_PURCHASE',
				message: 'ONE_ON_TWO class type requires exactly 2 students',
			};
		}

		// Rule 4: ONE_ON_THREE must have exactly 3 students
		if (classType === 'ONE_ON_THREE' && students.length !== 3) {
			return {
				isValid: false,
				errorCode: 'INVALID_PURCHASE',
				message: 'ONE_ON_THREE class type requires exactly 3 students',
			};
		}

		// Rule 5: ONE_ON_ONE must have exactly 1 student
		if (classType === 'ONE_ON_ONE' && students.length !== 1) {
			return {
				isValid: false,
				errorCode: 'INVALID_PURCHASE',
				message: 'ONE_ON_ONE class type requires exactly 1 student',
			};
		}

		// Rule 6: Session count must be 10, 20, or 30
		if (![10, 20, 30].includes(totalSessions)) {
			return {
				isValid: false,
				errorCode: 'INVALID_PURCHASE',
				message: 'Total sessions must be 10, 20, or 30',
			};
		}

		return { isValid: true };
	}
}

