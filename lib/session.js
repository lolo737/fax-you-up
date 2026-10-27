import { parseCookies, setCookie } from './http.js';
import { signToken, verifyToken } from './crypto.js';

export const CUSTOMER_COOKIE = 'fyu_session';
export const ADMIN_COOKIE = 'fyu_admin';

const secure = (env) => !String(env.SITE_URL || env.URL || '').startsWith('http://');

export function customerSessionCookie(env, email, now = Date.now()) {
  const days = 30;
  const token = signToken({ e: email, k: 'customer', exp: now + days * 86400 * 1000 }, env.SESSION_SECRET);
  return setCookie(CUSTOMER_COOKIE, token, { maxAgeSeconds: days * 86400, secure: secure(env) });
}

export function getCustomerEmail(req, env, now = Date.now()) {
  const payload = verifyToken(parseCookies(req)[CUSTOMER_COOKIE], env.SESSION_SECRET, now);
  return payload && payload.k === 'customer' ? payload.e : null;
}

export function adminSessionCookie(env, now = Date.now()) {
  const hours = 8;
  const token = signToken({ k: 'admin', exp: now + hours * 3600 * 1000 }, env.SESSION_SECRET);
  return setCookie(ADMIN_COOKIE, token, { maxAgeSeconds: hours * 3600, secure: secure(env) });
}

export function isAdmin(req, env, now = Date.now()) {
  const payload = verifyToken(parseCookies(req)[ADMIN_COOKIE], env.SESSION_SECRET, now);
  return Boolean(payload && payload.k === 'admin');
}

export function clearCookie(name, env) {
  return setCookie(name, '', { maxAgeSeconds: 0, secure: secure(env) });
}
