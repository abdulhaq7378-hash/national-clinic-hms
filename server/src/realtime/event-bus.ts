import { EventEmitter } from 'node:events';
import type { Permission, Role } from '@hms/shared';

export interface RealtimeEvent {
  type: string;
  /** Identifiers only. Clients refetch details through the authorized REST API. */
  payload: Record<string, unknown>;
  /** Only users holding this permission receive the event. */
  permission?: Permission;
  /** Limit delivery to specific roles or users (used by notifications). */
  roles?: Role[];
  users?: string[];
}

/**
 * In-process event bus feeding the Server-Sent Events stream. A multi-instance
 * deployment should replace this with a shared broker (Redis pub/sub or MongoDB
 * change streams) behind the same publish function.
 */
class EventBus extends EventEmitter {
  publish(event: RealtimeEvent) {
    this.emit('event', event);
  }
}

export const eventBus = new EventBus();
eventBus.setMaxListeners(500);

export function publish(event: RealtimeEvent) {
  eventBus.publish(event);
}
