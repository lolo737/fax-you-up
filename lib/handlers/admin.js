import { errorResponse, json, methodNotAllowed, readJson } from '../http.js';
import { verifyPassword } from '../crypto.js';
import { verifyTotp } from '../totp.js';
import { adminSessionCookie, ADMIN_COOKIE, clearCookie, isAdmin } from '../session.js';

/**
 * POST { password, code } — both factors must pass. ADMIN_PASSWORD_HASH is an
 * scrypt hash (see `npm run hash-password`), ADMIN_TOTP_SECRET a base32 secret
 * (see `npm run totp-setup`). A short fixed delay blunts brute force.
 */
export const createAdminLoginHandler = (deps) => async (req) => {
  if (req.method !== 'POST') return methodNotAllowed('POST');
  const { env, now = () => Date.now(), delayMs = 400 } = deps;
  if (!env.ADMIN_PASSWORD_HASH || !env.ADMIN_TOTP_SECRET || !env.SESSION_SECRET) {
    return errorResponse(503, 'Admin is not configured.', 'not_configured');
  }
  const { password, code } = await readJson(req);
  const passOk = verifyPassword(password || '', env.ADMIN_PASSWORD_HASH);
  const codeOk = verifyTotp(env.ADMIN_TOTP_SECRET, code, { time: now() });
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  if (!passOk || !codeOk) return errorResponse(401, 'Wrong password or code.', 'bad_credentials');
  return json({ ok: true }, 200, { 'Set-Cookie': adminSessionCookie(env, now()) });
};

export const createAdminLogoutHandler = (deps) => async (req) => {
  if (req.method !== 'POST') return methodNotAllowed('POST');
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(ADMIN_COOKIE, deps.env) });
};

/** GET — totals and the latest faxes and payments. */
export const createAdminStatsHandler = (deps) => async (req) => {
  if (req.method !== 'GET') return methodNotAllowed('GET');
  const { env, storage, now = () => Date.now() } = deps;
  if (!isAdmin(req, env, now())) return errorResponse(401, 'Not signed in.', 'unauthorised');

  const faxes = [];
  for (const key of await storage.list('fax/')) {
    const f = await storage.getJSON(key);
    if (f) faxes.push(f);
  }
  const payments = [];
  for (const key of await storage.list('payment/')) {
    const p = await storage.getJSON(key);
    if (p) payments.push(p);
  }
  const count = (s) => faxes.filter((f) => f.status === s).length;
  const t = now();
  const weekAgo = t - 7 * 86400 * 1000;
  const sum = (list) => list.reduce((acc, p) => acc + (p.amountCents || 0), 0);
  faxes.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  payments.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  return json({
    generatedAt: new Date(t).toISOString(),
    faxes: {
      total: faxes.length,
      delivered: count('delivered'),
      failed: count('failed'),
      inFlight: count('paid') + count('sending') + count('retry_scheduled'),
      quotedUnpaid: count('quoted'),
      pagesDelivered: faxes.filter((f) => f.status === 'delivered').reduce((a, f) => a + f.pages, 0),
    },
    money: {
      currency: 'eur',
      totalCents: sum(payments),
      last7DaysCents: sum(payments.filter((p) => Date.parse(p.at) >= weekAgo)),
      faxCents: sum(payments.filter((p) => p.kind === 'fax')),
      subscriptionCents: sum(payments.filter((p) => p.kind === 'subscription')),
    },
    recentFaxes: faxes.slice(0, 50).map((f) => ({
      id: f.id,
      createdAt: f.createdAt,
      to: f.to,
      pages: f.pages,
      status: f.status,
      attempts: f.attempts || 0,
      amountCents: f.amountCents,
      lastFailureReason: f.lastFailureReason || null,
      nextAttemptAt: f.nextAttemptAt || null,
    })),
    recentPayments: payments.slice(0, 50).map((p) => ({ id: p.id, at: p.at, kind: p.kind, amountCents: p.amountCents })),
  });
};
