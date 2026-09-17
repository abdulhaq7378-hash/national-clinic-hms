/**
 * Usage:
 *   npm run seed -- --general-ward-beds=<n>   Create the hospital's ward and bed structure
 *   npm run seed:demo                         Load demo data (only into a database named *demo*)
 */
import { env } from '../config/env.js';
import { connectDatabase, disconnectDatabase, syncIndexes } from '../db/connection.js';
import { ensureBaseData, ensureHospitalStructure } from '../seed/base.js';

function argValue(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  if (env.useMemoryDb) throw new Error('Seeding needs a real MONGODB_URI. The in-memory mode seeds itself.');
  await connectDatabase();
  await syncIndexes();
  await ensureBaseData();

  if (process.argv.includes('--demo')) {
    const { seedDemoData } = await import('../seed/demo/index.js');
    await seedDemoData();
  } else {
    const raw = argValue('general-ward-beds');
    const beds = raw ? Number.parseInt(raw, 10) : null;
    if (raw && (!beds || beds < 1 || beds > 200)) throw new Error('--general-ward-beds must be between 1 and 200');
    const result = await ensureHospitalStructure(beds);
    console.log('Private rooms: 3 rooms with one bed each.');
    console.log('General wards: General Ward 1 and General Ward 2.');
    if (beds) {
      console.log(`Created ${result.generalWardBedsCreated} new general ward beds.`);
    } else {
      console.log('No general ward beds were created. Pass --general-ward-beds=<n> or add beds in Rooms & Beds.');
    }
    console.log('Set the daily room charge for each bed under Rooms & Beds once prices are configured.');
  }
  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
