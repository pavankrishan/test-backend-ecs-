import { OAuth2Client, TokenPayload } from 'google-auth-library';
import logger from '@kodingcaravan/shared/config/logger';

let client: OAuth2Client | null = null;

function getClient(): OAuth2Client | null {
	if (client) {
		return client;
	}

	const clientId = process.env.GOOGLE_CLIENT_ID;
	const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
	const redirectUri = process.env.GOOGLE_REDIRECT_URI;

	if (!clientId) {
		return null;
	}

	const options: { clientId: string; clientSecret?: string; redirectUri?: string } = {
		clientId,
	};
	if (clientSecret) {
		options.clientSecret = clientSecret;
	}
	if (redirectUri) {
		options.redirectUri = redirectUri;
	}
	client = new OAuth2Client(options);

	return client;
}

/**
 * Verify Google ID token (used by native and web flows)
 */
export async function verifyGoogleIdToken(idToken: string): Promise<TokenPayload | null> {
	const oauthClient = getClient();
	if (!oauthClient) {
		logger.warn('Google Auth credentials not configured; accepting token in development', {
			service: 'student-auth-service',
		});
		// For local/dev without credentials, decode token payload without verification.
		const base64Payload = idToken.split('.')[1];
		if (!base64Payload) {
			return null;
		}
		const payload = JSON.parse(Buffer.from(base64Payload, 'base64').toString());
		return payload as TokenPayload;
	}

	const audience = process.env.GOOGLE_CLIENT_ID;
	const verifyOptions: { idToken: string; audience?: string } = { idToken };
	if (audience) {
		verifyOptions.audience = audience;
	}
	const ticket = await oauthClient.verifyIdToken(verifyOptions);
	return ticket.getPayload() || null;
}

/**
 * Validate redirect URI format for platform-specific OAuth clients
 * 
 * For Android/iOS OAuth clients, redirect URI must:
 * - Start with: com.googleusercontent.apps.
 * - End with: :/oauth2redirect
 * 
 * This is Google's required format for platform-specific OAuth clients.
 * Custom schemes (like myapp://) are NOT allowed.
 */
function validateRedirectUri(redirectUri: string): void {
	// Must end with :/oauth2redirect (Google's required format)
	if (!redirectUri.endsWith(':/oauth2redirect')) {
		throw new Error(
			`Invalid redirect URI format: ${redirectUri}\n` +
			'For platform-specific OAuth clients (Android/iOS), redirect URI must end with :/oauth2redirect\n' +
			'Expected format: com.googleusercontent.apps.<client-id>:/oauth2redirect\n' +
			'Custom schemes (like myapp://) are NOT allowed for mobile OAuth'
		);
	}

	// Must start with com.googleusercontent.apps. (reverse client ID format)
	if (!redirectUri.startsWith('com.googleusercontent.apps.')) {
		throw new Error(
			`Invalid redirect URI format: ${redirectUri}\n` +
			'For platform-specific OAuth clients, redirect URI must use reverse client ID format\n' +
			'Expected format: com.googleusercontent.apps.<client-id>:/oauth2redirect\n' +
			'Do NOT use custom schemes or Web OAuth client redirect URIs'
		);
	}
}

/**
 * Exchange OAuth authorization code for ID token (web flow only)
 * This is called server-side to securely exchange the code for tokens
 * 
 * Validates redirect URI format to ensure it follows Google's requirements:
 * - Must use reverse client ID format: com.googleusercontent.apps.<client-id>:/oauth2redirect
 * - Custom schemes are NOT allowed
 */
export async function exchangeCodeForIdToken(
	code: string,
	redirectUri: string,
	codeVerifier?: string
): Promise<string> {
	const oauthClient = getClient();
	if (!oauthClient) {
		throw new Error('Google OAuth client not configured');
	}

	const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
	if (!clientSecret) {
		throw new Error('GOOGLE_CLIENT_SECRET is required for OAuth code exchange');
	}

	// Validate redirect URI format (must be reverse client ID format)
	validateRedirectUri(redirectUri);

	try {
		const tokenOptions: { code: string; redirect_uri: string; codeVerifier?: string } = {
			code,
			redirect_uri: redirectUri,
		};
		if (codeVerifier) {
			tokenOptions.codeVerifier = codeVerifier;
		}
		const { tokens } = await oauthClient.getToken(tokenOptions);

		if (!tokens.id_token) {
			throw new Error('No ID token in OAuth response');
		}

		return tokens.id_token;
	} catch (error: any) {
		logger.error('Google Auth code exchange failed', {
			error: error?.message || String(error),
			redirectUri: redirectUri.substring(0, 50) + '...', // Log partial URI for debugging
			stack: error?.stack,
			service: 'student-auth-service',
		});
		throw new Error(`OAuth code exchange failed: ${error.message || 'Unknown error'}`);
	}
}

