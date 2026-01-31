import jwt from 'jsonwebtoken';

type JWTPayload = Record<string, any>;

const DEFAULT_ACCESS_SECRET =
	process.env.JWT_ACCESS_SECRET ||
	process.env.JWT_SECRET ||
	'change_this_to_a_strong_secret_in_env';
const DEFAULT_REFRESH_SECRET =
	process.env.JWT_REFRESH_SECRET ||
	process.env.JWT_SECRET ||
	'change_this_to_a_strong_refresh_secret_in_env';
// Production: Short-lived access tokens (5-10 minutes)
// This reduces exposure window if token is compromised
const DEFAULT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '10m';
const DEFAULT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';

export function signToken(
	payload: JWTPayload,
	options?: { expiresIn?: string; secret?: string }
): string {
	const {
		expiresIn = DEFAULT_ACCESS_EXPIRES_IN,
		secret = DEFAULT_ACCESS_SECRET,
	} = options || {};
	return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);
}

export function verifyToken<T = any>(token: string, secret?: string): T {
	return jwt.verify(token, secret || DEFAULT_ACCESS_SECRET) as T;
}

export function signAccessToken(payload: JWTPayload, expiresIn = DEFAULT_ACCESS_EXPIRES_IN): string {
	return signToken(payload, { expiresIn, secret: DEFAULT_ACCESS_SECRET });
}

export function signRefreshToken(payload: JWTPayload, expiresIn = DEFAULT_REFRESH_EXPIRES_IN): string {
	return jwt.sign(payload, DEFAULT_REFRESH_SECRET, { expiresIn } as jwt.SignOptions);
}

export function verifyAccessToken<T = any>(token: string): T {
	return verifyToken<T>(token, DEFAULT_ACCESS_SECRET);
}

export function verifyRefreshToken<T = any>(token: string): T {
	return jwt.verify(token, DEFAULT_REFRESH_SECRET) as T;
}

export default {
	signToken,
	verifyToken,
	signAccessToken,
	signRefreshToken,
	verifyAccessToken,
	verifyRefreshToken,
};
