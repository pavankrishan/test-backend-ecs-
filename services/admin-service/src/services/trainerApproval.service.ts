import { AppError, GeocodingService } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';
import { getPool, withTransaction } from '../config/database';
import type { PoolClient } from 'pg';
// PHASE 3 FIX: Replaced HTTP notification calls with event emissions
import {
	emitApplicationApprovedNotification,
	emitApplicationRejectedNotification,
} from '@kodingcaravan/shared/utils/notificationEventEmitter';

/**
 * Service for managing trainer application approvals
 */
export class TrainerApprovalService {
	private pool = getPool();

	/**
	 * Get all trainers with their profiles, filtered by approval status
	 * Queries from trainer_applications table which is the source of truth for applications
	 */
	async getTrainersByStatus(
		status: 'pending' | 'approved' | 'rejected',
		options?: {
			limit?: number;
			offset?: number;
			includeProfile?: boolean;
		}
	): Promise<any[]> {
		// Map API status to database review_status
		const statusMap: Record<string, string> = {
			pending: 'PENDING',
			approved: 'APPROVED',
			rejected: 'REJECTED',
		};
		const dbStatus = statusMap[status] || 'PENDING';

		// Query from trainer_applications table and join with trainers
		let queryText = `
			SELECT 
				t.id,
				t.phone,
				t.email,
				t.username,
				t.is_email_verified as "isEmailVerified",
				t.is_phone_verified as "isPhoneVerified",
				ta.review_status as "reviewStatus",
				ta.submitted_at as "submittedAt",
				ta.created_at as "applicationCreatedAt",
				ta.updated_at as "applicationUpdatedAt",
				t.created_at as "createdAt",
				t.updated_at as "updatedAt"
			FROM trainer_applications ta
			INNER JOIN trainers t ON ta.trainer_id = t.id
			WHERE ta.review_status = $1
			ORDER BY ta.submitted_at DESC, ta.created_at DESC
		`;
		const params: any[] = [dbStatus];
		let idx = 2;

		if (options?.limit) {
			queryText += ` LIMIT $${idx++}`;
			params.push(options.limit);
		}
		if (options?.offset) {
			queryText += ` OFFSET $${idx++}`;
			params.push(options.offset);
		}

		const trainersResult = await this.pool.query(queryText, params);
		const trainers = trainersResult.rows;

		if (!options?.includeProfile) {
			return trainers.map(t => ({
				id: t.id,
				email: t.email,
				phone: t.phone,
				username: t.username,
				approvalStatus: status, // Map back to lowercase for API consistency
				isEmailVerified: t.isEmailVerified,
				isPhoneVerified: t.isPhoneVerified,
				createdAt: t.applicationCreatedAt || t.createdAt,
				updatedAt: t.applicationUpdatedAt || t.updatedAt,
			}));
		}

		// Include profile data, application details, and documents (batch fetch to avoid N+1)
		if (trainers.length === 0) {
			return [];
		}

		const trainerIds = trainers.map(t => t.id);

		// Batch fetch profiles
		const profilesMap = new Map<string, any>();
		try {
			const profilesResult = await this.pool.query(
				`
					SELECT 
						id,
						trainer_id as "trainerId",
						full_name as "fullName",
						age,
						gender,
						address,
						expertise,
						experience_years as "experienceYears",
						extra,
						created_at as "createdAt",
						updated_at as "updatedAt"
					FROM trainer_profiles
					WHERE trainer_id = ANY($1::uuid[])
				`,
				[trainerIds]
			);
			profilesResult.rows.forEach(row => profilesMap.set(row.trainerId, row));
		} catch (error: any) {
			logger.warn('Failed to batch fetch trainer profiles', {
				error: error?.message || String(error),
				trainerIdsCount: trainerIds.length,
				service: 'admin-service',
			});
		}

		// Batch fetch applications
		const applicationsMap = new Map<string, any>();
		try {
			const applicationsResult = await this.pool.query(
				`
					SELECT 
						id,
						trainer_id as "trainerId",
						date_of_birth as "dateOfBirth",
						gender as "applicationGender",
						address_text as "addressText",
						latitude,
						longitude,
						pincode,
						review_status as "reviewStatus",
						reviewed_by as "reviewedBy",
						reviewed_at as "reviewedAt",
						review_notes as "reviewNotes",
						city_id as "cityId",
						zone_id as "zoneId",
						consent_info_correct as "consentInfoCorrect",
						consent_background_verification as "consentBackgroundVerification",
						consent_travel_to_students as "consentTravelToStudents",
						application_stage as "applicationStage",
						submitted_at as "submittedAt",
						created_at as "createdAt",
						updated_at as "updatedAt"
					FROM trainer_applications
					WHERE trainer_id = ANY($1::uuid[])
				`,
				[trainerIds]
			);
			applicationsResult.rows.forEach(row => applicationsMap.set(row.trainerId, row));
		} catch (error: any) {
			logger.warn('Failed to batch fetch trainer applications', {
				error: error?.message || String(error),
				trainerIdsCount: trainerIds.length,
				service: 'admin-service',
			});
		}

		// Batch fetch documents
		const documentsMap = new Map<string, any[]>();
		try {
			const documentsResult = await this.pool.query(
				`
					SELECT 
						id,
						trainer_id as "trainerId",
						application_id as "applicationId",
						document_type as "documentType",
						file_url as "fileUrl",
						file_name as "fileName",
						file_size_bytes as "fileSizeBytes",
						mime_type as "mimeType",
						verification_status as "verificationStatus",
						verified_by as "verifiedBy",
						verified_at as "verifiedAt",
						verification_notes as "verificationNotes",
						metadata,
						created_at as "createdAt",
						updated_at as "updatedAt"
					FROM trainer_documents
					WHERE trainer_id = ANY($1::uuid[])
					ORDER BY trainer_id, created_at DESC
				`,
				[trainerIds]
			);
			documentsResult.rows.forEach(row => {
				const existing = documentsMap.get(row.trainerId) || [];
				existing.push(row);
				documentsMap.set(row.trainerId, existing);
			});
		} catch (error: any) {
			logger.warn('Failed to batch fetch trainer documents', {
				error: error?.message || String(error),
				trainerIdsCount: trainerIds.length,
				service: 'admin-service',
			});
		}

		// Batch fetch availability
		const availabilityMap = new Map<string, any[]>();
		try {
			const availabilityResult = await this.pool.query(
				`
					SELECT 
						id,
						trainer_id as "trainerId",
						slot_start as "slotStart",
						slot_end as "slotEnd",
						employment_type as "employmentType",
						created_at as "createdAt",
						updated_at as "updatedAt"
					FROM trainer_availability
					WHERE trainer_id = ANY($1::uuid[])
					ORDER BY trainer_id, slot_start ASC
				`,
				[trainerIds]
			);
			availabilityResult.rows.forEach(row => {
				const existing = availabilityMap.get(row.trainerId) || [];
				existing.push(row);
				availabilityMap.set(row.trainerId, existing);
			});
		} catch (error: any) {
			logger.warn('Failed to batch fetch trainer availability', {
				error: error?.message || String(error),
				trainerIdsCount: trainerIds.length,
				service: 'admin-service',
			});
		}

		// Batch fetch application courses (for trainers with applications)
		const applicationIds = Array.from(applicationsMap.values()).map(app => app.id).filter(Boolean);
		const appCoursesMap = new Map<string, any[]>();
		if (applicationIds.length > 0) {
			try {
				const appCoursesResult = await this.pool.query(
					`
						SELECT 
							tac.id,
							tac.trainer_application_id as "applicationId",
							tac.course_id as "courseId",
							tac.preference_order as "preferenceOrder",
							c.code as "courseCode",
							c.name as "courseName",
							c.description as "courseDescription",
							c.category as "courseCategory",
							tac.created_at as "createdAt"
						FROM trainer_application_courses tac
						INNER JOIN courses c ON tac.course_id = c.id
						WHERE tac.trainer_application_id = ANY($1::uuid[])
						ORDER BY tac.trainer_application_id, tac.preference_order ASC
					`,
					[applicationIds]
				);
				appCoursesResult.rows.forEach(row => {
					const existing = appCoursesMap.get(row.applicationId) || [];
					existing.push(row);
					appCoursesMap.set(row.applicationId, existing);
				});
			} catch (error: any) {
				logger.warn('Failed to batch fetch application courses', {
					error: error?.message || String(error),
					applicationIdsCount: applicationIds.length,
					service: 'admin-service',
				});
			}
		}

		// Batch fetch permanent courses
		const permCoursesMap = new Map<string, any[]>();
		try {
			const permCoursesResult = await this.pool.query(
				`
					SELECT 
						tc.id,
						tc.trainer_id as "trainerId",
						tc.course_id as "courseId",
						tc.certified_at as "certifiedAt",
						tc.certification_status as "certificationStatus",
						c.code as "courseCode",
						c.name as "courseName",
						c.description as "courseDescription",
						c.category as "courseCategory",
						tc.created_at as "createdAt"
					FROM trainer_courses tc
					INNER JOIN courses c ON tc.course_id = c.id
					WHERE tc.trainer_id = ANY($1::uuid[])
					ORDER BY tc.trainer_id, tc.created_at ASC
				`,
				[trainerIds]
			);
			permCoursesResult.rows.forEach(row => {
				const existing = permCoursesMap.get(row.trainerId) || [];
				existing.push(row);
				permCoursesMap.set(row.trainerId, existing);
			});
		} catch (error: any) {
			logger.warn('Failed to batch fetch permanent courses', {
				error: error?.message || String(error),
				trainerIdsCount: trainerIds.length,
				service: 'admin-service',
			});
		}

		// Batch fetch application skills
		const appSkillsMap = new Map<string, any[]>();
		if (applicationIds.length > 0) {
			try {
				const appSkillsResult = await this.pool.query(
					`
						SELECT 
							tas.id,
							tas.trainer_application_id as "applicationId",
							tas.skill_id as "skillId",
							s.name as "skillName",
							s.category as "skillCategory",
							tas.created_at as "createdAt"
						FROM trainer_application_skills tas
						INNER JOIN skills s ON tas.skill_id = s.id
						WHERE tas.trainer_application_id = ANY($1::uuid[])
						ORDER BY tas.trainer_application_id, s.name ASC
					`,
					[applicationIds]
				);
				appSkillsResult.rows.forEach(row => {
					const existing = appSkillsMap.get(row.applicationId) || [];
					existing.push(row);
					appSkillsMap.set(row.applicationId, existing);
				});
			} catch (error: any) {
				logger.warn('Failed to batch fetch application skills', {
					error: error?.message || String(error),
					applicationIdsCount: applicationIds.length,
					service: 'admin-service',
				});
			}
		}

		// Batch fetch permanent skills
		const permSkillsMap = new Map<string, any[]>();
		try {
			const permSkillsResult = await this.pool.query(
				`
					SELECT 
						ts.id,
						ts.trainer_id as "trainerId",
						ts.skill_id as "skillId",
						ts.proficiency_level as "proficiencyLevel",
						s.name as "skillName",
						s.category as "skillCategory",
						ts.created_at as "createdAt"
					FROM trainer_skills ts
					INNER JOIN skills s ON ts.skill_id = s.id
					WHERE ts.trainer_id = ANY($1::uuid[])
					ORDER BY ts.trainer_id, s.name ASC
				`,
				[trainerIds]
			);
			permSkillsResult.rows.forEach(row => {
				const existing = permSkillsMap.get(row.trainerId) || [];
				existing.push(row);
				permSkillsMap.set(row.trainerId, existing);
			});
		} catch (error: any) {
			logger.warn('Failed to batch fetch permanent skills', {
				error: error?.message || String(error),
				trainerIdsCount: trainerIds.length,
				service: 'admin-service',
			});
		}

		// Map trainers with batch-fetched data
		const trainersWithProfiles = trainers.map((trainer) => {
			const profile = profilesMap.get(trainer.id) || null;
			const application = applicationsMap.get(trainer.id) || null;
			const documents = documentsMap.get(trainer.id) || [];
			const availability = availabilityMap.get(trainer.id) || [];

			// Get courses - check application-level first, then permanent
			let courses: any[] = [];
			if (application) {
				courses = appCoursesMap.get(application.id) || [];
			}
			if (courses.length === 0) {
				courses = permCoursesMap.get(trainer.id) || [];
			}

			// Get skills - check application-level first, then permanent
			let skills: any[] = [];
			if (application) {
				skills = appSkillsMap.get(application.id) || [];
			}
			if (skills.length === 0) {
				skills = permSkillsMap.get(trainer.id) || [];
			}

			return {
				id: trainer.id,
				email: trainer.email,
				phone: trainer.phone,
				username: trainer.username,
				approvalStatus: status, // Map back to lowercase for API consistency
				isEmailVerified: trainer.isEmailVerified,
				isPhoneVerified: trainer.isPhoneVerified,
				createdAt: trainer.applicationCreatedAt || trainer.createdAt,
				updatedAt: trainer.applicationUpdatedAt || trainer.updatedAt,
				profile: profile ? {
					...profile,
					extra: profile.extra || {},
				} : null,
				application: application,
				documents: documents,
				availability: availability,
				courses: courses,
				skills: skills,
			};
		});

		return trainersWithProfiles;
	}

	/**
	 * Get a single trainer with profile by ID
	 */
	async getTrainerById(trainerId: string, includeProfile: boolean = true): Promise<any> {
		const trainerResult = await this.pool.query(
			`
				SELECT 
					id,
					phone,
					email,
					username,
					password_hash as "passwordHash",
					is_email_verified as "isEmailVerified",
					is_phone_verified as "isPhoneVerified",
					google_id as "googleId",
					approval_status as "approvalStatus",
					last_login_at as "lastLoginAt",
					created_at as "createdAt",
					updated_at as "updatedAt"
				FROM trainers
				WHERE id = $1
			`,
			[trainerId]
		);

		const trainer = trainerResult.rows[0];
		if (!trainer) {
			throw new AppError('Trainer not found', 404);
		}

		if (!includeProfile) {
			return {
				id: trainer.id,
				email: trainer.email,
				phone: trainer.phone,
				username: trainer.username,
				approvalStatus: trainer.approvalStatus,
				isEmailVerified: trainer.isEmailVerified,
				isPhoneVerified: trainer.isPhoneVerified,
				createdAt: trainer.createdAt,
				updatedAt: trainer.updatedAt,
			};
		}

		const profileResult = await this.pool.query(
			`
				SELECT 
					id,
					trainer_id as "trainerId",
					full_name as "fullName",
					age,
					gender,
					address,
					expertise,
					experience_years as "experienceYears",
					extra,
					created_at as "createdAt",
					updated_at as "updatedAt"
				FROM trainer_profiles
				WHERE trainer_id = $1
			`,
			[trainerId]
		);

		const profile = profileResult.rows[0] || null;

		return {
			id: trainer.id,
			email: trainer.email,
			phone: trainer.phone,
			username: trainer.username,
			approvalStatus: trainer.approvalStatus,
			isEmailVerified: trainer.isEmailVerified,
			isPhoneVerified: trainer.isPhoneVerified,
			createdAt: trainer.createdAt,
			updatedAt: trainer.updatedAt,
			profile: profile ? {
				...profile,
				extra: profile.extra || {},
			} : null,
		};
	}

	/**
	 * Approve a trainer application with transactional geocoding
	 * Implements enterprise location model: creates trainer_addresses and trainer_base_locations
	 */
	async approveTrainer(trainerId: string, adminId: string): Promise<any> {
		// Check if trainer exists and is not already approved
		const trainerResult = await this.pool.query(
			`
				SELECT approval_status as "approvalStatus"
				FROM trainers
				WHERE id = $1
			`,
			[trainerId]
		);

		const trainer = trainerResult.rows[0];
		if (!trainer) {
			throw new AppError('Trainer not found', 404);
		}

		if (trainer.approvalStatus === 'approved') {
			throw new AppError('Trainer is already approved', 400);
		}

		// Execute approval with transactional geocoding
		return await withTransaction(async (client: PoolClient) => {
			// Step 1: Get application data
			const appResult = await client.query(
				`
					SELECT 
						id, trainer_id, address_text, pincode, city_id, zone_id
					FROM trainer_applications
					WHERE trainer_id = $1 AND review_status = 'PENDING'
				`,
				[trainerId]
			);

			if (appResult.rows.length === 0) {
				throw new AppError('Application not found or already reviewed', 404);
			}

			const application = appResult.rows[0];

			// Step 2: Resolve pincode to city if needed
			let cityId = application.city_id;
			let state: string | null = null;
			let district: string | null = null;

			// Try to resolve pincode to get city/state info
			if (application.pincode) {
				// Clean pincode (remove whitespace)
				const cleanPincode = application.pincode.trim();
				
				console.log(`[Trainer Approval] Looking up pincode: "${cleanPincode}"`);
				
				const pincodeResult = await client.query(
					`SELECT city_id, district, state FROM pincodes WHERE pincode = $1`,
					[cleanPincode]
				);

				if (pincodeResult.rows.length > 0) {
					cityId = cityId || pincodeResult.rows[0].city_id;
					district = district || pincodeResult.rows[0].district;
					state = state || pincodeResult.rows[0].state;
					
					console.log(`[Trainer Approval] ✅ Found pincode info:`, {
						cityId: pincodeResult.rows[0].city_id,
						district: pincodeResult.rows[0].district,
						state: pincodeResult.rows[0].state,
					});
				} else {
					console.warn(`[Trainer Approval] ⚠️ Pincode "${cleanPincode}" not found in pincodes table`);
				}
			}

			// Get state and district from city if available (and not already set)
			if (cityId && (!state || !district)) {
				const cityResult = await client.query(
					`SELECT state, district FROM cities WHERE id = $1`,
					[cityId]
				);
				if (cityResult.rows.length > 0) {
					if (!state) {
						state = cityResult.rows[0].state;
					}
					if (!district) {
						district = cityResult.rows[0].district;
					}
					
					console.log(`[Trainer Approval] ✅ Got city info:`, {
						state: cityResult.rows[0].state,
						district: cityResult.rows[0].district,
					});
				}
			}

			// Step 3: Create trainer_addresses record (KYC/identity address)
			// Only if address_text is provided
			let addressId: string | null = null;
			if (application.address_text) {
				const addressResult = await client.query(
					`
						INSERT INTO trainer_addresses (
							trainer_id, address_text, pincode, city_id, district, state, country,
							is_verified, verified_by, verified_at, is_primary
						) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), true)
						RETURNING id
					`,
					[
						trainerId,
						application.address_text,
						application.pincode || null,
						cityId,
						district,
						state,
						'India',
						false, // Will be verified in KYC process
						adminId,
					]
				);
				addressId = addressResult.rows[0]?.id || null;
			}

			// Step 4: Get coordinates (prefer existing, then try geocoding with proper address format)
			// Geocoding is optional - approval should not fail if geocoding fails
			let latitude: number | null = application.latitude || null;
			let longitude: number | null = application.longitude || null;
			let confidenceScore: number | null = null;
			let geocodedSource: string = latitude && longitude ? 'application' : 'none';

			// If coordinates already exist in application, use them
			if (latitude && longitude) {
				console.log(`[Trainer Approval] ✅ Using existing coordinates from application for trainer ${trainerId}:`, {
					coordinates: `${latitude}, ${longitude}`,
				});
			} else if (application.address_text) {
				// Try geocoding with properly formatted address including city and state
				try {
					// Get city name from city_id if available
					let cityName: string | null = null;
					if (cityId) {
						const cityNameResult = await client.query(
							`SELECT name FROM cities WHERE id = $1`,
							[cityId]
						);
						if (cityNameResult.rows.length > 0) {
							cityName = cityNameResult.rows[0].name;
						}
					}

					// Ensure we have state - try multiple sources
					if (!state) {
						// Try from pincode first
						if (application.pincode) {
							const pincodeStateResult = await client.query(
								`SELECT state FROM pincodes WHERE pincode = $1 LIMIT 1`,
								[application.pincode]
							);
							if (pincodeStateResult.rows.length > 0) {
								state = pincodeStateResult.rows[0].state;
							}
						}
						// Try from city if still not available
						if (!state && cityId) {
							const cityStateResult = await client.query(
								`SELECT state FROM cities WHERE id = $1 LIMIT 1`,
								[cityId]
							);
							if (cityStateResult.rows.length > 0) {
								state = cityStateResult.rows[0].state;
							}
						}
					}

					console.log(`[Trainer Approval] Location info for trainer ${trainerId}:`, {
						cityId: cityId,
						cityName: cityName,
						state: state,
						district: district,
						pincode: application.pincode,
					});

					// Build properly formatted geocoding query with city and state
					// Format: "Street Address, Area, City, District, State, Pincode, Country"
					let geocodeQuery = application.address_text.trim();
					
					// Add city name if available (critical for geocoding)
					if (cityName) {
						geocodeQuery += `, ${cityName}`;
					}
					
					// Add district if available
					if (district) {
						geocodeQuery += `, ${district}`;
					}
					
					// Add state (required for better geocoding results)
					if (state) {
						geocodeQuery += `, ${state}`;
					}
					
					// Add pincode
					if (application.pincode) {
						geocodeQuery += ` ${application.pincode}`;
					}
					
					// Add country
					geocodeQuery += ', India';

					console.log(`[Trainer Approval] Attempting geocoding for trainer ${trainerId}: "${geocodeQuery}"`);

					const geocodingService = GeocodingService.getInstance();
					
					// Use fallback provider directly if we have city/state info to avoid API calls
					// This prevents infinite loops and uses hardcoded coordinates for known cities
					if (cityName || state) {
						try {
							const fallbackResult = await geocodingService.geocodeAddress(geocodeQuery, {
								provider: 'fallback',
								timeout: 2000,
							});
							
							latitude = fallbackResult.latitude;
							longitude = fallbackResult.longitude;
							confidenceScore = fallbackResult.confidence || 0.3;
							geocodedSource = 'fallback';
							
							console.log(`[Trainer Approval] ✅ Used fallback geocoding for trainer ${trainerId}:`, {
								coordinates: `${latitude}, ${longitude}`,
								confidence: confidenceScore,
								source: geocodedSource,
								city: cityName,
								state: state,
							});
						} catch (fallbackError: any) {
							console.warn(`[Trainer Approval] Fallback geocoding also failed:`, fallbackError.message);
							latitude = null;
							longitude = null;
							geocodedSource = 'none';
						}
					} else {
						// No city/state info, skip geocoding but log why
						console.warn(`[Trainer Approval] ⚠️ No city/state info available for trainer ${trainerId}. Skipping geocoding.`, {
							cityId: cityId,
							pincode: application.pincode,
							hasCityName: !!cityName,
							hasState: !!state,
						});
						latitude = null;
						longitude = null;
						geocodedSource = 'none';
					}
				} catch (geocodeError: any) {
					// Geocoding failed - log but don't block approval
					console.warn(`[Trainer Approval] ⚠️ Geocoding failed for trainer ${trainerId}, continuing without coordinates:`, {
						address: application.address_text,
						pincode: application.pincode,
						error: geocodeError.message || String(geocodeError),
					});
					
					// Reset to null to indicate no coordinates available
					latitude = null;
					longitude = null;
					geocodedSource = 'none';
					
					// Approval will continue without coordinates
					// Coordinates can be added later manually or via background job
				}
			} else {
				// No address text available
				console.log(`[Trainer Approval] ⚠️ No address text available for trainer ${trainerId}. Skipping geocoding.`);
				latitude = null;
				longitude = null;
				geocodedSource = 'none';
			}

			// Step 5: Create trainer_base_locations record (if geocoding succeeded)
			if (latitude !== null && longitude !== null && addressId) {
				await client.query(
					`
						INSERT INTO trainer_base_locations (
							trainer_id, latitude, longitude, source, confidence_score,
							geocoded_by, address_id, geocoded_at
						) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
						ON CONFLICT (trainer_id) DO UPDATE SET
							latitude = EXCLUDED.latitude,
							longitude = EXCLUDED.longitude,
							source = EXCLUDED.source,
							confidence_score = EXCLUDED.confidence_score,
							geocoded_by = EXCLUDED.geocoded_by,
							address_id = EXCLUDED.address_id,
							geocoded_at = NOW(),
							updated_at = NOW()
					`,
					[
						trainerId,
						latitude,
						longitude,
						geocodedSource,
						confidenceScore,
						'google', // or geocodedSource
						addressId,
					]
				);
				console.log(`[Trainer Approval] Created base location for trainer ${trainerId}`);
			}

			// Step 6: Update trainer_applications review status
			await client.query(
				`
					UPDATE trainer_applications
					SET 
						review_status = 'APPROVED',
						reviewed_by = $1,
						reviewed_at = NOW(),
						city_id = $2,
						zone_id = $3,
						application_stage = 'approved',
						updated_at = NOW()
					WHERE id = $4
				`,
				[adminId, cityId, application.zone_id, application.id]
			);

			// Step 7: Update trainers table with approval status
			// Note: city_id and zone_id don't exist in trainers table, they're in trainer_applications
			await client.query(
				`
					UPDATE trainers
					SET 
						approval_status = 'approved',
						updated_at = NOW()
					WHERE id = $1
				`,
				[trainerId]
			);

			// Step 7.5: Update trainer-auth-service profile with all fields for backward compatibility
			// This ensures the profile in trainer-auth-service is fully updated after approval
			try {
				const profileCheck = await client.query(
					`
						SELECT 
							specialties,
							bio,
							years_of_experience,
							hourly_rate,
							preferred_languages,
							certifications,
							availability,
							age,
							gender,
							address
						FROM trainer_profiles 
						WHERE trainer_id = $1
					`,
					[trainerId]
				);
				
				if (profileCheck.rows.length > 0) {
					const profile = profileCheck.rows[0];
					
					// Convert specialties array to comma-separated string for expertise field (backward compatibility)
					const specialtiesArray = profile.specialties;
					const expertiseString = specialtiesArray && Array.isArray(specialtiesArray) 
						? specialtiesArray.join(', ') 
						: (typeof specialtiesArray === 'string' ? specialtiesArray : null);
					
					// Update all profile fields in trainer-auth-service
					await client.query(
						`
							UPDATE trainer_profiles
							SET 
								expertise = COALESCE($1, expertise),
								bio = COALESCE($2, bio),
								specialties = COALESCE($3, specialties),
								years_of_experience = COALESCE($4, years_of_experience),
								hourly_rate = COALESCE($5, hourly_rate),
								preferred_languages = COALESCE($6, preferred_languages),
								certifications = COALESCE($7, certifications),
								availability = COALESCE($8::jsonb, availability),
								age = COALESCE($9, age),
								gender = COALESCE($10, gender),
								address = COALESCE($11, address),
								updated_at = NOW()
							WHERE trainer_id = $12
						`,
						[
							expertiseString,
							profile.bio,
							profile.specialties,
							profile.years_of_experience,
							profile.hourly_rate,
							profile.preferred_languages,
							profile.certifications,
							profile.availability ? JSON.stringify(profile.availability) : null,
							profile.age,
							profile.gender,
							profile.address,
							trainerId,
						]
					);
					console.log(`[Trainer Approval] ✅ Updated trainer-auth-service profile for ${trainerId}`, {
						expertise: !!expertiseString,
						bio: !!profile.bio,
						specialties: profile.specialties ? (Array.isArray(profile.specialties) ? profile.specialties.length : 1) : 0,
						yearsOfExperience: profile.years_of_experience,
						hourlyRate: profile.hourly_rate,
					});
				}
			} catch (profileUpdateError: any) {
				// Non-critical - some fields might not exist in all schemas
				console.warn(`[Trainer Approval] Could not update trainer-auth-service profile (non-critical):`, profileUpdateError.message);
			}

			// Step 8: Sync ALL application data from trainer-auth-service profile to trainer-service profile
			// This ensures all profile fields are synced after approval
			try {
				const authProfileResult = await client.query(
					`
						SELECT 
							full_name,
							age,
							gender,
							address,
							bio,
							specialties,
							years_of_experience,
							hourly_rate,
							preferred_languages,
							certifications,
							availability,
							extra
						FROM trainer_profiles
						WHERE trainer_id = $1
					`,
					[trainerId]
				);

				if (authProfileResult.rows.length > 0) {
					const authProfile = authProfileResult.rows[0];
					const extra = authProfile.extra || {};

					// Prioritize column values over extra field values
					// This ensures data from the columns is used, not from extra
					const fullName = authProfile.full_name || extra.fullName || null;
					const age = authProfile.age || extra.age || null;
					const gender = authProfile.gender || extra.gender || null;
					const address = authProfile.address || extra.address || null;
					const bio = authProfile.bio || extra.bio || null;
					const specialties = authProfile.specialties || extra.specialties || null;
					const yearsOfExperience = authProfile.years_of_experience || extra.teachingExperience || extra.experienceYears || null;
					const hourlyRate = authProfile.hourly_rate || extra.hourlyRate || null;
					const preferredLanguages = authProfile.preferred_languages || extra.languages || null;
					const certifications = authProfile.certifications || extra.certifications || null;
					const availability = authProfile.availability || extra.availability || null;

					// Update trainer-service profile with ALL data from application
					await client.query(
						`
							INSERT INTO trainer_profiles (
								trainer_id,
								full_name,
								age,
								gender,
								address,
								bio,
								specialties,
								years_of_experience,
								hourly_rate,
								preferred_languages,
								certifications,
								availability,
								created_at,
								updated_at
							) VALUES (
								$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW()
							)
							ON CONFLICT (trainer_id) DO UPDATE SET
								full_name = COALESCE(EXCLUDED.full_name, trainer_profiles.full_name),
								age = COALESCE(EXCLUDED.age, trainer_profiles.age),
								gender = COALESCE(EXCLUDED.gender, trainer_profiles.gender),
								address = COALESCE(EXCLUDED.address, trainer_profiles.address),
								bio = COALESCE(EXCLUDED.bio, trainer_profiles.bio),
								specialties = COALESCE(EXCLUDED.specialties, trainer_profiles.specialties),
								years_of_experience = COALESCE(EXCLUDED.years_of_experience, trainer_profiles.years_of_experience),
								hourly_rate = COALESCE(EXCLUDED.hourly_rate, trainer_profiles.hourly_rate),
								preferred_languages = COALESCE(EXCLUDED.preferred_languages, trainer_profiles.preferred_languages),
								certifications = COALESCE(EXCLUDED.certifications, trainer_profiles.certifications),
								availability = COALESCE(EXCLUDED.availability, trainer_profiles.availability),
								updated_at = NOW()
						`,
						[
							trainerId,
							fullName,
							age,
							gender,
							address,
							bio,
							specialties,
							yearsOfExperience,
							hourlyRate,
							preferredLanguages,
							certifications,
							availability ? JSON.stringify(availability) : null,
						]
					);
					console.log(`[Trainer Approval] ✅ Synced ALL application data to trainer-service profile for ${trainerId}`, {
						fullName: !!fullName,
						age,
						gender,
						address: !!address,
						bio: !!bio,
						specialties: specialties ? (Array.isArray(specialties) ? specialties.length : 1) : 0,
						yearsOfExperience,
						hourlyRate,
						preferredLanguages: preferredLanguages ? (Array.isArray(preferredLanguages) ? preferredLanguages.length : 1) : 0,
						certifications: certifications ? (Array.isArray(certifications) ? certifications.length : 1) : 0,
						availability: !!availability,
					});
				}
			} catch (syncError: any) {
				// If sync fails (e.g., columns don't exist), log but don't fail approval
				console.warn(`[Trainer Approval] Failed to sync profile data (non-critical):`, syncError.message);
			}

			// Get full trainer data with profile
			const trainerData = await this.getTrainerById(trainerId, true);

			// PHASE 3 FIX: Emit notification event (replaces HTTP call)
			// This is done after transaction commits to avoid blocking
			setImmediate(async () => {
				try {
					await emitApplicationApprovedNotification(trainerId, trainerId); // correlationId
				} catch (error) {
					console.error('[Trainer Approval Service] Failed to emit approval notification event:', error);
					// Don't throw - notification failure shouldn't break approval
				}
			});

			return trainerData;
		});
	}

	/**
	 * Reject a trainer application
	 * Updates trainer_applications.review_status to 'REJECTED'
	 */
	async rejectTrainer(trainerId: string, adminId: string, reason?: string): Promise<any> {
		// Check if trainer exists
		const trainerResult = await this.pool.query(
			`
				SELECT id FROM trainers WHERE id = $1
			`,
			[trainerId]
		);

		if (trainerResult.rows.length === 0) {
			throw new AppError('Trainer not found', 404);
		}

		// Check if application exists and is not already rejected
		const appResult = await this.pool.query(
			`
				SELECT review_status
				FROM trainer_applications
				WHERE trainer_id = $1
			`,
			[trainerId]
		);

		if (appResult.rows.length === 0) {
			throw new AppError('Trainer application not found', 404);
		}

		if (appResult.rows[0].review_status === 'REJECTED') {
			throw new AppError('Trainer application is already rejected', 400);
		}

		// Update trainer_applications table
		const updateResult = await this.pool.query(
			`
				UPDATE trainer_applications
				SET 
					review_status = 'REJECTED',
					reviewed_by = $1,
					reviewed_at = NOW(),
					review_notes = $2,
					updated_at = NOW()
				WHERE trainer_id = $3
				RETURNING id
			`,
			[adminId, reason || null, trainerId]
		);

		if (updateResult.rows.length === 0) {
			throw new AppError('Failed to update trainer application status', 500);
		}

		// Also update trainers table for backward compatibility
		await this.pool.query(
			`
				UPDATE trainers
				SET approval_status = 'rejected', updated_at = NOW()
				WHERE id = $1
			`,
			[trainerId]
		);

		// Get full trainer data with profile
		const trainerData = await this.getTrainerById(trainerId, true);
		
		// PHASE 3 FIX: Emit notification event (replaces HTTP call)
		try {
			await emitApplicationRejectedNotification(trainerId, reason, trainerId); // correlationId
		} catch (error) {
			console.error('[Trainer Approval Service] Failed to emit rejection notification event:', error);
			// Don't throw - notification failure shouldn't break rejection
		}
		
		// Store rejection reason in profile extra if provided
		if (reason) {
			await this.pool.query(
				`
					UPDATE trainer_profiles
					SET extra = jsonb_set(
						COALESCE(extra, '{}'::jsonb),
						'{rejectionReason}',
						$1::jsonb
					),
					updated_at = NOW()
					WHERE trainer_id = $2
				`,
				[JSON.stringify(reason), trainerId]
			);
		}

		return trainerData;
	}

	/**
	 * Get statistics about trainer applications
	 * Queries from trainer_applications table which is the source of truth
	 */
	async getApprovalStatistics(): Promise<{
		pending: number;
		approved: number;
		rejected: number;
		total: number;
	}> {
		const result = await this.pool.query(
			`
				SELECT 
					review_status,
					COUNT(*) as count
				FROM trainer_applications
				GROUP BY review_status
			`
		);

		const stats = {
			pending: 0,
			approved: 0,
			rejected: 0,
			total: 0,
		};

		result.rows.forEach((row: any) => {
			const dbStatus = row.review_status;
			const count = parseInt(row.count, 10);
			
			// Map database status to API status
			if (dbStatus === 'PENDING') {
				stats.pending = count;
			} else if (dbStatus === 'APPROVED') {
				stats.approved = count;
			} else if (dbStatus === 'REJECTED') {
				stats.rejected = count;
			}
			stats.total += count;
		});

		return stats;
	}
}

export const trainerApprovalService = new TrainerApprovalService();

