import type { NextFunction, Request, Response } from 'express';
import { z, type ZodType } from 'zod';
import { badRequest } from '../utils/errors.js';
import { objectId } from '@hms/shared';

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

function formatIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Validates and normalises request input. Parsed values are exposed on
 * `req.valid`; controllers never read unvalidated `req.body` or `req.query`.
 */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const valid: NonNullable<Request['valid']> = {};
    for (const key of ['params', 'query', 'body'] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(req[key] ?? {});
      if (!result.success) {
        const issues = formatIssues(result.error);
        throw badRequest(issues[0]?.message ?? 'Invalid request', issues);
      }
      valid[key] = result.data;
    }
    req.valid = { ...req.valid, ...valid };
    next();
  };
}

export const idParams = z.object({ id: objectId });

export function body<T>(req: Request): T {
  return req.valid?.body as T;
}

export function query<T>(req: Request): T {
  return req.valid?.query as T;
}

export function paramId(req: Request): string {
  return (req.valid?.params as { id: string }).id;
}
