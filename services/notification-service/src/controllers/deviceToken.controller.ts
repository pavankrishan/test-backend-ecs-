import { Request, Response } from 'express';
import {
  successResponse,
  errorResponse,
} from '@kodingcaravan/shared/utils/responseBuilder';
import { DeviceTokenService } from '../services/deviceToken.service';

type MaybeString = string | undefined | null;

export class DeviceTokenController {
  constructor(private readonly deviceTokenService: DeviceTokenService) {}

  registerToken = async (req: Request, res: Response) => {
    try {
      const { token, platform, role, deviceId, deviceName, appVersion } = req.body;
      const userId = this.resolveUserId(req);

      if (!token || !platform) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'token and platform are required',
        });
      }

      if (!['ios', 'android', 'web'].includes(platform)) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'platform must be one of: ios, android, web',
        });
      }

      if (role && !['student', 'trainer'].includes(role)) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'role must be one of: student, trainer',
        });
      }

      if (!userId) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'User ID is required',
        });
      }

      const deviceToken = await this.deviceTokenService.registerToken({
        userId,
        token,
        platform,
        role, // Include role for role-specific notifications
        deviceId,
        deviceName,
        appVersion,
      });

      return successResponse(res, {
        statusCode: 201,
        message: 'Device token registered successfully',
        data: deviceToken,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error?.message || 'Failed to register device token',
      });
    }
  };

  getUserTokens = async (req: Request, res: Response) => {
    try {
      const userId = this.resolveUserId(req);

      if (!userId) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'User ID is required',
        });
      }

      const tokens = await this.deviceTokenService.getUserTokens(userId);

      return successResponse(res, {
        message: 'Device tokens retrieved successfully',
        data: { tokens },
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error?.message || 'Failed to retrieve device tokens',
      });
    }
  };

  deactivateToken = async (req: Request, res: Response) => {
    try {
      const { token } = req.body;
      const userId = this.resolveUserId(req);

      if (!token) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'token is required',
        });
      }

      const deactivated = await this.deviceTokenService.deactivateToken(
        token,
        userId ?? undefined
      );

      if (!deactivated) {
        return errorResponse(res, {
          statusCode: 404,
          message: 'Device token not found',
        });
      }

      return successResponse(res, {
        message: 'Device token deactivated successfully',
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error?.message || 'Failed to deactivate device token',
      });
    }
  };

  deleteToken = async (req: Request, res: Response) => {
    try {
      const { token } = req.body;
      const userId = this.resolveUserId(req);

      if (!token) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'token is required',
        });
      }

      const deleted = await this.deviceTokenService.deleteToken(
        token,
        userId ?? undefined
      );

      if (!deleted) {
        return errorResponse(res, {
          statusCode: 404,
          message: 'Device token not found',
        });
      }

      return successResponse(res, {
        message: 'Device token deleted successfully',
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error?.message || 'Failed to delete device token',
      });
    }
  };

  private resolveUserId(req: Request): string | undefined {
    const user = (req as any).user;
    if (user?.id) return user.id;
    if (user?._id) return user._id;
    if (req.query.userId) return String(req.query.userId);
    if (req.body.userId) return String(req.body.userId);
    return undefined;
  }
}

