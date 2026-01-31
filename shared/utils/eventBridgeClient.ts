/**
 * EventBridge Client for Publishing Events
 * 
 * Publishes events to AWS EventBridge for event-driven architecture.
 * Events are consumed by SNS, SQS, Lambda, and other AWS services.
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import logger from '../config/logger';

const eventBridgeClient = new EventBridgeClient({
	region: process.env.AWS_REGION || 'us-east-1',
});

const EVENT_BUS_NAME = process.env.EVENT_BRIDGE_BUS_NAME || 'application-events';

export interface EventDetail {
	[key: string]: any;
}

/**
 * Publish event to EventBridge
 * 
 * @param source - Source service name (e.g., 'admin-service')
 * @param detailType - Event type (e.g., 'TrainerJourneyStarted')
 * @param detail - Event payload
 */
export async function publishEvent(
	source: string,
	detailType: string,
	detail: EventDetail
): Promise<void> {
	try {
		const command = new PutEventsCommand({
			Entries: [
				{
					Source: source,
					DetailType: detailType,
					Detail: JSON.stringify(detail),
					EventBusName: EVENT_BUS_NAME,
				},
			],
		});

		const response = await eventBridgeClient.send(command);

		if (response.FailedEntryCount && response.FailedEntryCount > 0) {
			logger.error('EventBridge publish failed', {
				source,
				detailType,
				failedCount: response.FailedEntryCount,
				entries: response.Entries,
			});
			// Don't throw - event publishing failures should not break request flow
			// Events are best-effort for non-critical flows
			return;
		}

		logger.info('Event published to EventBridge', {
			source,
			detailType,
			eventId: response.Entries?.[0]?.EventId,
		});
	} catch (error) {
		logger.error('Error publishing event to EventBridge', {
			source,
			detailType,
			error: error instanceof Error ? error.message : String(error),
		});
		// Don't throw - event publishing failures should not break request flow
		// Events are best-effort for non-critical flows
	}
}

/**
 * Publish TrainerJourneyStarted event
 */
export async function publishTrainerJourneyStarted(detail: {
	trainerId: string;
	studentId: string;
	sessionId: string;
	startTime: string;
}): Promise<void> {
	await publishEvent('admin-service', 'TrainerJourneyStarted', detail);
}

/**
 * Publish TrainerJourneyEnded event
 */
export async function publishTrainerJourneyEnded(detail: {
	trainerId: string;
	studentId: string;
	sessionId: string;
	endTime: string;
	reason: 'arrived' | 'cancelled' | 'timeout';
}): Promise<void> {
	await publishEvent('admin-service', 'TrainerJourneyEnded', detail);
}
