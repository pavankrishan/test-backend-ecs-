import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, AppError } from '@kodingcaravan/shared';

type AuthPayload = {
  sub: string;
  role: string;
  email?: string;
  phone?: string;
};

/**
 * Require authentication middleware
 * WHY: Protect routes that require trainer authentication
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new AppError('Authentication required', 401));
  }

  const token = header.slice(7);
  try {
    const payload = verifyAccessToken<AuthPayload>(token);
    
    // Verify role is trainer
    if (payload.role !== 'trainer') {
      return next(new AppError('Access denied: Trainer role required', 403));
    }

    (req as any).authUser = {
      id: payload.sub,
      role: payload.role,
      email: payload.email,
      phone: payload.phone,
    };
    next();
  } catch (error) {
    next(new AppError('Invalid or expired token', 401));
  }
}

