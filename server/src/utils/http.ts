import type { Response } from 'express';

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export function ok<T>(res: Response, data: T, meta?: object) {
  return res.status(200).json(meta ? { success: true, data, meta } : { success: true, data });
}

export function created<T>(res: Response, data: T) {
  return res.status(201).json({ success: true, data });
}

export function pageMeta(page: number, limit: number, total: number): PageMeta {
  return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}

export function skipFor(page: number, limit: number) {
  return (page - 1) * limit;
}
