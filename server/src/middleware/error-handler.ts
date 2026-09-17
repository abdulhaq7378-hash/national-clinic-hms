import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
  });
}

// Express identifies error handlers by their four arguments.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    return res.status(400).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: details[0]?.message ?? 'Invalid data', details },
    });
  }

  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: `Invalid value for ${err.path}` },
    });
  }

  if (err instanceof multer.MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooLarge ? 413 : 400).json({
      success: false,
      error: { code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST', message: tooLarge ? 'Files must be 10 MB or smaller' : 'Invalid file upload' },
    });
  }

  const mongoCode = (err as { code?: number }).code;
  if (mongoCode === 11000) {
    const fields = Object.keys((err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {});
    return res.status(409).json({
      success: false,
      error: { code: 'CONFLICT', message: 'A record with the same details already exists', details: { fields } },
    });
  }

  const bodyError = err as { type?: string; status?: number };
  if (bodyError.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } });
  }
  if (bodyError.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request is too large' } });
  }

  // Unexpected error: log details server-side, return a generic message.
  logger.error({ err, method: req.method, path: req.path }, 'Unhandled error');
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. The error has been logged.' },
  });
}
