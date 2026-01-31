import { Response } from 'express';

type SuccessPayload<T> = {
  statusCode?: number;
  message: string;
  data?: T;
};

type ErrorPayload = {
  statusCode?: number;
  message: string;
  errors?: unknown;
};

export function successResponse<T>(res: Response, payload: SuccessPayload<T>) {
  const { statusCode = 200, message, data } = payload;
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

export function errorResponse(res: Response, payload: ErrorPayload) {
  const { statusCode = 400, message, errors } = payload;
  return res.status(statusCode).json({
    success: false,
    message,
    errors,
  });
}

