import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

/** RFC 4226 HOTP. `key` is a Buffer. */
export function hotp(key, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}

/** RFC 6238 TOTP (SHA-1, 30-second steps). */
export function totp(secretBase32, { time = Date.now(), step = 30, digits = 6 } = {}) {
  return hotp(base32Decode(secretBase32), Math.floor(time / 1000 / step), digits);
}

/** Accepts the current code and one step either side (clock drift). Constant-time compare. */
export function verifyTotp(secretBase32, code, { time = Date.now(), step = 30, digits = 6, window = 1 } = {}) {
  const given = String(code || '').replace(/\s/g, '');
  if (!/^\d+$/.test(given) || given.length !== digits) return false;
  const key = base32Decode(secretBase32);
  const counter = Math.floor(time / 1000 / step);
  let ok = false;
  for (let i = -window; i <= window; i++) {
    const expected = hotp(key, counter + i, digits);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) ok = true;
  }
  return ok;
}

export function otpauthUrl({ secret, account = 'admin', issuer = 'Fax You Up!' }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
