import type { Request, Response } from 'express';
import { getActor } from '../middleware/auth.js';
import { eventBus, type RealtimeEvent } from './event-bus.js';

const HEARTBEAT_MS = 25_000;

/**
 * Server-Sent Events stream. Events carry identifiers only; the client
 * refetches through the REST API, which applies full authorization.
 */
export function eventStream(req: Request, res: Response) {
  const actor = getActor(req);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 5000\n\n');

  const listener = (event: RealtimeEvent) => {
    if (event.permission && !actor.permissions.includes(event.permission)) return;
    if (event.roles?.length || event.users?.length) {
      const forRole = event.roles?.includes(actor.role) ?? false;
      const forUser = event.users?.includes(actor.userId) ?? false;
      if (!forRole && !forUser) return;
    }
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
  };

  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS);
  eventBus.on('event', listener);
  req.on('close', () => {
    clearInterval(heartbeat);
    eventBus.off('event', listener);
  });
}
