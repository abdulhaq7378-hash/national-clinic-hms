// Prints a random value suitable for JWT_ACCESS_SECRET.
import { randomBytes } from 'node:crypto';

console.log(randomBytes(48).toString('base64url'));
