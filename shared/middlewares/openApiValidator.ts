/**
 * OpenAPI Request Validator Middleware
 * Validates incoming requests against OpenAPI schemas
 */

import { Request, Response, NextFunction } from 'express';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const openApi = require('express-openapi-validator');

interface OpenApiValidatorOptions {
  apiSpec: string | object;
  validateRequests?: boolean;
  validateResponses?: boolean;
  validateSecurity?: boolean;
  ignorePaths?: RegExp[];
}

/**
 * Create OpenAPI validator middleware
 */
export function createOpenApiValidator(options: OpenApiValidatorOptions) {
  const {
    apiSpec,
    validateRequests = true,
    validateResponses = false,
    validateSecurity = true,
    ignorePaths = [],
  } = options;

  const validator = openApi.middleware({
    apiSpec: typeof apiSpec === 'string' ? require(apiSpec) : apiSpec,
    validateRequests: {
      allowUnknownQueryParameters: false,
      coerceTypes: true,
      removeAdditional: 'all',
    },
    validateResponses: validateResponses ? {} : false,
    validateSecurity: validateSecurity ? {} : false,
    ignorePaths: (path: string) => {
      return ignorePaths.some((regex) => regex.test(path));
    },
  });

  return validator;
}

/**
 * Error handler for OpenAPI validation errors
 */
export function openApiErrorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (err.status === 400 || err.status === 422) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.errors || [{ message: err.message }],
      },
    });
  }

  if (err.status === 401) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    });
  }

  next(err);
}

