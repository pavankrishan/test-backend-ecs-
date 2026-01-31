import { Response } from "express";

export const errorResponse = (
    res: Response,
    {
        statusCode = 400,
        message,
        errors,
    }: { statusCode?: number; message: string; errors?: any }
) => {
    return res.status(statusCode).json({
        success: false,
        message,
        errors,
    });
};

export const successResponse = (
    res: Response,
    {
        statusCode = 200,
        message,
        data,
    }: { statusCode?: number; message: string; data?: any }
) => {
    return res.status(statusCode).json({
        success: true,
        message,
        data,
    });
};
