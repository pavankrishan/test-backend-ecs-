import { z } from 'zod';

export const trainerApplicationSchema = z.object({
	// Personal Information
	fullName: z.string().min(2).max(150),
	age: z.coerce.number().int().min(18).max(100),
	gender: z.enum(['male', 'female', 'other']),
	phone: z.string().trim().min(6).max(15),
	email: z.string().email(),

	// Address & Location
	address: z.string().min(5).max(500),
	city: z.string().min(2).max(100),
	state: z.string().min(2).max(100),
	pincode: z.string().min(5).max(10),
	location: z
		.object({
			latitude: z.number().min(-90).max(90),
			longitude: z.number().min(-180).max(180),
		})
		.optional(),

	// Education
	education: z.string().max(100).optional().nullable(),
	qualification: z.string().min(2).max(150),
	university: z.string().max(200).optional().nullable(),
	graduationYear: z.coerce.number().int().min(1950).max(new Date().getFullYear() + 5).optional().nullable(),

	// Experience
	experienceYears: z.coerce.number().int().min(0).max(80),
	previousEmployer: z.string().max(200).optional().nullable(),
	teachingExperience: z.string().max(2000).optional().nullable(),

	// Professional
	specialties: z.array(z.string().min(2).max(100)).min(1),
	bio: z.string().min(20).max(2000).optional().nullable(),
	hourlyRate: z.coerce.number().min(0).max(100000).optional().nullable(),
	languages: z.array(z.string().min(2).max(40)).optional().nullable(),
	certifications: z.array(z.string().min(2).max(150)).optional().nullable(),

	// Availability
	availableDays: z.array(z.string()).min(1),
	preferredTimeSlots: z.string().max(200).optional().nullable(),
	willingToTravel: z.boolean().default(true), // Always mandatory/required
	maxTravelDistance: z.coerce.number().min(0).max(1000).optional().nullable(),

	// Documents
	documents: z
		.array(
			z.object({
				type: z.enum(['id_proof', 'qualification', 'experience_certificate', 'criminal_record', 'face_verification']),
				fileUrl: z.string(), // URL or base64
				metadata: z.record(z.any()).optional().nullable(),
			})
		)
		.min(1),

	// References
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

	// Other
	whyJoin: z.string().max(2000).optional().nullable(),
	additionalInfo: z.string().max(2000).optional().nullable(),
});

export type TrainerApplicationInput = z.infer<typeof trainerApplicationSchema>;

