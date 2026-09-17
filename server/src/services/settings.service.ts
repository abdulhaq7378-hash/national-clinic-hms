import type { SettingsUpdateInput } from '@hms/shared';
import { HospitalSettings } from '../models/index.js';
import { recordAudit } from './audit.service.js';
import type { Actor } from './actor.js';

type SettingsDoc = Awaited<ReturnType<typeof loadOrCreate>>;

let cache: { value: SettingsDoc; loadedAt: number } | null = null;
// Short cache so that settings changed on another server instance are picked up quickly.
const CACHE_MS = 30_000;

async function loadOrCreate() {
  const existing = await HospitalSettings.findOne({ key: 'default' });
  if (existing) return existing;
  try {
    return await HospitalSettings.create({ key: 'default' });
  } catch {
    // Another request created it concurrently.
    return (await HospitalSettings.findOne({ key: 'default' }))!;
  }
}

export async function getSettings() {
  if (cache && Date.now() - cache.loadedAt < CACHE_MS) return cache.value;
  const value = await loadOrCreate();
  cache = { value, loadedAt: Date.now() };
  return value;
}

export function clearSettingsCache() {
  cache = null;
}

export async function updateSettings(actor: Actor, input: SettingsUpdateInput) {
  const settings = await loadOrCreate();
  const sections = Object.keys(input) as (keyof SettingsUpdateInput)[];
  for (const section of sections) {
    const value = input[section];
    if (value === undefined) continue;
    const current = ((settings.toObject() as Record<string, unknown>)[section] ?? {}) as Record<string, unknown>;
    settings.set(section, { ...current, ...value });
  }
  settings.updatedBy = actor.userId as never;
  await settings.save();
  clearSettingsCache();
  await recordAudit(actor, {
    action: 'settings.update',
    resource: 'settings',
    resourceId: settings.id,
    metadata: { sections },
  });
  return settings;
}

export type ModuleName = 'pharmacy' | 'laboratory' | 'beds' | 'ot';

export async function isModuleEnabled(name: ModuleName) {
  const settings = await getSettings();
  return Boolean(settings.modules?.[name]);
}
