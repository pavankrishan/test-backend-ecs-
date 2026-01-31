/**
 * HTTP Client Utility
 * Centralized HTTP request handling with timeout and error handling
 */

import { request } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';

export interface HttpClientOptions {
	method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
	headers?: Record<string, string>;
	body?: string | object;
	timeout?: number;
}

export interface HttpClientResponse {
	statusCode: number;
	statusMessage: string;
	data: string;
	headers: Record<string, string | string[] | undefined>;
}

const DEFAULT_TIMEOUT = 10000; // 10 seconds

/**
 * Make HTTP request with automatic https/http detection
 */
export async function httpRequest(
	url: string,
	options: HttpClientOptions = {}
): Promise<HttpClientResponse> {
	const {
		method = 'GET',
		headers = {},
		body,
		timeout = DEFAULT_TIMEOUT,
	} = options;

	const urlObj = new URL(url);
	const isHttps = urlObj.protocol === 'https:';
	const httpModule = isHttps ? httpsRequest : request;

	// Convert body to string if object
	const bodyString = typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined;

	// Set content type if body is provided
	if (bodyString && !headers['Content-Type']) {
		headers['Content-Type'] = 'application/json';
	}

	// Set content length if body is provided
	if (bodyString && !headers['Content-Length']) {
		headers['Content-Length'] = Buffer.byteLength(bodyString).toString();
	}

	return new Promise<HttpClientResponse>((resolve, reject) => {
		const req = httpModule(
			{
				hostname: urlObj.hostname,
				port: urlObj.port || (isHttps ? 443 : 80),
				path: urlObj.pathname + (urlObj.search || ''),
				method,
				headers,
				timeout,
			},
			(res) => {
				let data = '';
				const responseHeaders: Record<string, string | string[] | undefined> = {};
				
				// Copy headers
				Object.keys(res.headers).forEach((key) => {
					responseHeaders[key] = res.headers[key];
				});

				res.on('data', (chunk) => {
					data += chunk.toString();
				});

				res.on('end', () => {
					resolve({
						statusCode: res.statusCode || 500,
						statusMessage: res.statusMessage || '',
						data,
						headers: responseHeaders,
					});
				});
			}
		);

		req.on('error', (error) => {
			reject(error);
		});

		req.on('timeout', () => {
			req.destroy();
			reject(new Error(`Request timeout after ${timeout}ms`));
		});

		if (bodyString) {
			req.write(bodyString);
		}
		req.end();
	});
}

/**
 * Make HTTP GET request
 */
export async function httpGet(url: string, options: Omit<HttpClientOptions, 'method' | 'body'> = {}): Promise<HttpClientResponse> {
	return httpRequest(url, { ...options, method: 'GET' });
}

/**
 * Make HTTP POST request
 */
export async function httpPost(url: string, body: string | object, options: Omit<HttpClientOptions, 'method' | 'body'> = {}): Promise<HttpClientResponse> {
	return httpRequest(url, { ...options, method: 'POST', body });
}

/**
 * Make HTTP PUT request
 */
export async function httpPut(url: string, body: string | object, options: Omit<HttpClientOptions, 'method' | 'body'> = {}): Promise<HttpClientResponse> {
	return httpRequest(url, { ...options, method: 'PUT', body });
}

/**
 * Parse JSON response safely
 */
export function parseJsonResponse<T = any>(data: string): T {
	try {
		return JSON.parse(data) as T;
	} catch (error) {
		throw new Error(`Failed to parse JSON response: ${error instanceof Error ? error.message : 'Unknown error'}`);
	}
}

/**
 * Check if response is successful
 */
export function isSuccessResponse(statusCode: number): boolean {
	return statusCode >= 200 && statusCode < 300;
}

