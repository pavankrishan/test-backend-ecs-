import { Request, Response, NextFunction } from 'express';

type MaybeUser = {
  id?: string;
  userId?: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
};

const DEFAULT_ADMIN_ROLES = [
  'super_admin',
  'state_admin',
  'district_admin',
  'zone_admin',
  'locality_supervisor',
];

function getUserFromRequest(req: Request): MaybeUser | undefined {
  return (req as unknown as { user?: MaybeUser }).user;
}

function normaliseRoles(user: MaybeUser | undefined): string[] {
  if (!user) {
    return [];
  }

  if (Array.isArray(user?.roles)) {
    return user.roles.filter((role): role is string => typeof role === 'string');
  }

  if (user?.role && typeof user.role === 'string') {
    return [user.role];
  }

  return [];
}

function hasAdminRole(user: MaybeUser | undefined): boolean {
  const roles = normaliseRoles(user);

  if (roles.length === 0) {
    return false;
  }

  const allowedRoles =
    (process.env.COURSE_SERVICE_ADMIN_ROLES?.split(',')
      .map((role) => role.trim())
      .filter(Boolean)) || DEFAULT_ADMIN_ROLES;

  return roles.some((role) => allowedRoles.includes(role));
}

export function requireAdminAccess(req: Request, res: Response, next: NextFunction): void {
  const user = getUserFromRequest(req);

  if (!user) {
    res.status(401).json({
      success: false,
      message: 'Unauthorized: missing user context',
    });
    return;
  }

  if (!hasAdminRole(user)) {
    res.status(403).json({
      success: false,
      message: 'Forbidden: admin privileges required',
    });
    return;
  }

  next();
}

export function requireAuthenticatedUser(req: Request, res: Response, next: NextFunction): void {
  const user = getUserFromRequest(req);

  if (!user) {
    res.status(401).json({
      success: false,
      message: 'Unauthorized: missing user context',
    });
    return;
  }

  next();
}


