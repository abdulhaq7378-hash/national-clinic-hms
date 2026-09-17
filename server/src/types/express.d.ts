import type { Actor } from '../services/actor.js';

declare global {
  namespace Express {
    interface Request {
      actor?: Actor;
      valid?: {
        body?: any;
        query?: any;
        params?: any;
      };
    }
  }
}

export {};
