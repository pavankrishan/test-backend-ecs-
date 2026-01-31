import { AppError } from '@kodingcaravan/shared';
import { Pool, PoolClient } from 'pg';
import { findTrainerByEmail, findTrainerByPhone, createTrainer, updateTrainerAccount, findTrainerById } from '../models/trainerAuth.model';
import { getTrainerProfile } from '../models/trainerAuth.model';
import { withTransaction, getPool } from '../config/database';
import type { TrainerApplicationInputRefactored } from '../schemas/applicationSchema.refactored';

/**
 * Retry wrapper for database operations that may fail due to transient connection errors
 */
async function retryDatabaseOperation<T>(
	operation: () => Promise<T>,
	maxRetries: number = 3,
	operationName: string = 'Database operation'
): Promise<T> {
	let lastError: Error | null = null;
	
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await operation();
		} catch (error: any) {
			lastError = error instanceof Error ? error : new Error(String(error));
			
			// Check if it's a transient connection error
			const isConnectionError = 
				lastError.message?.includes('Connection terminated') ||
				lastError.message?.includes('ECONNRESET') ||
				lastError.message?.includes('ECONNREFUSED') ||
				lastError.message?.includes('not queryable') ||
				(error?.code === 'ECONNRESET') ||
				(error?.code === 'ECONNREFUSED');
			
			if (attempt < maxRetries && isConnectionError) {
				const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
				if (process.env.NODE_ENV !== 'production') {
					console.log(`[${operationName}] Connection error on attempt ${attempt}/${maxRetries}, retrying in ${delay}ms...`);
				}
				await new Promise((resolve) => setTimeout(resolve, delay));
				continue;
			}
			
			// Non-connection error or final attempt failed
			throw lastError;
		}
	}
	
	throw lastError || new Error(`${operationName} failed after ${maxRetries} attempts`);
}
import {
	calculateAge,
	convertTimeRangeToSlots,
	generateFullTimeSlots,
	normalizeSkill,
} from '../schemas/applicationSchema.refactored';

/**
 * ENTERPRISE-GRADE TRAINER APPLICATION SERVICE
 * 
 * This service implements:
 * 1. Legal compliance validation (age >= 18 from DOB)
 * 2. Raw location storage (no city/zone assignment)
 * 3. Time range to slot conversion
 * 4. Max 3 courses enforcement
 * 5. Document verification pipeline
 */

function normalizePhone(phone: string): string {
	return phone.replace(/\D/g, '');
}

/**
 * Process trainer application with enterprise-grade validation
 */
export async function processTrainerApplicationRefactored(
	input: TrainerApplicationInputRefactored,
	pool: Pool
): Promise<{
	trainerId: string;
	status: 'created' | 'updated';
	message: string;
	applicationId: string;
}> {
	// ========================================================================
	// STEP 1: VALIDATE LEGAL REQUIREMENTS
	// ========================================================================
	
	const age = calculateAge(input.dateOfBirth);
	if (age < 18) {
		throw new AppError('You must be at least 18 years old to apply', 400);
	}
	
	// Verify all consents are accepted
	if (!input.consents.consentInfoCorrect || 
	    !input.consents.consentBackgroundVerification || 
	    !input.consents.consentTravelToStudents) {
		throw new AppError('All consent checkboxes must be accepted', 400);
	}
	
	// ========================================================================
	// STEP 2: NORMALIZE PHONE AND FIND/CREATE TRAINER
	// ========================================================================
	
	const normalizedPhone = input.phone ? normalizePhone(input.phone) : null;
	
	// Use retry wrapper for database queries that may fail due to connection issues
	let trainer = await retryDatabaseOperation(
		() => findTrainerByEmail(input.email),
		3,
		'findTrainerByEmail'
	);
	const exists = !!trainer;
	
	if (!trainer) {
		// Check if phone is already registered
		if (normalizedPhone) {
			const phoneTrainer = await retryDatabaseOperation(
				() => findTrainerByPhone(normalizedPhone),
				3,
				'findTrainerByPhone'
			);
			if (phoneTrainer) {
				// Use existing trainer and update email
				trainer = phoneTrainer;
				await updateTrainerAccount(trainer.id, {
					email: input.email,
					isEmailVerified: false,
				});
			} else {
				// Create new trainer
				try {
					trainer = await createTrainer({
						email: input.email,
						phone: normalizedPhone,
						username: input.email.split('@')[0] || null,
					});
				} catch (error: any) {
					// Handle database constraint violations
					if (error?.code === '23505') { // PostgreSQL unique constraint violation
						const constraint = error?.constraint || '';
						if (constraint.includes('phone') || error?.detail?.includes('phone')) {
							throw new AppError('This phone number is already registered. Please use a different phone number or contact support if this is your number.', 409);
						} else if (constraint.includes('email') || error?.detail?.includes('email')) {
							throw new AppError('This email is already registered. Please use a different email or contact support.', 409);
						}
					}
					throw error;
				}
			}
		} else {
			// Create new trainer without phone
			try {
				trainer = await createTrainer({
					email: input.email,
					phone: normalizedPhone,
					username: input.email.split('@')[0] || null,
				});
			} catch (error: any) {
				// Handle database constraint violations
				if (error?.code === '23505') { // PostgreSQL unique constraint violation
					const constraint = error?.constraint || '';
					if (constraint.includes('email') || error?.detail?.includes('email')) {
						throw new AppError('This email is already registered. Please use a different email or contact support.', 409);
					}
				}
				throw error;
			}
		}
	} else {
		// Trainer exists - update phone if different
		const existingPhoneNormalized = trainer.phone ? normalizePhone(trainer.phone) : null;
		if (normalizedPhone && existingPhoneNormalized !== normalizedPhone) {
			// Check if the new phone number is already taken by another trainer
			const phoneTrainer = await findTrainerByPhone(normalizedPhone);
			if (phoneTrainer && phoneTrainer.id !== trainer.id) {
				console.log(`[Application Service] Phone ${normalizedPhone} already exists for trainer ${phoneTrainer.id}, current trainer is ${trainer.id}`);
				
				// Check if the phone-based trainer has an application
				const phoneTrainerProfile = await getTrainerProfile(phoneTrainer.id);
				const hasApplication = phoneTrainerProfile?.extra?.applicationSubmitted === true;
				
				if (hasApplication) {
					// Phone is registered to another trainer with an application - cannot transfer
					throw new AppError('This phone number is already registered to another trainer with a submitted application. Please use a different phone number or contact support.', 409);
				}
				
				// Phone exists but no application - this is likely from phone OTP verification
				// Transfer the phone from the phone-based trainer to the email-based trainer
				console.log(`[Application Service] Phone ${normalizedPhone} exists on trainer ${phoneTrainer.id} but no application. Transferring phone to email-based trainer ${trainer.id}.`);
				
				await withTransaction(async (client: PoolClient) => {
					// First, clear the phone from the phone-based trainer
					await updateTrainerAccount(phoneTrainer.id, { 
						phone: null,
						isPhoneVerified: false
					}, client);
					
					// Then, update the email-based trainer with the phone
					if (trainer) {
						await updateTrainerAccount(trainer.id, { 
							phone: normalizedPhone,
							isPhoneVerified: false // Reset verification when phone changes
						}, client);
					}
				});
				
				// Refresh trainer object to get updated phone number
				if (trainer) {
					const refreshedTrainer = await retryDatabaseOperation(
						() => findTrainerById(trainer!.id),
						3,
						'findTrainerById'
					);
					if (refreshedTrainer) {
						trainer = refreshedTrainer;
					}
				}
			} else {
				// Phone is either not registered or registered to this same trainer - safe to update
				try {
					await updateTrainerAccount(trainer.id, {
						phone: normalizedPhone,
						isPhoneVerified: false,
					});
				} catch (error: any) {
					// Handle database constraint violations (fallback in case of race condition)
					if (error?.code === '23505') { // PostgreSQL unique constraint violation
						const constraint = error?.constraint || '';
						if (constraint.includes('phone') || error?.detail?.includes('phone')) {
							console.log(`[Application Service] Phone ${normalizedPhone} constraint violation during update for trainer ${trainer.id}`);
							throw new AppError('This phone number is already registered. Please use a different phone number or contact support if this is your number.', 409);
						}
					}
					throw error;
				}
			}
		}
	}
	
	// ========================================================================
	// STEP 3: STORE APPLICATION IN trainer_applications TABLE
	// ========================================================================
	
	return await withTransaction(async (client: PoolClient) => {
		// Insert or update application
		const applicationResult = await client.query(
			`
				INSERT INTO trainer_applications (
					trainer_id,
					date_of_birth,
					gender,
					address_text,
					latitude,
					longitude,
					pincode,
					consent_info_correct,
					consent_background_verification,
					consent_travel_to_students,
					application_stage,
					submitted_at
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
				ON CONFLICT (trainer_id) DO UPDATE SET
					date_of_birth = EXCLUDED.date_of_birth,
					gender = EXCLUDED.gender,
					address_text = EXCLUDED.address_text,
					latitude = EXCLUDED.latitude,
					longitude = EXCLUDED.longitude,
					pincode = EXCLUDED.pincode,
					consent_info_correct = EXCLUDED.consent_info_correct,
					consent_background_verification = EXCLUDED.consent_background_verification,
					consent_travel_to_students = EXCLUDED.consent_travel_to_students,
					application_stage = EXCLUDED.application_stage,
					submitted_at = EXCLUDED.submitted_at,
					updated_at = NOW()
				RETURNING id
			`,
			[
				trainer.id,
				input.dateOfBirth,
				input.gender,
				input.location.address_text || null,
				input.location.latitude || null,
				input.location.longitude || null,
				input.location.pincode || null,
				input.consents.consentInfoCorrect,
				input.consents.consentBackgroundVerification,
				input.consents.consentTravelToStudents,
				'submitted',
				new Date(),
			]
		);
		
		const applicationId = applicationResult.rows[0].id;
		
		// ====================================================================
		// STEP 4: STORE DOCUMENTS
		// ====================================================================
		
		for (const doc of input.documents) {
			await client.query(
				`
					INSERT INTO trainer_documents (
						trainer_id,
						application_id,
						document_type,
						file_url,
						file_name,
						verification_status,
						metadata
					) VALUES ($1, $2, $3, $4, $5, $6, $7)
				`,
				[
					trainer.id,
					applicationId,
					doc.type,
					doc.fileUrl,
					doc.fileName || null,
					'pending',
					doc.metadata || null,
				]
			);
		}
		
		// ====================================================================
		// STEP 5: STORE COURSES (Max 3 enforced by schema)
		// ====================================================================
		// IMPORTANT: Only reference existing courses from the courses table.
		// Trainers must select from the predefined courses provided by the platform.
		// Do NOT create new courses - this would cause duplicates.
		
		// Delete existing courses for this application first (to handle updates)
		// This ensures we can update the course selection without constraint violations
		await client.query(
			`DELETE FROM trainer_application_courses WHERE trainer_application_id = $1`,
			[applicationId]
		);
		
		for (let i = 0; i < input.courses.length; i++) {
			const courseCode = input.courses[i];
			const preferenceOrder = i + 1; // 1-based ordering
			
			// Check which columns exist in courses table
			const columnCheck = await client.query(
				`SELECT 
					EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'courses' AND column_name = 'name') as has_name,
					EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'courses' AND column_name = 'title') as has_title
				`
			);
			const hasName = columnCheck.rows[0]?.has_name;
			const hasTitle = columnCheck.rows[0]?.has_title;
			
			// Build query to find course by code, name, or title (case-insensitive)
			// Handle NULL values in code column properly
			let findQuery: string;
			if (hasName && hasTitle) {
				findQuery = `SELECT id FROM courses WHERE ((code IS NOT NULL AND UPPER(code) = UPPER($1)) OR UPPER(name) = UPPER($1) OR UPPER(title) = UPPER($1)) AND is_active = true LIMIT 1`;
			} else if (hasName) {
				findQuery = `SELECT id FROM courses WHERE ((code IS NOT NULL AND UPPER(code) = UPPER($1)) OR UPPER(name) = UPPER($1)) AND is_active = true LIMIT 1`;
			} else if (hasTitle) {
				findQuery = `SELECT id FROM courses WHERE ((code IS NOT NULL AND UPPER(code) = UPPER($1)) OR UPPER(title) = UPPER($1)) AND is_active = true LIMIT 1`;
			} else {
				findQuery = `SELECT id FROM courses WHERE code IS NOT NULL AND UPPER(code) = UPPER($1) AND is_active = true LIMIT 1`;
			}
			
			const courseResult = await client.query(findQuery, [courseCode]);
			
			if (courseResult.rows.length === 0) {
				// Get actual available courses from database for error message
				// Use a separate query to get available courses (prioritize title)
				let availableCoursesQuery: string;
				if (hasName && hasTitle) {
					availableCoursesQuery = `SELECT COALESCE(title, name, code) as display_name FROM courses WHERE is_active = true ORDER BY COALESCE(title, name, code) ASC`;
				} else if (hasName) {
					availableCoursesQuery = `SELECT COALESCE(name, code) as display_name FROM courses WHERE is_active = true ORDER BY COALESCE(name, code) ASC`;
				} else if (hasTitle) {
					availableCoursesQuery = `SELECT COALESCE(title, code) as display_name FROM courses WHERE is_active = true ORDER BY COALESCE(title, code) ASC`;
				} else {
					availableCoursesQuery = `SELECT code as display_name FROM courses WHERE is_active = true AND code IS NOT NULL ORDER BY code ASC`;
				}
				
				const availableCoursesResult = await client.query(availableCoursesQuery);
				const courseNames = availableCoursesResult.rows.map((row: any) => row.display_name).filter(Boolean);
				const courseList = courseNames.length > 0 
					? courseNames.join(', ')
					: 'No active courses available';
				
				throw new AppError(
					`Course "${courseCode}" is not available. Please select from the provided courses: ${courseList}.`,
					400
				);
			}
			
			const courseId = courseResult.rows[0].id;
			
			// Store course selection in trainer_application_courses table (application phase)
			// This will be copied to trainer_courses upon approval
			await client.query(
				`
					INSERT INTO trainer_application_courses (
						trainer_application_id,
						course_id,
						preference_order
					) VALUES ($1, $2, $3)
					ON CONFLICT (trainer_application_id, course_id) DO UPDATE SET
						preference_order = EXCLUDED.preference_order
				`,
				[applicationId, courseId, preferenceOrder]
			);
		}
		
		// ====================================================================
		// STEP 6: STORE SKILLS (Normalized)
		// ====================================================================
		// IMPORTANT: Store skills in trainer_application_skills during application phase.
		// Skills will be copied to trainer_skills upon approval.
		
		if (input.skills && input.skills.length > 0) {
			for (const skillName of input.skills) {
				const normalizedSkillName = normalizeSkill(skillName);
				
				// Find or create skill
				const skillResult = await client.query(
					`SELECT id FROM skills WHERE name = $1 LIMIT 1`,
					[normalizedSkillName]
				);
				
				let skillId: string;
				if (skillResult.rows.length > 0) {
					skillId = skillResult.rows[0].id;
				} else {
					// Create skill if it doesn't exist (skills can be user-defined)
					const newSkillResult = await client.query(
						`
							INSERT INTO skills (name, is_active)
							VALUES ($1, true)
							RETURNING id
						`,
						[normalizedSkillName]
					);
					skillId = newSkillResult.rows[0].id;
				}
				
				// Store skill selection in trainer_application_skills table (application phase)
				// This will be copied to trainer_skills upon approval
				await client.query(
					`
						INSERT INTO trainer_application_skills (
							trainer_application_id,
							skill_id
						) VALUES ($1, $2)
						ON CONFLICT (trainer_application_id, skill_id) DO NOTHING
					`,
					[applicationId, skillId]
				);
			}
		}
		
		// ====================================================================
		// STEP 7: CREATE TRAINER SHIFT AND GENERATE AVAILABILITY SLOTS
		// Business Rule: Only full-time trainers with fixed shifts
		// ====================================================================
		
		// Validate shift type is provided
		if (!input.availability.shiftType) {
			throw new AppError('Shift selection is required. Must be either morning or evening.', 400);
		}
		
		// Validate employment type is full-time
		if (input.availability.employmentType !== 'full-time') {
			throw new AppError('Only full-time trainers are accepted', 400);
		}
		
		// Validate Sunday is not in available days
		if (input.availability.availableDays.includes('Sunday')) {
			throw new AppError('Sunday is not allowed. Only Monday-Saturday are available.', 400);
		}
		
		// Determine shift times based on shift type
		const shiftStart = input.availability.shiftType === 'morning' ? '06:00:00' : '12:00:00';
		const shiftEnd = input.availability.shiftType === 'morning' ? '14:00:00' : '20:00:00';
		
		// Create or update trainer_shifts record
		await client.query(
			`
				INSERT INTO trainer_shifts (
					trainer_id,
					shift_type,
					shift_start,
					shift_end,
					is_active
				) VALUES ($1, $2, $3, $4, $5)
				ON CONFLICT (trainer_id) DO UPDATE SET
					shift_type = EXCLUDED.shift_type,
					shift_start = EXCLUDED.shift_start,
					shift_end = EXCLUDED.shift_end,
					changed_at = NOW(),
					updated_at = NOW()
			`,
			[
				trainer.id,
				input.availability.shiftType,
				shiftStart,
				shiftEnd,
				true, // is_active
			]
		);
		
		// Use database function to generate availability slots from shift
		// This ensures consistency with business rules
		await client.query(
			`SELECT generate_trainer_availability_from_shift($1, $2)`,
			[trainer.id, input.availability.shiftType]
		);
		
		// ====================================================================
		// STEP 8: UPDATE TRAINER PROFILE (Legacy fields for compatibility)
		// ====================================================================
		
		// Store additional data in trainer_profiles for backward compatibility
		// Note: This is temporary until all systems migrate to new schema
		// Get existing extra field to merge with new data
		const existingProfile = await getTrainerProfile(trainer.id, client);
		const existingExtra = existingProfile?.extra && typeof existingProfile.extra === 'object' 
			? existingProfile.extra as Record<string, unknown>
			: {};
		
		// Merge existing extra with application submission flags
		const updatedExtra = {
			...existingExtra,
			applicationSubmitted: true,
			applicationSubmittedAt: new Date().toISOString(),
		};
		
		await client.query(
			`
				INSERT INTO trainer_profiles (
					trainer_id,
					full_name,
					bio,
					specialties,
					years_of_experience,
					preferred_languages,
					certifications,
					availability,
					extra
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
				ON CONFLICT (trainer_id) DO UPDATE SET
					full_name = EXCLUDED.full_name,
					bio = EXCLUDED.bio,
					specialties = EXCLUDED.specialties,
					years_of_experience = EXCLUDED.years_of_experience,
					preferred_languages = EXCLUDED.preferred_languages,
					certifications = EXCLUDED.certifications,
					availability = EXCLUDED.availability,
					extra = EXCLUDED.extra,
					updated_at = NOW()
			`,
			[
				trainer.id,
				input.fullName,
				input.bio || null,
				input.courses, // Array
				input.experienceYears,
				input.languages || null,
				input.certifications || null,
				JSON.stringify({
					days: input.availability.availableDays,
					employmentType: input.availability.employmentType,
					shiftType: input.availability.shiftType,
				}),
				JSON.stringify(updatedExtra),
			]
		);
		
		return {
			trainerId: trainer.id,
			status: exists ? 'updated' : 'created',
			message: exists
				? 'Trainer application updated successfully. Awaiting admin review.'
				: 'Trainer application created successfully. Awaiting admin review.',
			applicationId,
		};
	});
}

/**
 * Get application preview slots (for frontend display)
 * Generates slots based on shift type (Business Rule: Only full-time with fixed shifts)
 */
export function getAvailabilityPreview(
	shiftType: 'morning' | 'evening'
): Array<{ start: string; end: string; display: string }> {
	let slots: Array<{ slot_start: string; slot_end: string }>;
	
	if (shiftType === 'morning') {
		// Morning Shift: 6 AM - 2 PM (8 slots: 6-7, 7-8, ..., 13-14)
		slots = convertTimeRangeToSlots('06:00', '14:00');
	} else if (shiftType === 'evening') {
		// Evening Shift: 12 PM - 8 PM (8 slots: 12-13, 13-14, ..., 19-20)
		slots = convertTimeRangeToSlots('12:00', '20:00');
	} else {
		return [];
	}
	
	return slots.map((slot) => {
		const startParts = slot.slot_start.split(':').map(Number);
		const endParts = slot.slot_end.split(':').map(Number);
		const startHour = startParts[0];
		const endHour = endParts[0];
		
		if (startHour === undefined || endHour === undefined) {
			return {
				start: slot.slot_start,
				end: slot.slot_end,
				display: `${slot.slot_start} – ${slot.slot_end}`,
			};
		}
		
		const formatTime = (hour: number): string => {
			if (hour === 0) return '12:00 AM';
			if (hour < 12) return `${hour}:00 AM`;
			if (hour === 12) return '12:00 PM';
			return `${hour - 12}:00 PM`;
		};
		
		return {
			start: slot.slot_start,
			end: slot.slot_end,
			display: `${formatTime(startHour)} – ${formatTime(endHour)}`,
		};
	});
}

/**
 * Get available active courses for trainer application
 * Returns courses that are active in the database
 * First tries local courses table, then falls back to course-service API
 */
export async function getAvailableCourses(pool: Pool): Promise<Array<{ id: string; name: string; title: string | null; code: string | null }>> {
	const client = await pool.connect();
	try {
		// Check which columns exist in courses table
		const columnCheck = await client.query(
			`SELECT 
				EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'courses' AND column_name = 'name') as has_name,
				EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'courses' AND column_name = 'title') as has_title
			`
		);
		const hasName = columnCheck.rows[0]?.has_name;
		const hasTitle = columnCheck.rows[0]?.has_title;

		// Build query based on available columns
		let query: string;
		if (hasName && hasTitle) {
			query = `SELECT id, name, title, code FROM courses WHERE is_active = true ORDER BY COALESCE(name, title, code) ASC`;
		} else if (hasName) {
			query = `SELECT id, name, NULL as title, code FROM courses WHERE is_active = true ORDER BY COALESCE(name, code) ASC`;
		} else if (hasTitle) {
			query = `SELECT id, NULL as name, title, code FROM courses WHERE is_active = true ORDER BY COALESCE(title, code) ASC`;
		} else {
			query = `SELECT id, NULL as name, NULL as title, code FROM courses WHERE is_active = true AND code IS NOT NULL ORDER BY code ASC`;
		}

		if (process.env.NODE_ENV !== 'production') {
			console.log('[getAvailableCourses] Query:', query);
			console.log('[getAvailableCourses] Has name:', hasName, 'Has title:', hasTitle);
		}

		const result = await client.query(query);
		
		if (process.env.NODE_ENV !== 'production') {
			console.log('[getAvailableCourses] Found courses in local DB:', result.rows.length);
			console.log('[getAvailableCourses] Raw rows:', JSON.stringify(result.rows, null, 2));
		}

		// If we found courses locally, return them
		if (result.rows.length > 0) {
			const courses = result.rows.map((row) => {
				const courseName = row.name || row.title || row.code || '';
				return {
					id: row.id,
					name: courseName,
					title: row.title || null,
					code: row.code || null,
				};
			});

			if (process.env.NODE_ENV !== 'production') {
				console.log('[getAvailableCourses] Processed courses:', JSON.stringify(courses, null, 2));
			}

			return courses;
		}

		// If no courses found locally, try to fetch from course-service
		if (process.env.NODE_ENV !== 'production') {
			console.log('[getAvailableCourses] No courses in local DB, trying course-service API...');
		}

		try {
			const courseServiceUrl = process.env.COURSE_SERVICE_URL || 
				`http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.COURSE_SERVICE_PORT || 3005}`;
			const axios = (await import('axios')).default;

			const courseResponse = await axios.get(`${courseServiceUrl}/api/courses`, {
				params: {
					isActive: 'true',
					status: 'published',
					limit: 100,
				},
				timeout: 5000,
			});

			const courseData = courseResponse.data?.data?.courses || courseResponse.data?.courses || courseResponse.data || [];
			
			if (process.env.NODE_ENV !== 'production') {
				console.log('[getAvailableCourses] Course service response:', JSON.stringify(courseData, null, 2));
			}

			if (Array.isArray(courseData) && courseData.length > 0) {
				const courses = courseData.map((course: any) => ({
					id: course.id,
					name: course.name || course.title || course.category || '',
					title: course.title || null,
					code: course.code || course.category || null,
				})).filter((c: any) => c.name);

				if (process.env.NODE_ENV !== 'production') {
					console.log('[getAvailableCourses] Processed courses from service:', JSON.stringify(courses, null, 2));
				}

				return courses;
			}
		} catch (serviceError: any) {
			if (process.env.NODE_ENV !== 'production') {
				console.warn('[getAvailableCourses] Failed to fetch from course-service:', serviceError.message);
			}
			// Continue to return empty array if service call fails
		}

		// Return empty array if no courses found
		if (process.env.NODE_ENV !== 'production') {
			console.warn('[getAvailableCourses] No courses found in local DB or course-service');
		}
		return [];
	} catch (error: any) {
		console.error('[getAvailableCourses] Error:', error);
		throw error;
	} finally {
		client.release();
	}
}

