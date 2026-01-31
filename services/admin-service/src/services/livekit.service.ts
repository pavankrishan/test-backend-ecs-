/**
 * LiveKit Service
 * Handles LiveKit room token generation and room management for live classes
 */

import { AccessToken } from 'livekit-server-sdk';
import type { Pool } from 'pg';

export interface LiveKitTokenRequest {
	sessionId: string;
	userId: string;
	userRole: 'student' | 'trainer';
	userName: string;
}

export interface LiveKitTokenResponse {
	token: string;
	url: string;
	roomName: string;
}

export class LiveKitService {
	private readonly url: string;
	private readonly apiKey: string;
	private readonly apiSecret: string;

	constructor(private readonly pool: Pool) {
		// Get LiveKit configuration from environment variables
		this.url = process.env.LIVEKIT_URL || '';
		this.apiKey = process.env.LIVEKIT_API_KEY || '';
		this.apiSecret = process.env.LIVEKIT_API_SECRET || '';

		if (!this.url || !this.apiKey || !this.apiSecret) {
			console.warn(
				'[LiveKit] Missing LiveKit configuration. Live classes will not work without proper environment variables.'
			);
		}
	}

	/**
	 * Generate LiveKit access token for joining a room
	 * Room name format: session-{sessionId}
	 */
	async generateAccessToken(request: LiveKitTokenRequest): Promise<LiveKitTokenResponse> {
		if (!this.url || !this.apiKey || !this.apiSecret) {
			throw new Error('LiveKit is not configured. Please set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET environment variables.');
		}

		// Verify session exists and user has access
		await this.verifySessionAccess(request.sessionId, request.userId, request.userRole);

		// Generate room name from session ID
		const roomName = `session-${request.sessionId}`;

		// Create access token
		const at = new AccessToken(this.apiKey, this.apiSecret, {
			identity: request.userId,
			name: request.userName,
		});

		// Grant permissions based on role
		// Trainers can publish video/audio and moderate
		// Students can publish video/audio (for interactive classes)
		const grant = {
			room: roomName,
			roomJoin: true,
			canPublish: true,
			canSubscribe: true,
			canPublishData: true,
		};

		// Trainers get additional permissions
		if (request.userRole === 'trainer') {
			// Trainers can update room metadata and kick participants
			at.addGrant({
				...grant,
				canUpdateOwnMetadata: true,
			});
		} else {
			at.addGrant(grant);
		}

		// Set token expiration (2 hours for live classes)
		at.ttl = '2h';

		const token = await at.toJwt();

		return {
			token,
			url: this.url,
			roomName,
		};
	}

	/**
	 * Verify that the user has access to the session
	 */
	private async verifySessionAccess(
		sessionId: string,
		userId: string,
		userRole: 'student' | 'trainer'
	): Promise<void> {
		const query = `
			SELECT 
				s.id,
				s.student_id,
				s.trainer_id,
				s.status,
				s.metadata,
				s.scheduled_date,
				s.scheduled_time,
				ta.status as allocation_status
			FROM tutoring_sessions s
			LEFT JOIN trainer_allocations ta ON s.allocation_id = ta.id
			WHERE s.id = $1
		`;

		const result = await this.pool.query(query, [sessionId]);

		if (result.rows.length === 0) {
			throw new Error('Session not found');
		}

		const session = result.rows[0];

		// Verify session is accessible
		if (session.status === 'cancelled') {
			throw new Error('Session has been cancelled');
		}

		// Verify user has access based on role
		if (userRole === 'student') {
			if (session.student_id !== userId) {
				throw new Error('You do not have access to this session');
			}
		} else if (userRole === 'trainer') {
			if (session.trainer_id !== userId) {
				throw new Error('You are not assigned to this session');
			}
		}

		// For online sessions, allow joining if session is scheduled or in progress
		// For offline sessions, only allow if session is in progress
		// Check metadata for session type (from purchase_sessions sync)
		let isOnlineSession = false;
		if (session.session_type === 'online') {
			isOnlineSession = true;
		} else if (session.metadata) {
			const metadata = typeof session.metadata === 'string' 
				? JSON.parse(session.metadata) 
				: session.metadata;
			if (metadata && typeof metadata === 'object' && 'sessionType' in metadata) {
				isOnlineSession = metadata.sessionType === 'online';
			}
		}

		if (!isOnlineSession && session.status !== 'in_progress') {
			throw new Error('This is an offline session. Please wait for the trainer to start the session.');
		}

		if (isOnlineSession && !['scheduled', 'in_progress'].includes(session.status)) {
			throw new Error(`Session is ${session.status}. You can only join scheduled or ongoing sessions.`);
		}
	}

	/**
	 * Get room information (for debugging/monitoring)
	 */
	async getRoomInfo(roomName: string): Promise<{
		name: string;
		numParticipants: number;
		creationTime: number;
	}> {
		// This would require LiveKit server SDK's room service
		// For now, return basic info
		return {
			name: roomName,
			numParticipants: 0,
			creationTime: Date.now(),
		};
	}
}
