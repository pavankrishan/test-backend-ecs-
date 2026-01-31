import { z } from 'zod';

export const createPaymentSchema = z.object({
	studentId: z.string().uuid(),
	amountCents: z.number().int().positive(),
	currency: z.string().trim().min(3).max(10).optional(),
	paymentMethod: z.string().trim().min(2).max(50).optional(),
	description: z.string().trim().min(3).max(200).optional(),
	metadata: z.record(z.any()).optional(),
});

export const confirmPaymentParamsSchema = z.object({
	paymentId: z.string().uuid(),
});

export const confirmPaymentSchema = z.object({
	status: z.enum(['processing', 'succeeded', 'failed', 'refunded', 'cancelled']),
	providerPaymentId: z.string().trim().min(3).max(200).optional(),
	provider: z.string().trim().min(2).max(100).optional(),
	paymentMethod: z.string().trim().min(2).max(50).optional(),
	description: z.string().trim().min(3).max(200).optional(),
	metadata: z.record(z.any()).optional(),
});

export const paymentIdParamsSchema = z.object({
	paymentId: z.string().uuid(),
});

export const studentIdParamsSchema = z.object({
	studentId: z.string().uuid(),
});

export const courseCompletionRewardSchema = z.object({
	studentId: z.string().uuid(),
	courseId: z.string().trim().min(1).max(100),
	coins: z.number().int().positive().optional(),
});

export const referralRewardSchema = z.object({
	studentId: z.string().uuid(),
	referredStudentId: z.string().uuid(),
	coins: z.number().int().positive().optional(),
});

export const adjustCoinsSchema = z.object({
	studentId: z.string().uuid(),
	amount: z.number().int().positive(),
	type: z.string().trim().min(3).max(50),
	referenceId: z.string().trim().min(1).max(100).optional(),
	description: z.string().trim().min(3).max(255).optional(),
	metadata: z.record(z.any()).optional(),
});

export const redeemCoinsSchema = z.object({
	studentId: z.string().uuid(),
	amount: z.number().int().positive(),
	reason: z.string().trim().min(3).max(255),
	referenceId: z.string().trim().min(1).max(100).optional(),
	metadata: z.record(z.any()).optional(),
});

// Session booking payment schema
// All learning types are home tutor only, except hybrid which is half home/half online
export const createSessionBookingPaymentSchema = z.object({
	studentId: z.string().uuid(),
	sessionCount: z.enum(['10', '20', '30']).transform(val => Number(val) as 10 | 20 | 30),
	groupSize: z.enum(['1', '2', '3']).transform(val => Number(val) as 1 | 2 | 3),
	learningMode: z.enum(['home', 'hybrid']), // Only home tutor or hybrid (half home/half online)
	courseId: z.string().uuid().optional(),
	trainerId: z.string().uuid().optional(),
	description: z.string().trim().max(500).optional(),
	metadata: z.record(z.any()).optional(),
	coinsToRedeem: z.number().int().nonnegative().optional(), // Number of coins to redeem (discount rate configurable via COIN_TO_RUPEE_RATE env var)
});

// Coin configuration update schema
export const updateCoinConfigurationSchema = z.object({
	key: z.string().trim().min(1).max(100),
	value: z.number().int().nonnegative(),
});

// Razorpay webhook verification schema
export const razorpayWebhookSchema = z.object({
	event: z.string(),
	payload: z.object({
		payment: z.object({
			entity: z.object({
				id: z.string(),
				order_id: z.string(),
				status: z.string(),
				method: z.string().optional(),
				amount: z.number(),
				currency: z.string(),
				created_at: z.number(),
			}),
		}),
	}),
});

