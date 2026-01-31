/**
 * Events Controller
 * 
 * Handles API endpoints for event polling (fallback when WebSocket unavailable).
 */

import { Request, Response } from 'express';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import { getPool } from '../config/database';
import type { BusinessEvent } from '@kodingcaravan/shared/events/types';

export class EventsController {
  /**
   * Get recent events since a timestamp
   * GET /api/v1/events/recent?since=1234567890
   */
  static getRecentEvents = asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).userId || (req as any).user?.id;
    const role = (req as any).user?.role || 'trainer';
    const sinceTimestamp = parseInt(req.query.since as string) || Date.now() - 24 * 60 * 60 * 1000; // Default: last 24 hours
    
    if (!userId) {
      return errorResponse(res, {
        statusCode: 401,
        message: 'Unauthorized',
      });
    }
    
    const pool = getPool();
    
    // Query events from event log table (if exists)
    // For now, return empty array - events are delivered via WebSocket
    // This endpoint is primarily for polling fallback
    const events: BusinessEvent[] = [];
    
    // TODO: Implement event log table query
    // SELECT * FROM business_event_log
    // WHERE timestamp > $1
    // AND (user_id = $2 OR role = $3)
    // ORDER BY timestamp ASC
    // LIMIT 100
    
    return successResponse(res, {
      message: 'Recent events fetched successfully',
      data: events,
    });
  });
}

