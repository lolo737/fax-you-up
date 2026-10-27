import crypto from 'node:crypto';

/** Password hashes look like: scrypt$16384$8$1$<salt b64>$<hash b64> */
export function hashPassword(password, { N = 16384, r = 8, p = 1 } = {}) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(expected, actual);
}

export function hmac(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Signed, expiring token: base64url(json).sig */
export function signToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(secret, body)}`;
}

export function verifyToken(token, secret, now = Date.now()) {
  if (!token || !secret) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig || !safeEqual(sig, hmac(secret, body))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && now > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function randomId(prefix = '', bytes = 12) {
  return `${prefix}${crypto.randomBytes(bytes).toString('base64url')}`;
}

export function emailKey(email) {
  return crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 32);
}

/** Verify a Telnyx (Ed25519) webhook signature. Signed message is `${timestamp}|${rawBody}`. */
export function verifyTelnyxSignature({ rawBody, signature, timestamp, publicKey, now = Date.now(), toleranceSeconds = 300 }) {
  if (!signature || !timestamp || !publicKey) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > toleranceSeconds) return false;
  try {
    const raw = Buffer.from(publicKey, 'base64');
    const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
    const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(`${timestamp}|${rawBody}`), key, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}
