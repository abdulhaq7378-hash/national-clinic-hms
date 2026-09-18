/**
 * Checks a MongoDB connection string and explains what is wrong in plain words.
 *
 *   npm run check-db
 *
 * Reads MONGODB_URI from the .env file in this folder. Nothing is printed that
 * could reveal the password.
 */
import { MongoClient } from 'mongodb';
import { config } from 'dotenv';

config({ quiet: true });

const uri = process.env.MONGODB_URI?.trim();
const dbName = process.env.MONGODB_DB_NAME?.trim() || 'national_clinic';

const fail = (message, hint) => {
  console.error(`\n  FAILED: ${message}`);
  if (hint) console.error(`  Fix:    ${hint}`);
  console.error('');
  process.exit(1);
};

if (!uri) fail('No MONGODB_URI found in .env', 'Add the line MONGODB_URI=mongodb+srv://... to .env');
if (uri === 'memory') {
  fail(
    'MONGODB_URI is set to "memory", the local throwaway database',
    'Replace it with the Atlas connection string to test the real database',
  );
}

// Checks that do not need a network connection.
if (uri.includes('<') || uri.includes('>')) {
  fail(
    'The connection string still contains < > brackets',
    'Replace <db_password> including the brackets with the real password',
  );
}
if (/:\/\/[^:/@]+@/.test(uri)) {
  fail('The connection string has a username but no password', 'The format is mongodb+srv://user:password@host');
}

const credentials = uri.split('://')[1]?.split('@')[0] ?? '';
const [username, password = ''] = credentials.split(':');
const risky = [...password].filter((c) => '@:/?#[]%'.includes(c));
if (risky.length) {
  console.warn(
    `\n  WARNING: the password contains ${risky.join(' ')} which must be percent-encoded in a connection string.` +
      '\n  If the check below fails, reset the password in Atlas to letters and numbers only.',
  );
}

console.log(`\n  Host:     ${uri.split('@')[1]?.split('/')[0] ?? 'unknown'}`);
console.log(`  Username: ${username}`);
console.log(`  Password: ${password.length} characters`);
console.log(`  Database: ${dbName}`);
console.log('\n  Connecting...');

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 });
try {
  await client.connect();
  const admin = client.db(dbName).admin();
  const info = await admin.command({ hello: 1 });
  const collections = await client.db(dbName).listCollections().toArray();

  console.log('\n  SUCCESS: connected and authenticated.');
  console.log(`  Replica set:  ${info.setName ?? 'none (transactions need a replica set)'}`);
  console.log(`  Collections:  ${collections.length === 0 ? 'none yet, the database is empty' : collections.length}`);
  console.log('\n  This exact string will work in Render.\n');
} catch (error) {
  const message = String(error?.message ?? error);
  if (message.includes('bad auth') || message.includes('Authentication failed')) {
    fail(
      'The server was reached, but the username or password was rejected',
      'Atlas > Database Access > Edit user > Edit Password > Autogenerate > Copy > Update User, then rebuild the string',
    );
  }
  if (message.includes('ENOTFOUND') || message.includes('querySrv')) {
    fail('The cluster address could not be found', 'Check the part after @ matches the host Atlas gave you');
  }
  if (message.includes('timed out') || message.includes('ETIMEDOUT')) {
    fail(
      'Reached the network but the cluster did not answer',
      'Atlas > Network Access must contain 0.0.0.0/0 with status Active',
    );
  }
  fail(message);
} finally {
  await client.close().catch(() => {});
}
