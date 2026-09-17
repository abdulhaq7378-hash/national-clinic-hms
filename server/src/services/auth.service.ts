import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ROLE_PERMISSIONS, type Role } from '@hms/shared';
import { env } from '../config/env.js';
import { Doctor, Session, User } from '../models/index.js';
import { AppError, badRequest, unauthorized } from '../utils/errors.js';
import { recordAudit } from './audit.service.js';
import type { Actor } from './actor.js';

const BCRYPT_ROUNDS = 12;
// Compared against when the email is unknown, so response timing does not reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), BCRYPT_ROUNDS);

export function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

interface AccessPayload {
  sub: string;
  role: Role;
}

function signAccessToken(userId: string, role: Role) {
  return jwt.sign({ role } satisfies Omit<AccessPayload, 'sub'>, env.JWT_ACCESS_SECRET, {
    subject: userId,
    issuer: env.JWT_ISSUER,
    expiresIn: env.ACCESS_TOKEN_TTL_MINUTES * 60,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): AccessPayload & { iat: number } {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: env.JWT_ISSUER,
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;
    return { sub: decoded.sub!, role: decoded.role as Role, iat: decoded.iat! };
  } catch {
    throw unauthorized('Session expired or invalid');
  }
}

interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

async function createSession(userId: string, client: ClientInfo, family: string = randomUUID()) {
  const refreshToken = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await Session.create({
    user: userId,
    tokenHash: hashToken(refreshToken),
    family,
    expiresAt,
    userAgent: client.userAgent?.slice(0, 300),
    ip: client.ip,
  });
  return { refreshToken, expiresAt };
}

const doctorIdCache = new Map<string, { value: string | undefined; at: number }>();

export async function doctorIdForUser(userId: string): Promise<string | undefined> {
  const cached = doctorIdCache.get(userId);
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  const doctor = await Doctor.findOne({ user: userId }).select('_id').lean();
  const value = doctor ? String(doctor._id) : undefined;
  doctorIdCache.set(userId, { value, at: Date.now() });
  return value;
}

export function clearDoctorCache(userId?: string) {
  if (userId) doctorIdCache.delete(userId);
  else doctorIdCache.clear();
}

export async function publicUser(user: InstanceType<typeof User>) {
  const role = user.role as Role;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role,
    designation: user.designation,
    permissions: ROLE_PERMISSIONS[role],
    doctorId: await doctorIdForUser(user.id),
  };
}

export async function login(email: string, password: string, client: ClientInfo) {
  const user = await User.findOne({ email }).select('+passwordHash +failedLoginCount +lockedUntil');
  const actorFor = (u: typeof user): Actor | null =>
    u ? { userId: u.id, name: u.name, role: u.role as Role, permissions: [], ...client } : null;

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    await recordAudit({ name: email, ...client }, {
      action: 'auth.login',
      resource: 'user',
      outcome: 'failure',
      metadata: { reason: 'unknown_account' },
    });
    throw unauthorized('Invalid email or password');
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await recordAudit(actorFor(user), {
      action: 'auth.login',
      resource: 'user',
      resourceId: user.id,
      outcome: 'failure',
      metadata: { reason: 'locked' },
    });
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later or contact an administrator.');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid || !user.isActive) {
    if (!valid) {
      const failed = (user.failedLoginCount ?? 0) + 1;
      const update: Record<string, unknown> = { failedLoginCount: failed };
      if (failed >= env.LOGIN_MAX_FAILED_ATTEMPTS) {
        update.lockedUntil = new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60 * 1000);
        update.failedLoginCount = 0;
      }
      await User.updateOne({ _id: user._id }, { $set: update });
    }
    await recordAudit(actorFor(user), {
      action: 'auth.login',
      resource: 'user',
      resourceId: user.id,
      outcome: 'failure',
      metadata: { reason: valid ? 'inactive' : 'bad_password' },
    });
    throw unauthorized(valid ? 'This account is disabled' : 'Invalid email or password');
  }

  await User.updateOne(
    { _id: user._id },
    { $set: { lastLoginAt: new Date(), failedLoginCount: 0 }, $unset: { lockedUntil: 1 } },
  );
  const session = await createSession(user.id, client);
  const accessToken = signAccessToken(user.id, user.role as Role);
  await recordAudit(actorFor(user), { action: 'auth.login', resource: 'user', resourceId: user.id });
  return { accessToken, ...session, user: await publicUser(user) };
}

export async function refresh(refreshToken: string | undefined, client: ClientInfo) {
  if (!refreshToken) throw unauthorized('No active session');
  const tokenHash = hashToken(refreshToken);
  const session = await Session.findOne({ tokenHash });
  if (!session || session.expiresAt < new Date()) throw unauthorized('Session expired');

  if (session.revokedAt) {
    // Two tabs sharing the cookie can refresh at the same moment. The client retries
    // once, by which time the browser holds the newly rotated cookie.
    if (session.replacedAt && Date.now() - session.replacedAt.getTime() < 30_000) {
      throw new AppError(401, 'REFRESH_RACE', 'Session is being refreshed');
    }
    // A rotated token was presented again: treat the whole session family as compromised.
    await Session.updateMany({ family: session.family, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await recordAudit(null, {
      action: 'auth.refresh_reuse_detected',
      resource: 'session',
      resourceId: session.id,
      outcome: 'failure',
      metadata: { user: String(session.user) },
    });
    throw unauthorized('Session expired');
  }

  const user = await User.findById(session.user);
  if (!user || !user.isActive) throw unauthorized('Session expired');

  // Revoke atomically so that two concurrent refreshes cannot both succeed.
  const revoked = await Session.updateOne(
    { _id: session._id, revokedAt: null },
    { $set: { revokedAt: new Date(), replacedAt: new Date() } },
  );
  if (revoked.modifiedCount === 0) throw new AppError(401, 'REFRESH_RACE', 'Session is being refreshed');

  const next = await createSession(user.id, client, session.family);
  return { accessToken: signAccessToken(user.id, user.role as Role), ...next, user: await publicUser(user) };
}

export async function logout(refreshToken: string | undefined, actor?: Actor) {
  if (refreshToken) {
    await Session.updateOne({ tokenHash: hashToken(refreshToken), revokedAt: null }, { $set: { revokedAt: new Date() } });
  }
  if (actor) await recordAudit(actor, { action: 'auth.logout', resource: 'user', resourceId: actor.userId });
}

export async function revokeAllSessions(userId: string) {
  await Session.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export async function changePassword(actor: Actor, currentPassword: string, newPassword: string) {
  const user = await User.findById(actor.userId).select('+passwordHash');
  if (!user) throw unauthorized();
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw badRequest('Current password is incorrect');
  }
  if (currentPassword === newPassword) throw badRequest('Choose a password you have not just used');
  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  await user.save();
  await revokeAllSessions(user.id);
  await recordAudit(actor, { action: 'auth.password_change', resource: 'user', resourceId: user.id });
}
