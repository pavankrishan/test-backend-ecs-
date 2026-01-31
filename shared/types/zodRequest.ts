import { Request } from "express";
import { AnyZodObject, z } from "zod";

/**
 * Creates a typed Express request based on Zod schema definitions.
 * You can use it in controllers to strongly type req.body, req.query, req.params
 */
export type ZodRequest<
    T extends {
        body?: AnyZodObject;
        query?: AnyZodObject;
        params?: AnyZodObject;
    }
> = Request<
    T["params"] extends AnyZodObject ? z.infer<T["params"]> : any,
    any,
    T["body"] extends AnyZodObject ? z.infer<T["body"]> : any,
    T["query"] extends AnyZodObject ? z.infer<T["query"]> : any
>;
