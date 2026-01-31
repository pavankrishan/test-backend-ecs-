import { Request, Response, NextFunction } from "express";
import { AnyZodObject, ZodError } from "zod";
import { AppError } from "../config/errorHandler";
import { errorResponse } from "../utils/responseBuilder";

/**
 * Validates the request against a Zod schema.
 * Supports body, query, and params validation.
 */
export const validateRequest =
    (schema: {
        body?: AnyZodObject;
        query?: AnyZodObject;
        params?: AnyZodObject;
    }) =>
        (req: Request, res: Response, next: NextFunction) => {
            try {
                if (schema.body) schema.body.parse(req.body);
                if (schema.query) schema.query.parse(req.query);
                if (schema.params) schema.params.parse(req.params);
                next();
            } catch (err) {
                if (err instanceof ZodError) {
                    return errorResponse(res, {
                        statusCode: 400,
                        message: "Validation error",
                        errors: err.errors.map((e) => ({
                            field: e.path.join("."),
                            message: e.message,
                        })),
                    });
                }

                next(new AppError("Unexpected validation error", 500));
            }
        };
