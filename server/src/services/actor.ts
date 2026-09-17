import type { Permission, Role } from '@hms/shared';

/** The authenticated user performing an operation, passed from controllers to services. */
export interface Actor {
  userId: string;
  name: string;
  role: Role;
  permissions: readonly Permission[];
  /** Doctor profile id when the user has one. */
  doctorId?: string;
  ip?: string;
  userAgent?: string;
}

/** Actor used by maintenance scripts. */
export function systemActor(userId: string, name = 'System'): Actor {
  return { userId, name, role: 'admin', permissions: [] };
}
