/**
 * PHASE 5: Ownership Validation Middleware
 * 
 * Ensures users can only access resources they own.
 * Prevents unauthorized access to sessions, allocations, purchases, etc.
 * 
 * Usage:
 * ```typescript
 * import { validateOwnership } from '@kodingcaravan/shared/middlewares/ownershipValidator';
 * 
 * app.get('/api/v1/sessions/:id', 
 *   validateOwnership('session', 'id'),
 *   getSessionController
 * );
 * ```
 */

import { Request, Response, NextFunction } from 'express';
import { createPostgresPool } from '../databases/postgres/connection';
import type { Pool } from 'pg';
import logger from '../config/logger';

// Lazy initialization of database pool
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = createPostgresPool({ max: 10 }) as unknown as Pool;
  }
  return pool;
}

/**
 * PHASE 5: Validate ownership of a resource
 * 
 * @param resourceType - Type of resource (session, allocation, purchase)
 * @param resourceIdParam - Name of the route parameter containing resource ID (default: 'id')
 */
export function validateOwnership(
  resourceType: 'session' | 'allocation' | 'purchase' | 'course',
  resourceIdParam: string = 'id'
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const resourceId = req.params[resourceIdParam];
      const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.sub;
      const role = (req as any).userRole || (req as any).user?.role;
      
      if (!resourceId) {
        res.status(400).json({
          success: false,
          message: `Missing ${resourceIdParam} parameter`,
        });
        return;
      }
      
      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Unauthorized: Authentication required',
        });
        return;
      }
      
      // Admin can access anything
      if (role === 'admin') {
        return next();
      }
      
      // Check ownership based on resource type
      let isOwner = false;
      const dbPool = getPool();
      
      if (resourceType === 'session') {
        const result = await dbPool.query(
          `SELECT student_id, trainer_id FROM tutoring_sessions WHERE id = $1`,
          [resourceId]
        );
        
        if (result.rows.length === 0) {
          res.status(404).json({
            success: false,
            message: 'Session not found',
          });
          return;
        }
        
        const session = result.rows[0];
        isOwner = session.student_id === userId || session.trainer_id === userId;
        
      } else if (resourceType === 'allocation') {
        const result = await dbPool.query(
          `SELECT student_id, trainer_id FROM trainer_allocations WHERE id = $1`,
          [resourceId]
        );
        
        if (result.rows.length === 0) {
          res.status(404).json({
            success: false,
            message: 'Allocation not found',
          });
          return;
        }
        
        const allocation = result.rows[0];
        isOwner = allocation.student_id === userId || allocation.trainer_id === userId;
        
      } else if (resourceType === 'purchase') {
        const result = await dbPool.query(
          `SELECT student_id FROM student_course_purchases WHERE id = $1`,
          [resourceId]
        );
        
        if (result.rows.length === 0) {
          res.status(404).json({
            success: false,
            message: 'Purchase not found',
          });
          return;
        }
        
        const purchase = result.rows[0];
        isOwner = purchase.student_id === userId;
        
      } else if (resourceType === 'course') {
        // For course access, check if student has an active purchase
        const result = await dbPool.query(
          `SELECT student_id FROM student_course_purchases 
           WHERE course_id = $1 AND student_id = $2 AND is_active = true`,
          [resourceId, userId]
        );
        
        isOwner = result.rows.length > 0;
      }
      
      if (!isOwner) {
        logger.warn('Ownership validation failed', {
          resourceType,
          resourceId,
          userId,
          role,
          path: req.path,
          method: req.method,
          service: 'ownership-validator',
        });
        
        res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have access to this resource',
        });
        return;
      }
      
      // Ownership validated - proceed
      next();
    } catch (error) {
      logger.error('Ownership validation error', {
        error: error instanceof Error ? error.message : String(error),
        resourceType,
        resourceIdParam,
        path: req.path,
        method: req.method,
        service: 'ownership-validator',
      });
      
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  };
}
