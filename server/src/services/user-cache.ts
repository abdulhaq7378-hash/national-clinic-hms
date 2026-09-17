import type { Role } from '@hms/shared';
import { User } from '../models/index.js';

export interface CachedUser {
  name: string;
  role: Role;
  isActive: boolean;
  passwordChangedAt?: number;
  at: number;
}

// Short-lived cache so a disabled account or role change takes effect within seconds
// without a database read on every request.
const userCache = new Map<string, CachedUser>();
const USER_CACHE_MS = 10_000;

export function invalidateUserCache(userId: string) {
  userCache.delete(userId);
}

export async function loadAuthUser(userId: string): Promise<CachedUser | null> {
  const cached = userCache.get(userId);
  if (cached && Date.now() - cached.at < USER_CACHE_MS) return cached;
  const user = await User.findById(userId).select('name role isActive passwordChangedAt').lean();
  if (!user) return null;
  const value: CachedUser = {
    name: user.name,
    role: user.role as Role,
    isActive: Boolean(user.isActive),
    passwordChangedAt: user.passwordChangedAt?.getTime(),
    at: Date.now(),
  };
  userCache.set(userId, value);
  return value;
}
