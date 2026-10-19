import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;

// stored as scrypt$<salt hex>$<hash hex>
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(String(password), salt, KEY_LENGTH);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, salt, hashHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(String(password), salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}
