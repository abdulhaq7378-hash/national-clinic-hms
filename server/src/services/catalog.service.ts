import type { ServiceInput } from '@hms/shared';
import { serviceUpdateSchema } from '@hms/shared';
import type { z } from 'zod';
import { Service } from '../models/index.js';
import { conflict, notFound } from '../utils/errors.js';
import { recordAudit } from './audit.service.js';
import type { Actor } from './actor.js';

type ServiceUpdateInput = z.infer<typeof serviceUpdateSchema>;

export function listServices(params: { category?: string; includeInactive?: boolean }) {
  const filter: Record<string, unknown> = {};
  if (params.category) filter.category = params.category;
  if (!params.includeInactive) filter.isActive = true;
  return Service.find(filter).sort({ category: 1, name: 1 });
}

export async function createService(actor: Actor, input: ServiceInput) {
  if (await Service.exists({ code: input.code })) throw conflict('A service with this code already exists');
  const service = await Service.create(input);
  await recordAudit(actor, {
    action: 'service.create',
    resource: 'service',
    resourceId: service.id,
    metadata: { code: service.code, price: service.price },
  });
  return service;
}

export async function updateService(actor: Actor, id: string, input: ServiceUpdateInput) {
  const service = await Service.findById(id);
  if (!service) throw notFound('Service');
  const previousPrice = service.price;
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) service.set(key, value);
  }
  await service.save();
  await recordAudit(actor, {
    action: 'service.update',
    resource: 'service',
    resourceId: id,
    metadata: { fields: Object.keys(input), previousPrice, price: service.price },
  });
  return service;
}
