/**
 * Request logging middleware for production
 * Logs all API requests with structured data
 */

import { Request, Response, NextFunction } from 'express';

interface LogData {
  method: string;
  path: string;
  query?: Record<string, any>;
  params?: Record<string, any>;
  userId?: string;
  userRole?: string;
  ip?: string;
  userAgent?: string;
  timestamp: string;
  duration?: number;
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  const logData: LogData = {
    method: req.method,
    path: req.path,
    query: req.query,
    params: req.params,
    userId: (req as any).user?.id || (req as any).trainer?.id || (req as any).student?.id,
    userRole: (req as any).user?.role || (req as any).trainer ? 'trainer' : (req as any).student ? 'student' : 'admin',
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.get('user-agent'),
    timestamp: new Date().toISOString(),
  };

  // Request/response logging disabled for production
  // Uncomment below to enable logging:
  
  // Log request
  // console.log(`[${logData.method}] ${logData.path}`, {
  //   ...logData,
  //   type: 'request',
  // });

  // Request/response logging completely disabled
  // Uncomment below to enable error logging (5xx only):
  // res.on('finish', () => {
  //   const duration = Date.now() - startTime;
  //   const responseData = {
  //     ...logData,
  //     statusCode: res.statusCode,
  //     duration,
  //     type: 'response',
  //   };
  //   if (res.statusCode >= 500) {
  //     console.error(`[${logData.method}] ${logData.path} - ERROR`, responseData);
  //   }
  // });

  next();
}

