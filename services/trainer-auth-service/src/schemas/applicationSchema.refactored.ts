import { z } from 'zod';

/**
 * ENTERPRISE-GRADE TRAINER APPLICATION SCHEMA
 * 
 * This schema implements:
 * 1. Legal compliance (dateOfBirth instead of age)
 * 2. Explicit consent checkboxes
 * 3. Raw location collection (no city/zone selection)
 * 4. Time range to slot conversion
 * 5. Max 3 courses enforcement
 * 6. Document verification pipeline
 */

// ============================================================================
// PERSONAL INFORMATION
// ============================================================================

const dateOfBirthSchema = z
	.coerce.date({
		required_error: 'Date of birth is required',
		invalid_type_error: 'Date of birth must be a valid date',
	})
	.refine(
		(date) => {
			const today = new Date();
			const age = today.getFullYear() - date.getFullYear();
			const monthDiff = today.getMonth() - date.getMonth();
			const dayDiff = today.getDate() - date.getDate();
			const actualAge = age - (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0) ? 1 : 0);
			return actualAge >= 18;
		},
		{
			message: 'You must be at least 18 years old to apply',
		}
	)
	.refine(
		(date) => {
			const today = new Date();
			const maxAge = 100;
			const age = today.getFullYear() - date.getFullYear();
			const monthDiff = today.getMonth() - date.getMonth();
			const dayDiff = today.getDate() - date.getDate();
			const actualAge = age - (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0) ? 1 : 0);
			return actualAge <= maxAge;
		},
		{
			message: 'Invalid date of birth',
		}
	);

// ============================================================================
// LOCATION SCHEMA (RAW - NO CITY/ZONE SELECTION)
// ============================================================================

const rawLocationSchema = z.object({
	address_text: z.string().max(500).min(1, {
		message: 'Street address is required',
	}),
	city: z.string().max(100).min(1, {
		message: 'City is required',
	}),
	state: z.string().max(100).min(1, {
		message: 'State is required',
	}),
	country: z.string().max(100).min(1, {
		message: 'Country is required',
	}),
	latitude: z.number().min(-90).max(90).optional().nullable(),
	longitude: z.number().min(-180).max(180).optional().nullable(),
	pincode: z.string().max(10).optional().nullable(),
});

// ============================================================================
// CONSENT SCHEMA (LEGAL REQUIREMENT)
// ============================================================================

const consentSchema = z.object({
	consentInfoCorrect: z.boolean().refine((val) => val === true, {
		message: 'You must confirm that all information is correct',
	}),
	consentBackgroundVerification: z.boolean().refine((val) => val === true, {
		message: 'You must consent to background verification',
	}),
	consentTravelToStudents: z.boolean().refine((val) => val === true, {
		message: 'You must agree to travel to student locations',
	}),
});

// ============================================================================
// TIME RANGE SCHEMA (FOR PART-TIME TRAINERS)
// ============================================================================

const timeRangeSchema = z.object({
	startTime: z.string().regex(/^([0-1][0-9]|2[0-1]):00$/, {
		message: 'Start time must be in HH:00 format (e.g., 18:00)',
	}),
	endTime: z.string().regex(/^([0-1][0-9]|2[0-1]):00$/, {
		message: 'End time must be in HH:00 format (e.g., 21:00)',
	}),
}).refine(
	(data) => {
		const startParts = data.startTime.split(':').map(Number);
		const endParts = data.endTime.split(':').map(Number);
		const startHour = startParts[0];
		const endHour = endParts[0];
		if (startHour === undefined || endHour === undefined) return false;
		return startHour >= 6 && endHour <= 21;
	},
	{
		message: 'Time range must be between 06:00 and 21:00',
		path: ['startTime'],
	}
).refine(
	(data) => {
		const startParts = data.startTime.split(':').map(Number);
		const endParts = data.endTime.split(':').map(Number);
		const startHour = startParts[0];
		const endHour = endParts[0];
		if (startHour === undefined || endHour === undefined) return false;
		return endHour > startHour;
	},
	{
		message: 'End time must be after start time',
		path: ['endTime'],
	}
).refine(
	(data) => {
		const startParts = data.startTime.split(':').map(Number);
		const endParts = data.endTime.split(':').map(Number);
		const startHour = startParts[0];
		const endHour = endParts[0];
		if (startHour === undefined || endHour === undefined) return false;
		return (endHour - startHour) >= 1;
	},
	{
		message: 'Time range must be at least 1 hour',
		path: ['endTime'],
	}
);

// ============================================================================
// AVAILABILITY SCHEMA
// Business Rule: ONLY full-time trainers with fixed shifts
// ============================================================================

const availabilitySchema = z.object({
	employmentType: z.literal('full-time', {
		required_error: 'Only full-time trainers are accepted',
		invalid_type_error: 'Only full-time trainers are accepted',
	}),
	shiftType: z.enum(['morning', 'evening'], {
		required_error: 'Shift selection is required',
		invalid_type_error: 'Shift must be either morning or evening',
	}),
	availableDays: z.array(z.string()).min(1, {
		message: 'At least one available day is required',
	}).refine(
		(days) => !days.includes('Sunday'),
		{
			message: 'Sunday is not allowed. Only Monday-Saturday are available.',
		}
	),
	// Not used for full-time trainers with fixed shifts
	timeRange: z.null().optional(),
});

// ============================================================================
// COURSES SCHEMA (MAX 3 ENFORCEMENT)
// ============================================================================

const coursesSchema = z
	.array(z.string().min(1).max(100))
	.min(1, {
		message: 'At least one course is required',
	})
	.max(3, {
		message: 'Maximum 3 courses allowed',
	});

// ============================================================================
// DOCUMENTS SCHEMA
// ============================================================================

const documentSchema = z.object({
	type: z.enum(['id_proof', 'qualification', 'experience_certificate', 'face_verification'], {
		required_error: 'Document type is required',
	}),
	fileUrl: z.string().url({
		message: 'Document file URL must be a valid URL',
	}),
	fileName: z.string().optional().nullable(),
	metadata: z.record(z.any()).optional().nullable(),
});

const documentsSchema = z
	.array(documentSchema)
	.refine(
		(docs) => {
			const hasIdProof = docs.some((d) => d.type === 'id_proof');
			const hasFaceVerification = docs.some((d) => d.type === 'face_verification');
			const hasQualification = docs.some((d) => d.type === 'qualification');
			return hasIdProof && hasFaceVerification && hasQualification;
		},
		{
			message: 'ID proof, face verification, and qualification certificate are required',
		}
	);

// ============================================================================
// MAIN APPLICATION SCHEMA
// ============================================================================

export const trainerApplicationSchemaRefactored = z.object({
	// Personal Information
	fullName: z.string().min(2).max(150, {
		message: 'Full name must be between 2 and 150 characters',
	}),
	dateOfBirth: dateOfBirthSchema,
	gender: z.enum(['male', 'female', 'other'], {
		required_error: 'Gender is required',
	}),
	phone: z.string().trim().min(6).max(15, {
		message: 'Phone number must be between 6 and 15 characters',
	}),
	email: z.string().email({
		message: 'Invalid email address',
	}),

	// Location (Raw - No City/Zone Selection)
	location: rawLocationSchema,

	// Education
	education: z.string().max(100).optional().nullable(),
	qualification: z.string().min(2).max(150, {
		message: 'Qualification is required',
	}),
	university: z.string().max(200).optional().nullable(),
	graduationYear: z.coerce.number().int().min(1950).max(new Date().getFullYear() + 5).optional().nullable(),

	// Experience
	experienceYears: z.coerce.number().int().min(0).max(80, {
		message: 'Experience years must be between 0 and 80',
	}),
	previousEmployer: z.string().max(200).optional().nullable(),
	teachingExperience: z.string().max(2000).optional().nullable(),

	// Professional
	courses: coursesSchema, // Max 3 enforced
	skills: z.array(z.string().min(2).max(100)).optional().nullable(), // Will be normalized
	bio: z.string().min(20).max(2000).optional().nullable(),
	languages: z.array(z.string().min(2).max(40)).optional().nullable(),
	certifications: z.array(z.string().min(2).max(150)).optional().nullable(),

	// Availability
	availability: availabilitySchema,

	// Documents
	documents: documentsSchema,

	// Consent (Legal Requirement)
	consents: consentSchema,

	// References (Optional)
	references: z
		.array(
			z.object({
				name: z.string().min(2).max(150),
				phone: z.string().min(6).max(15),
				email: z.string().email().optional().nullable(),
			})
		)
		.optional()
		.nullable(),

	// Preferred Working City
	preferredWorkingCity: z.string().min(2).max(100, {
		message: 'Preferred working city is required',
	}),

	// Other
	whyJoin: z.string().max(2000).optional().nullable(),
	additionalInfo: z.string().max(2000).optional().nullable(),
});

export type TrainerApplicationInputRefactored = z.infer<typeof trainerApplicationSchemaRefactored>;

/**
 * Helper function to calculate age from date of birth
 */
export function calculateAge(dateOfBirth: Date): number {
	const today = new Date();
	const age = today.getFullYear() - dateOfBirth.getFullYear();
	const monthDiff = today.getMonth() - dateOfBirth.getMonth();
	const dayDiff = today.getDate() - dateOfBirth.getDate();
	return age - (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0) ? 1 : 0);
}

/**
 * Helper function to convert time range to 1-hour slots
 * Input: { startTime: "18:00", endTime: "21:00" }
 * Output: [
 *   { slot_start: "18:00:00", slot_end: "19:00:00" },
 *   { slot_start: "19:00:00", slot_end: "20:00:00" },
 *   { slot_start: "20:00:00", slot_end: "21:00:00" }
 * ]
 */
export function convertTimeRangeToSlots(startTime: string, endTime: string): Array<{ slot_start: string; slot_end: string }> {
	const startParts = startTime.split(':').map(Number);
	const endParts = endTime.split(':').map(Number);
	const startHour = startParts[0];
	const endHour = endParts[0];
	
	if (startHour === undefined || endHour === undefined) {
		throw new Error('Invalid time format');
	}
	
	const slots: Array<{ slot_start: string; slot_end: string }> = [];
	
	for (let hour = startHour; hour < endHour; hour++) {
		const slotStart = `${hour.toString().padStart(2, '0')}:00:00`;
		const slotEnd = `${(hour + 1).toString().padStart(2, '0')}:00:00`;
		slots.push({ slot_start: slotStart, slot_end: slotEnd });
	}
	
	return slots;
}

/**
 * Helper function to generate full-time slots (08:00-20:00)
 */
export function generateFullTimeSlots(): Array<{ slot_start: string; slot_end: string }> {
	return convertTimeRangeToSlots('08:00', '20:00');
}

/**
 * Helper function to normalize skill names
 * - lowercase
 * - trim
 * - map to predefined tags where possible
 */
export function normalizeSkill(skill: string): string {
	return skill.trim().toLowerCase();
}

