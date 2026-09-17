import type { UserCreateInput, UserUpdateInput } from '@hms/shared';
import { Doctor, User } from '../models/index.js';
import { invalidateUserCache } from './user-cache.js';
import { skipFor } from '../utils/http.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { changedFields, recordAudit } from './audit.service.js';
import { clearDoctorCache, hashPassword, revokeAllSessions } from './auth.service.js';
import type { Actor } from './actor.js';
import { escapeRegex } from '@hms/shared';

export async function listUsers(params: { q?: string; role?: string; page: number; limit: number }) {
  const filter: Record<string, unknown> = {};
  if (params.role) filter.role = params.role;
  if (params.q) {
    const rx = { $regex: escapeRegex(params.q), $options: 'i' };
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const [items, total] = await Promise.all([
    User.find(filter).sort({ name: 1 }).skip(skipFor(params.page, params.limit)).limit(params.limit),
    User.countDocuments(filter),
  ]);
  const doctorProfiles = await Doctor.find({ user: { $in: items.map((u) => u._id) } }).select('user');
  const withProfile = new Set(doctorProfiles.map((d) => String(d.user)));
  return {
    items: items.map((u) => ({ ...u.toJSON(), hasDoctorProfile: withProfile.has(u.id) })),
    total,
  };
}

export async function createUser(actor: Actor, input: UserCreateInput) {
  if (await User.exists({ email: input.email })) throw conflict('A user with this email already exists');
  const { password, ...rest } = input;
  const user = await User.create({ ...rest, passwordHash: await hashPassword(password) });
  await recordAudit(actor, {
    action: 'user.create',
    resource: 'user',
    resourceId: user.id,
    metadata: { role: user.role, email: user.email },
  });
  return user;
}

export async function updateUser(actor: Actor, id: string, input: UserUpdateInput) {
  const user = await User.findById(id);
  if (!user) throw notFound('User');
  if (id === actor.userId && (input.isActive === false || (input.role && input.role !== user.role))) {
    throw badRequest('You cannot disable your own account or change your own role');
  }
  if (user.role === 'admin' && (input.isActive === false || (input.role && input.role !== 'admin'))) {
    const otherAdmins = await User.countDocuments({ role: 'admin', isActive: true, _id: { $ne: user._id } });
    if (otherAdmins === 0) throw badRequest('At least one active administrator is required');
  }
  const before = user.toObject() as Record<string, unknown>;
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) user.set(key, value);
  }
  await user.save();
  invalidateUserCache(id);
  clearDoctorCache(id);
  if (input.isActive === false || (input.role && input.role !== before.role)) await revokeAllSessions(id);

  await recordAudit(actor, {
    action: 'user.update',
    resource: 'user',
    resourceId: id,
    metadata: {
      fields: changedFields(before, user.toObject() as Record<string, unknown>).filter((f) => f !== 'updatedAt'),
      role: user.role,
      isActive: user.isActive,
    },
  });
  return user;
}

export async function resetUserPassword(actor: Actor, id: string, newPassword: string) {
  const user = await User.findById(id);
  if (!user) throw notFound('User');
  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  await user.save();
  invalidateUserCache(id);
  await revokeAllSessions(id);
  await recordAudit(actor, { action: 'user.password_reset', resource: 'user', resourceId: id });
}

export async function unlockUser(actor: Actor, id: string) {
  const result = await User.updateOne({ _id: id }, { $set: { failedLoginCount: 0 }, $unset: { lockedUntil: 1 } });
  if (result.matchedCount === 0) throw notFound('User');
  await recordAudit(actor, { action: 'user.unlock', resource: 'user', resourceId: id });
}
