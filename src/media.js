import fs from 'node:fs';

export const MAX_BYTES = 100 * 1024 * 1024;
export const MAX_FILES = 20;

export const TYPES = {
  'image/jpeg': { kind: 'image', ext: '.jpg' },
  'image/png': { kind: 'image', ext: '.png' },
  'image/gif': { kind: 'image', ext: '.gif' },
  'image/webp': { kind: 'image', ext: '.webp' },
  'image/avif': { kind: 'image', ext: '.avif' },
  'video/mp4': { kind: 'video', ext: '.mp4' },
  'video/webm': { kind: 'video', ext: '.webm' },
  'video/quicktime': { kind: 'video', ext: '.mov' },
};

const MP4_BRANDS = ['isom', 'iso2', 'iso5', 'iso6', 'mp41', 'mp42', 'M4V ', 'M4A ', 'avc1', 'dash'];

// Decide the type from the file's bytes, never from the filename or the
// uploader's Content-Type. Anything unrecognised is refused.
export function sniffType(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(16);
  const n = fs.readSync(fd, buf, 0, 16, 0);
  fs.closeSync(fd);
  const head = buf.subarray(0, n);
  const ascii = (start, end) => head.subarray(start, end).toString('latin1');

  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (n >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (ascii(0, 3) === 'GIF') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand === 'qt  ') return 'video/quicktime';
    if (MP4_BRANDS.includes(brand)) return 'video/mp4';
    return null;
  }
  if (n >= 4 && head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'video/webm';
  return null;
}

export function normalizeTag(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export function normalizeTags(input) {
  const list = Array.isArray(input) ? input : String(input ?? '').split(',');
  const out = [];
  for (const raw of list) {
    const tag = normalizeTag(raw);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
}

// Returns '' for empty, the cleaned URL for http(s), or null when invalid.
export function normalizeUrl(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  try {
    const url = new URL(s);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href.slice(0, 2000);
  } catch {
    // fall through to null
  }
  return null;
}

export const validUsername = (name) => /^[a-zA-Z0-9_-]{3,32}$/.test(name);

export function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
