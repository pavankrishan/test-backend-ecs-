import { createHash, randomBytes } from 'crypto';

export function hashString(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

export function generateNumericOtp(length = 6): string {
	const min = Math.pow(10, length - 1);
	const max = Math.pow(10, length) - 1;
	return Math.floor(Math.random() * (max - min + 1) + min)
		.toString()
		.padStart(length, '0');
}

export function generateRandomToken(bytes = 48): string {
	return randomBytes(bytes).toString('hex');
}

