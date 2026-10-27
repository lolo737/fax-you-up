import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base32Decode, base32Encode, generateSecret, hotp, totp, verifyTotp, otpauthUrl } from '../lib/totp.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { createAdminLoginHandler, createAdminStatsHandler } from '../lib/handlers/admin.js';
import { makeDeps } from './helpers.js';

// RFC 6238 Appendix B test vectors (SHA-1, secret "12345678901234567890").
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
const VECTORS = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

test('TOTP matches the RFC 6238 test vectors', () => {
  for (const [seconds, code] of VECTORS) {
    assert.equal(totp(RFC_SECRET, { time: seconds * 1000, digits: 8 }), code);
  }
});

test('HOTP matches RFC 4226 vector', () => {
  assert.equal(hotp(Buffer.from('12345678901234567890'), 0), '755224');
});

test('base32 round trip', () => {
  const s = generateSecret();
  assert.match(s, /^[A-Z2-7]{32}$/);
  assert.equal(base32Encode(base32Decode(s)), s);
});

test('verifyTotp accepts current and adjacent step, rejects others', () => {
  const secret = generateSecret();
  const t = Date.parse('2026-10-27T10:00:00Z');
  assert.ok(verifyTotp(secret, totp(secret, { time: t }), { time: t }));
  assert.ok(verifyTotp(secret, totp(secret, { time: t - 30_000 }), { time: t }));
  assert.ok(!verifyTotp(secret, totp(secret, { time: t - 90_000 }), { time: t }));
  assert.ok(!verifyTotp(secret, '12345', { time: t }));
  assert.ok(!verifyTotp(secret, 'abcdef', { time: t }));
  assert.ok(!verifyTotp(secret, '', { time: t }));
});

test('otpauth URL is well formed', () => {
  assert.match(otpauthUrl({ secret: 'ABC' }), /^otpauth:\/\/totp\/Fax%20You%20Up!%3Aadmin\?secret=ABC&issuer=Fax%20You%20Up!/);
});

test('admin login needs both the password and a valid TOTP code', async () => {
  const secret = generateSecret();
  const deps = makeDeps();
  deps.env.ADMIN_PASSWORD_HASH = hashPassword('correct horse battery staple');
  deps.env.ADMIN_TOTP_SECRET = secret;
  const login = createAdminLoginHandler(deps);
  const post = (body) => new Request('https://x', { method: 'POST', body: JSON.stringify(body) });
  const code = totp(secret, { time: deps.now() });

  assert.equal((await login(post({ password: 'wrong', code }))).status, 401);
  assert.equal((await login(post({ password: 'correct horse battery staple', code: '000000' === code ? '111111' : '000000' }))).status, 401);
  const ok = await login(post({ password: 'correct horse battery staple', code }));
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/);

  const stats = createAdminStatsHandler(deps);
  assert.equal((await stats(new Request('https://x'))).status, 401);
  const res = await stats(new Request('https://x', { headers: { cookie } }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.faxes.total, 0);
  assert.equal(body.money.totalCents, 0);
});

test('admin is closed when not configured', async () => {
  const res = await createAdminLoginHandler(makeDeps())(new Request('https://x', { method: 'POST', body: '{}' }));
  assert.equal(res.status, 503);
});

test('password hashing', () => {
  const h = hashPassword('s3cret');
  assert.ok(verifyPassword('s3cret', h));
  assert.ok(!verifyPassword('S3cret', h));
  assert.ok(!verifyPassword('s3cret', 'garbage'));
});
