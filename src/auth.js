import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEYLEN, SCRYPT).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length, SCRYPT);
  return crypto.timingSafeEqual(expected, actual);
}

// Session cookies and API tokens are random; only their SHA-256 is stored.
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const newToken = (prefix = '') => prefix + crypto.randomBytes(32).toString('base64url');
