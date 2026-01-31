import nodemailer, { Transporter } from 'nodemailer';
import logger from '@kodingcaravan/shared/config/logger';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
	if (transporter) {
		return transporter;
	}

	const host = process.env.SMTP_HOST;
	const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
	const user = process.env.SMTP_USER;
	const pass = process.env.SMTP_PASS;

	if (!host || !port || !user || !pass) {
		return null;
	}

	transporter = nodemailer.createTransport({
		host,
		port,
		secure: process.env.SMTP_SECURE === 'true',
		auth: {
			user,
			pass,
		},
	});

	return transporter;
}

const isSmtpDisabled =
	process.env.SMTP_DISABLE === 'true' ||
	(process.env.SMTP_DISABLE !== 'false' && process.env.NODE_ENV !== 'production');

export async function sendEmailOtp(email: string, code: string): Promise<void> {
	const from = process.env.SMTP_FROM || 'info@kodingcaravan.com';
	const subject =
		process.env.EMAIL_OTP_SUBJECT || 'Verify your KodingCaravan account';

	// Log OTP generation for development/debugging
	if (process.env.NODE_ENV !== 'production') {
		logger.debug('Email OTP generated for trainer', {
			email: email.substring(0, 3) + '***',
			service: 'trainer-auth-service',
		});
	}

if (isSmtpDisabled) {
	logger.debug('SMTP disabled for this environment, skipping email send', {
		email: email.substring(0, 3) + '***',
		service: 'trainer-auth-service',
	});
	return;
}

	const mailer = getTransporter();
	if (!mailer) {
		logger.debug('SMTP not configured, OTP would be sent', {
			email: email.substring(0, 3) + '***',
			service: 'trainer-auth-service',
		});
		return;
	}

	const text = `Hi,

Your verification code is ${code}.
It will expire in 10 minutes.

If you did not request this code, please ignore this email.

Thanks,
KodingCaravan`;

	await mailer.sendMail({
		from,
		to: email,
		subject,
		text,
	});
}

