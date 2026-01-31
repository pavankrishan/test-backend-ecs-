// shared/middlewares/globalErrorHandler.ts
import { Request, Response, NextFunction } from "express";
import { AppError } from "../config/errorHandler";
import { logApiError } from "../config/logger";

export const globalErrorHandler = (
    err: Error | AppError,
    req: Request,
    res: Response,
    _next: NextFunction
) => {
    const statusCode = err instanceof AppError ? err.statusCode : 500;
    const message =
        err instanceof AppError ? err.message : "Something went wrong";

    // Use enhanced logger for API errors
    logApiError(err, req, res, statusCode);

    return res.status(statusCode).json({
        success: false,
        message,
        ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    });
};
