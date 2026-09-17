import type { Role } from '@hms/shared';
import { REALTIME_EVENTS } from '@hms/shared';
import { Types } from 'mongoose';
import { Notification } from '../models/index.js';
import { publish } from '../realtime/event-bus.js';
import { logger } from '../utils/logger.js';
import type { Actor } from './actor.js';

interface NotifyInput {
  roles?: Role[];
  users?: string[];
  type: string;
  title: string;
  message: string;
  link?: string;
  severity?: 'info' | 'warning' | 'critical';
}

/** Creates a notification for real workflow events. Failures never break the workflow itself. */
export async function notify(input: NotifyInput) {
  try {
    const doc = await Notification.create({
      roles: input.roles ?? [],
      users: input.users ?? [],
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link,
      severity: input.severity ?? 'info',
    });
    publish({
      type: REALTIME_EVENTS.notification,
      payload: { id: doc.id },
      roles: input.roles,
      users: input.users,
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Failed to create notification');
  }
}

function audienceFilter(actor: Actor) {
  return {
    $or: [{ roles: actor.role }, { users: new Types.ObjectId(actor.userId) }],
  };
}

export async function listNotifications(actor: Actor, limit = 30) {
  const userId = new Types.ObjectId(actor.userId);
  const docs = await Notification.find(audienceFilter(actor))
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  const items = docs.map(({ readBy, _id, ...rest }) => ({
    ...rest,
    id: String(_id),
    read: (readBy ?? []).some((id) => id.equals(userId)),
  }));
  const unread = await Notification.countDocuments({ ...audienceFilter(actor), readBy: { $ne: userId } });
  return { items, unread };
}

export async function markNotificationsRead(actor: Actor, ids?: string[]) {
  const filter: Record<string, unknown> = { ...audienceFilter(actor) };
  if (ids?.length) filter._id = { $in: ids.map((id) => new Types.ObjectId(id)) };
  await Notification.updateMany(filter, { $addToSet: { readBy: new Types.ObjectId(actor.userId) } });
}
