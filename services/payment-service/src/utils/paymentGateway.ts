import { randomUUID, createHmac } from 'crypto';
import Razorpay from 'razorpay';
import logger from '@kodingcaravan/shared/config/logger';

type PaymentSession = {
	provider: string;
	providerPaymentId: string;
	paymentUrl: string | null;
	expiresAt: Date | null;
	orderId?: string;
	keyId?: string;
};

type CreatePaymentSessionInput = {
	studentId: string;
	amountCents: number;
	currency: string;
	description?: string;
	metadata?: Record<string, unknown>;
};

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const PROVIDER = 'razorpay';
const SESSION_TTL_MINUTES = Number(process.env.PAYMENT_SESSION_TTL_MINUTES ?? 30);

// Initialize Razorpay instance
let razorpayInstance: Razorpay | null = null;

function getRazorpayInstance(): Razorpay {
	if (!razorpayInstance) {
		if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
			throw new Error('Razorpay credentials not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET');
		}
		
		// Validate key format
		if (!RAZORPAY_KEY_ID.startsWith('rzp_')) {
			logger.warn('Razorpay key ID should start with "rzp_"', {
				service: 'payment-service',
			});
		}
		
		try {
			razorpayInstance = new Razorpay({
				key_id: RAZORPAY_KEY_ID,
				key_secret: RAZORPAY_KEY_SECRET,
			});
		} catch (error: any) {
			logger.error('Failed to create Razorpay instance', {
				error: error?.message || String(error),
				stack: error?.stack,
				service: 'payment-service',
			});
			throw new Error(`Failed to initialize Razorpay: ${error.message || 'Unknown error'}`);
		}
	}
	return razorpayInstance;
}

export async function createPaymentSession(input: CreatePaymentSessionInput): Promise<PaymentSession> {
	const { studentId, amountCents, currency, description, metadata } = input;

	// Validate amount
	if (amountCents <= 0) {
		throw new Error('Amount must be greater than zero');
	}

	// Razorpay minimum amount is 1 INR (100 paise)
	const MIN_AMOUNT_PAISE = 100;
	if (amountCents < MIN_AMOUNT_PAISE) {
		throw new Error(`Amount must be at least ${MIN_AMOUNT_PAISE} paise (1 INR). Received: ${amountCents} paise`);
	}

	// Convert cents to rupees (Razorpay uses paise, which is same as cents)
	const amount = amountCents; // Razorpay expects amount in smallest currency unit (paise for INR)

	try {
		const razorpay = getRazorpayInstance();

		// Create Razorpay order
		// Razorpay receipt field has a max length of 40 characters
		// Format: "rcpt_" + first 8 chars of studentId + "_" + last 6 digits of timestamp = 20 chars max
		const shortStudentId = studentId.substring(0, 8).replace(/-/g, '');
		const shortTimestamp = Date.now().toString().slice(-6);
		const receipt = `rcpt_${shortStudentId}_${shortTimestamp}`;

		const orderOptions = {
			amount: amount, // Amount in paise
			currency: currency.toUpperCase(),
			receipt: receipt, // Max 40 characters
			notes: {
				studentId,
				description: description || 'Session booking payment',
				...(metadata || {}),
			},
		};

		const order = await razorpay.orders.create(orderOptions);

		const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000);

		return {
			provider: PROVIDER,
			providerPaymentId: order.id,
			orderId: order.id,
			paymentUrl: null, // Razorpay doesn't provide a direct payment URL, frontend handles it
			expiresAt,
			keyId: RAZORPAY_KEY_ID,
		};
	} catch (error: any) {
		logger.error('Error creating payment session', {
			error: error?.message || String(error),
			description: error.error?.description,
			code: error.error?.code,
			statusCode: error.statusCode,
			field: error.error?.field,
			source: error.error?.source,
			step: error.error?.step,
			reason: error.error?.reason,
			studentId,
			amountCents,
			service: 'payment-service',
		});

		// Extract detailed error message from Razorpay error structure
		let errorMessage = 'Unknown error';
		if (error.error?.description) {
			errorMessage = error.error.description;
		} else if (error.error?.reason) {
			errorMessage = error.error.reason;
		} else if (error.message) {
			errorMessage = error.message;
		} else if (typeof error === 'string') {
			errorMessage = error;
		}

		throw new Error(`Failed to create payment session: ${errorMessage}`);
	}
}

/**
 * Verify Razorpay payment signature
 */
export function verifyPaymentSignature(
	orderId: string,
	paymentId: string,
	signature: string
): boolean {
	try {
		const text = `${orderId}|${paymentId}`;
		const generatedSignature = createHmac('sha256', RAZORPAY_KEY_SECRET)
			.update(text)
			.digest('hex');

		return generatedSignature === signature;
	} catch (error) {
		logger.error('Error verifying signature', {
			error: error instanceof Error ? error.message : String(error),
			orderId,
			service: 'payment-service',
		});
		return false;
	}
}

/**
 * Get Razorpay payment details
 */
export async function getPaymentDetails(paymentId: string): Promise<any> {
	try {
		const razorpay = getRazorpayInstance();
		const payment = await razorpay.payments.fetch(paymentId);
		return payment;
	} catch (error: any) {
		logger.error('Error fetching payment details', {
			error: error?.message || String(error),
			stack: error?.stack,
			paymentId,
			service: 'payment-service',
		});
		throw new Error(`Failed to fetch payment details: ${error.message || 'Unknown error'}`);
	}
}

