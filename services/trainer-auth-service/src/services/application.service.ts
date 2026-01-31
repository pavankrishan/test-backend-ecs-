import { AppError } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';
import { findTrainerByEmail, findTrainerByPhone, createTrainer, upsertTrainerProfile, updateTrainerAccount, getTrainerProfile } from '../models/trainerAuth.model';
import { withTransaction } from '../config/database';
import type { TrainerApplicationInput } from '../schemas/applicationSchema';

function normalizePhone(phone: string): string {
	return phone.replace(/\D/g, '');
}

/**
 * Process trainer application
 * This creates/updates trainer account and profile with all application data
 */
export async function processTrainerApplication(input: TrainerApplicationInput): Promise<{
	trainerId: string;
	status: 'created' | 'updated';
	message: string;
}> {
	// 1. Normalize phone number
	const normalizedPhone = input.phone ? normalizePhone(input.phone) : null;
	logger.info('Processing trainer application', {
		email: input.email.substring(0, 3) + '***',
		hasPhone: !!normalizedPhone,
		service: 'trainer-auth-service',
	});
	
	// 2. Check if trainer already exists by email
	let trainer = await findTrainerByEmail(input.email);
	const exists = !!trainer;
	logger.debug('Trainer lookup by email', {
		email: input.email.substring(0, 3) + '***',
		trainerId: trainer?.id,
		exists,
		service: 'trainer-auth-service',
	});

	if (!trainer) {
		// Check if phone is already registered to another trainer
		if (normalizedPhone) {
			logger.debug('Checking for existing phone', {
				phone: normalizedPhone.substring(0, 4) + '****',
				service: 'trainer-auth-service',
			});
			const phoneTrainer = await findTrainerByPhone(normalizedPhone);
			logger.debug('Phone trainer lookup result', {
				phone: normalizedPhone.substring(0, 4) + '****',
				trainerId: phoneTrainer?.id,
				service: 'trainer-auth-service',
			});
			if (phoneTrainer) {
				// Check if that trainer has an application submitted
				const phoneTrainerProfile = await getTrainerProfile(phoneTrainer.id);
				const hasApplication = phoneTrainerProfile?.extra?.applicationSubmitted === true;
				
				if (hasApplication) {
					throw new AppError('Phone number already registered to another trainer with a submitted application', 409);
				}
				
				// Phone exists but no application - use that trainer account and update email
				logger.info('Phone exists but no application submitted, using existing trainer account', {
					phone: normalizedPhone.substring(0, 4) + '****',
					trainerId: phoneTrainer.id,
					email: input.email.substring(0, 3) + '***',
					service: 'trainer-auth-service',
				});
				trainer = phoneTrainer;
				try {
					// Check if email is already taken by another trainer
					const emailTrainer = await findTrainerByEmail(input.email);
					if (emailTrainer && emailTrainer.id !== trainer.id) {
						throw new AppError('Email already registered to another account', 409);
					}
					await updateTrainerAccount(trainer.id, {
						email: input.email,
						isEmailVerified: false, // Reset email verification when email changes
					});
				} catch (error: any) {
					if (error?.code === '23505' && (error?.constraint?.includes('email') || error?.detail?.includes('email'))) {
						// Email constraint violation - check if it's a different trainer
						const emailTrainer = await findTrainerByEmail(input.email);
						if (emailTrainer && emailTrainer.id !== trainer.id) {
							throw new AppError('Email already registered to another account', 409);
						}
						// If it's the same trainer, the email is already set, continue
					} else if (error instanceof AppError) {
						throw error;
					} else {
						logger.error('Error updating trainer account', {
							error: error?.message || String(error),
							stack: error?.stack,
							trainerId: trainer.id,
							service: 'trainer-auth-service',
						});
						throw new AppError('Failed to update trainer account', 500);
					}
				}
			} else {
				// Phone doesn't exist, create new trainer
				try {
					trainer = await createTrainer({
						email: input.email,
						phone: normalizedPhone,
						username: input.email.split('@')[0] || null, // Default username from email
					});
				} catch (error: any) {
					// Handle database constraint violations
					if (error?.code === '23505') { // PostgreSQL unique constraint violation
						const constraint = error?.constraint || '';
						if (constraint.includes('phone') || error?.detail?.includes('phone')) {
							// Phone already exists - try to find it again (might be a race condition)
							const existingPhoneTrainer = await findTrainerByPhone(normalizedPhone!);
							if (existingPhoneTrainer) {
								const existingProfile = await getTrainerProfile(existingPhoneTrainer.id);
								const hasApplication = existingProfile?.extra?.applicationSubmitted === true;
								if (hasApplication) {
									throw new AppError('Phone number already registered to another trainer with a submitted application', 409);
								}
								// Use existing trainer and update email
								logger.info('Phone constraint violation - using existing trainer account', {
									phone: normalizedPhone.substring(0, 4) + '****',
									trainerId: existingPhoneTrainer.id,
									email: input.email.substring(0, 3) + '***',
									service: 'trainer-auth-service',
								});
								trainer = existingPhoneTrainer;
								await updateTrainerAccount(trainer.id, {
									email: input.email,
									isEmailVerified: false,
								});
							} else {
								throw new AppError('Phone number already registered', 409);
							}
						} else if (constraint.includes('email') || error?.detail?.includes('email')) {
							// Email already exists - find and use it
							const existingEmailTrainer = await findTrainerByEmail(input.email);
							if (existingEmailTrainer) {
								trainer = existingEmailTrainer;
								// Update phone if different
								if (normalizedPhone && normalizePhone(trainer.phone || '') !== normalizedPhone) {
									await updateTrainerAccount(trainer.id, {
										phone: normalizedPhone,
										isPhoneVerified: false,
									});
								}
							} else {
								throw new AppError('Email already registered', 409);
							}
						} else {
							throw new AppError('Account creation failed. Please try again.', 409);
						}
					} else {
						// Re-throw other errors
						throw error;
					}
				}
			}
		} else {
			// No phone provided, create new trainer
			try {
				trainer = await createTrainer({
					email: input.email,
					phone: normalizedPhone,
					username: input.email.split('@')[0] || null, // Default username from email
				});
			} catch (error: any) {
				// Handle database constraint violations
				if (error?.code === '23505') { // PostgreSQL unique constraint violation
					const constraint = error?.constraint || '';
					if (constraint.includes('email') || error?.detail?.includes('email')) {
						// Email already exists - find and use it
						const existingEmailTrainer = await findTrainerByEmail(input.email);
						if (existingEmailTrainer) {
							trainer = existingEmailTrainer;
							// Update phone if provided and different
							if (normalizedPhone && normalizePhone(trainer.phone || '') !== normalizedPhone) {
								await updateTrainerAccount(trainer.id, {
									phone: normalizedPhone,
									isPhoneVerified: false,
								});
							}
						} else {
							throw new AppError('Email already registered', 409);
						}
					} else {
						throw new AppError('Account creation failed. Please try again.', 409);
					}
				} else {
					// Re-throw other errors
					throw error;
				}
			}
		}
	} else {
		// Trainer exists by email - check if phone needs to be updated
		// Normalize existing phone for comparison
		const existingPhoneNormalized = trainer.phone ? normalizePhone(trainer.phone) : null;
		logger.debug('Trainer exists by email, checking phone update', {
			trainerId: trainer.id,
			email: input.email.substring(0, 3) + '***',
			hasExistingPhone: !!trainer.phone,
			hasNewPhone: !!normalizedPhone,
			service: 'trainer-auth-service',
		});
		
		if (normalizedPhone && existingPhoneNormalized !== normalizedPhone) {
			// Phone is different - check if it's already used by another trainer
			logger.debug('Phone differs, checking if registered to another trainer', {
				phone: normalizedPhone.substring(0, 4) + '****',
				trainerId: trainer.id,
				service: 'trainer-auth-service',
			});
			const phoneTrainer = await findTrainerByPhone(normalizedPhone);
			logger.debug('Phone trainer lookup result', {
				phone: normalizedPhone.substring(0, 4) + '****',
				phoneTrainerId: phoneTrainer?.id,
				currentTrainerId: trainer.id,
				service: 'trainer-auth-service',
			});
			
			if (phoneTrainer && phoneTrainer.id !== trainer.id) {
				// Phone is registered to a different trainer - check if that trainer has an application
				logger.debug('Phone registered to different trainer, checking application status', {
					phone: normalizedPhone.substring(0, 4) + '****',
					phoneTrainerId: phoneTrainer.id,
					currentTrainerId: trainer.id,
					service: 'trainer-auth-service',
				});
				const phoneTrainerProfile = await getTrainerProfile(phoneTrainer.id);
				const hasApplication = phoneTrainerProfile?.extra?.applicationSubmitted === true;
				
				if (hasApplication) {
					throw new AppError('Phone number already registered to another trainer with a submitted application', 409);
				}
				
				// Phone exists but no application - this is likely from phone verification
				// Clear the phone from the phone-based trainer first, then update email-based trainer
				logger.info('Phone exists on different trainer but no application, transferring phone', {
					phone: normalizedPhone.substring(0, 4) + '****',
					phoneTrainerId: phoneTrainer.id,
					currentTrainerId: trainer.id,
					service: 'trainer-auth-service',
				});
				
				// Use transaction to ensure atomicity
				if (trainer) {
					const trainerId = trainer.id; // Capture trainer.id to avoid null check issues
					await withTransaction(async (client) => {
						// First, clear the phone from the phone-based trainer
						await updateTrainerAccount(phoneTrainer.id, { 
							phone: null,
							isPhoneVerified: false
						}, client);
						
						// Then, update the email-based trainer with the phone
						await updateTrainerAccount(trainerId, { 
							phone: normalizedPhone,
							isPhoneVerified: false // Reset verification when phone changes
						}, client);
					});
				}
			} else {
				// Phone is either not registered or registered to this same trainer - safe to update
				logger.debug('Phone is safe to use, updating trainer', {
					phone: normalizedPhone.substring(0, 4) + '****',
					trainerId: trainer.id,
					service: 'trainer-auth-service',
				});
				await updateTrainerAccount(trainer.id, { 
					phone: normalizedPhone,
					isPhoneVerified: false // Reset verification when phone changes
				});
			}
		} else if (normalizedPhone && !trainer.phone) {
			// Phone was provided but trainer doesn't have one - update it
			logger.debug('Trainer has no phone, setting phone', {
				trainerId: trainer.id,
				phone: normalizedPhone.substring(0, 4) + '****',
				service: 'trainer-auth-service',
			});
			await updateTrainerAccount(trainer.id, { 
				phone: normalizedPhone,
				isPhoneVerified: false
			});
		}
	}

	// 3. Create/update trainer profile with all application data
	// Save data to proper columns, not just extra
	const profileData: any = {
		fullName: input.fullName,
		age: input.age,
		gender: input.gender,
		address: input.address,
		expertise: input.specialties.join(','), // Convert array to comma-separated string
		experienceYears: input.experienceYears,
		// Save to proper columns
		bio: input.bio || null,
		specialties: input.specialties, // Array
		yearsOfExperience: input.experienceYears,
		hourlyRate: input.hourlyRate || null,
		preferredLanguages: input.languages || null,
		certifications: input.certifications || null,
		availability: {
			days: input.availableDays,
			timeSlots: input.preferredTimeSlots || null,
			willingToTravel: input.willingToTravel,
			maxTravelDistance: input.maxTravelDistance || null,
		},
		// Store additional data in extra field (for fields without dedicated columns)
		extra: {
			education: input.education,
			qualification: input.qualification,
			university: input.university,
			graduationYear: input.graduationYear,
			previousEmployer: input.previousEmployer,
			teachingExperience: input.teachingExperience,
			references: input.references || [],
			whyJoin: input.whyJoin,
			additionalInfo: input.additionalInfo,
			location: input.location,
			city: input.city,
			state: input.state,
			pincode: input.pincode,
			// Store documents metadata in extra field
			// Note: Actual file storage should be handled by a file storage service
			// For now, we store the document metadata (URLs, types, etc.)
			documents: input.documents.map((doc) => ({
				type: doc.type,
				fileUrl: doc.fileUrl,
				metadata: doc.metadata || {},
				uploadedAt: new Date().toISOString(),
			})),
			applicationSubmitted: true,
			applicationSubmittedAt: new Date().toISOString(),
		},
	};

	await upsertTrainerProfile(trainer.id, profileData);

	// 3. TODO: Also update trainer-service profile with full details
	// This requires calling trainer-service API or updating directly if shared DB

	// 3. TODO: Submit documents via verification service
	// This would require calling the trainer-service verification endpoints
	// or implementing document submission directly here
	// For now, documents are expected to be submitted separately via /api/trainers/verification

	// PHASE 3 FIX: Emit notification event (replaces HTTP call)
	try {
		const { emitApplicationSubmittedNotification } = await import('@kodingcaravan/shared/utils/notificationEventEmitter');
		await emitApplicationSubmittedNotification(trainer.id, trainer.id); // correlationId
	} catch (error) {
		logger.error('Failed to emit application submitted notification event', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			trainerId: trainer.id,
			service: 'trainer-auth-service',
		});
		// Don't throw - notification failure shouldn't break application submission
	}

	return {
		trainerId: trainer.id,
		status: exists ? 'updated' : 'created',
		message: exists
			? 'Trainer application updated successfully. Please submit documents for verification.'
			: 'Trainer application created successfully. Please submit documents for verification.',
	};
}

