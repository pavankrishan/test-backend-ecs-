import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '@kodingcaravan/shared/utils/tokenManager';
import logger from '@kodingcaravan/shared/config/logger';

type RawUserPayload = {
  sub?: string;
  userId?: string;
  id?: string;
  email?: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
  [key: string]: unknown;
};

function normaliseRoles(payload: RawUserPayload): string[] | undefined {
  if (Array.isArray(payload.roles)) {
    return payload.roles.filter((role): role is string => typeof role === 'string');
  }

  if (payload.role && typeof payload.role === 'string') {
    return [payload.role];
  }

  return undefined;
}

export function attachUserContext(req: Request, res: Response, next: NextFunction): void | Response {
  const existingUser = (req as unknown as { user?: RawUserPayload }).user;
  if (existingUser) {
    next();
    return;
  }

  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    next();
    return;
  }

  try {
    const payload = verifyAccessToken<RawUserPayload>(token);
    (req as unknown as { user?: RawUserPayload }).user = {
      id: payload.sub || payload.userId || payload.id,
      email: payload.email,
      role: payload.role,
      roles: normaliseRoles(payload),
      permissions: payload.permissions,
      ...payload,
    };
  } catch (error) {
    const errorMessage = (error as Error).message;
    const isExpired = errorMessage.includes('expired') || errorMessage.includes('jwt expired');
    
    // Only log warnings for non-expired token errors (malformed, invalid signature, etc.)
    // Expired tokens are expected and handled by the client's refresh mechanism
    if (!isExpired) {
      logger.warn('Failed to verify access token', {
        error: errorMessage,
        service: 'course-service',
      });
    }
    
    return res.status(401).json({
      success: false,
      message: isExpired 
        ? 'Token expired. Please refresh your token.' 
        : 'Unauthorized: invalid token',
      code: isExpired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
    });
  }

  next();
}

