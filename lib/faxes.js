/**
 * Fax records and their life cycle.
 *
 *   quoted ──pay──▶ paid ──▶ sending ──▶ delivered            (success e-mail)
 *                     ▲          │
 *                     │          ▼
 *                     └── retry_scheduled ◀── failed attempt
 *                                │
 *                                ▼ (permanent reason or attempts spent)
 *                              failed                         (failure e-mail, once)
 *
 * Storage keys:
 *   fax/<id>                 the fax record (JSON)
 *   files/<id>.pdf           the uploaded document
 *   telnyx/<telnyxFaxId>     -> { faxId } (lookup for webhooks)
 *   customer/<emailKey>      customer record (paid fax count, subscription, fax ids)
 *   stripe-customer/<cusId>  -> { emailKey }
 *   payment/<id>             money in (admin dashboard)
 */
import { decideAfterFailure } from './retry.js';
import { emailKey, signToken } from './crypto.js';
import { faxDeliveredEmail, faxFailedEmail } from './email/templates.js';

export const faxKey = (id) => `fax/${id}`;
export const fileKey = (id) => `files/${id}.pdf`;
export const customerKey = (email) => `customer/${emailKey(email)}`;

export function siteUrl(env) {
  return (env.SITE_URL || env.URL || 'http://localhost:8888').replace(/\/$/, '');
}

export async function getFax(storage, id) {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(id || ''))) return null;
  return storage.getJSON(faxKey(id));
}

export async function saveFax(storage, fax, now = Date.now()) {
  fax.updatedAt = new Date(now).toISOString();
  await storage.setJSON(faxKey(fax.id), fax);
  return fax;
}

export function addHistory(fax, event, now = Date.now(), extra = {}) {
  fax.history = fax.history || [];
  fax.history.push({ at: new Date(now).toISOString(), event, ...extra });
}

export async function getCustomer(storage, email) {
  return (
    (await storage.getJSON(customerKey(email))) || {
      email: String(email).trim().toLowerCase(),
      paidFaxCount: 0,
      faxIds: [],
      subscription: null,
      stripeCustomerId: null,
    }
  );
}

export async function saveCustomer(storage, customer) {
  await storage.setJSON(customerKey(customer.email), customer);
  if (customer.stripeCustomerId) {
    await storage.setJSON(`stripe-customer/${customer.stripeCustomerId}`, { emailKey: emailKey(customer.email) });
  }
  return customer;
}

export async function getCustomerByStripeId(storage, stripeCustomerId) {
  const link = await storage.getJSON(`stripe-customer/${stripeCustomerId}`);
  return link ? storage.getJSON(`customer/${link.emailKey}`) : null;
}

export function hasActiveSubscription(customer) {
  return Boolean(customer && customer.subscription && customer.subscription.status === 'active');
}

export function subscriptionPagesLeft(customer, cfg) {
  if (!hasActiveSubscription(customer)) return 0;
  return Math.max(0, cfg.subscription.includedPagesPerMonth - (customer.subscription.pagesUsed || 0));
}

export async function recordPayment(storage, { id, amountCents, currency, kind, email, faxId = null }, now = Date.now()) {
  const key = `payment/${id}`;
  if (await storage.getJSON(key)) return false; // idempotent
  await storage.setJSON(key, { id, amountCents, currency, kind, email, faxId, at: new Date(now).toISOString() });
  return true;
}

/** Signed, time-limited URL Telnyx uses to fetch the PDF. */
export function mediaUrl(env, faxId, now = Date.now()) {
  const token = signToken({ f: faxId, exp: now + 24 * 3600 * 1000 }, env.MEDIA_URL_SECRET || env.SESSION_SECRET);
  return `${siteUrl(env)}/api/media?t=${encodeURIComponent(token)}`;
}

/**
 * Make one sending attempt. A Telnyx API error counts as a failed attempt and
 * goes through the same retry policy as a failure reported by webhook.
 */
export async function attemptSend(fax, deps) {
  const { storage, telnyx, env, now = () => Date.now() } = deps;
  const t = now();
  fax.attempts = (fax.attempts || 0) + 1;
  fax.nextAttemptAt = null;
  try {
    const res = await telnyx.sendFax({
      to: fax.to,
      mediaUrl: mediaUrl(env, fax.id, t),
      webhookUrl: `${siteUrl(env)}/api/telnyx-webhook`,
      clientState: fax.id,
    });
    fax.status = 'sending';
    fax.telnyxFaxIds = [...(fax.telnyxFaxIds || []), res.id];
    fax.currentTelnyxFaxId = res.id;
    addHistory(fax, 'attempt_started', t, { attempt: fax.attempts, telnyxFaxId: res.id });
    await storage.setJSON(`telnyx/${res.id}`, { faxId: fax.id });
    await saveFax(storage, fax, t);
  } catch (err) {
    addHistory(fax, 'attempt_error', t, { attempt: fax.attempts, error: String(err.message).slice(0, 200) });
    await handleFailure(fax, `api_error: ${err.message}`, deps);
  }
  return fax;
}

/** Apply the retry policy to a failed attempt; e-mails the customer only when final. */
export async function handleFailure(fax, failureReason, deps) {
  const { storage, mailer, env, retryPolicy, now = () => Date.now() } = deps;
  const t = now();
  fax.lastFailureReason = String(failureReason || 'unknown').slice(0, 200);
  const decision = decideAfterFailure({ attemptsMade: fax.attempts || 0, failureReason: fax.lastFailureReason }, retryPolicy);
  if (decision.action === 'retry') {
    fax.status = 'retry_scheduled';
    fax.nextAttemptAt = new Date(t + decision.delaySeconds * 1000).toISOString();
    addHistory(fax, 'retry_scheduled', t, { reason: fax.lastFailureReason, inSeconds: decision.delaySeconds });
    await saveFax(storage, fax, t);
    return decision;
  }
  fax.status = 'failed';
  fax.nextAttemptAt = null;
  addHistory(fax, 'failed_final', t, { reason: fax.lastFailureReason, why: decision.why });
  if (!fax.failureNotifiedAt) {
    const mail = faxFailedEmail({ fax, siteUrl: siteUrl(env) });
    await mailer.send({ to: fax.email, ...mail });
    fax.failureNotifiedAt = new Date(t).toISOString();
  }
  await saveFax(storage, fax, t);
  return decision;
}

export async function handleDelivered(fax, deps) {
  const { storage, mailer, env, now = () => Date.now() } = deps;
  const t = now();
  fax.status = 'delivered';
  fax.deliveredAt = new Date(t).toISOString();
  fax.nextAttemptAt = null;
  addHistory(fax, 'delivered', t);
  if (!fax.deliveryNotifiedAt) {
    const mail = faxDeliveredEmail({ fax, siteUrl: siteUrl(env) });
    await mailer.send({ to: fax.email, ...mail });
    fax.deliveryNotifiedAt = new Date(t).toISOString();
  }
  await saveFax(storage, fax, t);
  return fax;
}

/** Called by the scheduled function: send every fax whose retry time has come. */
export async function runDueRetries(deps) {
  const { storage, now = () => Date.now() } = deps;
  const t = now();
  const keys = await storage.list('fax/');
  const sent = [];
  for (const key of keys) {
    const fax = await storage.getJSON(key);
    if (fax && fax.status === 'retry_scheduled' && fax.nextAttemptAt && Date.parse(fax.nextAttemptAt) <= t) {
      await attemptSend(fax, deps);
      sent.push(fax.id);
    }
  }
  return sent;
}

/** What the customer's status page may see (no e-mail, no internals). */
export function publicFaxView(fax) {
  return {
    id: fax.id,
    status: fax.status,
    to: fax.to,
    pages: fax.pages,
    amountCents: fax.amountCents,
    attempts: fax.attempts || 0,
    createdAt: fax.createdAt,
    deliveredAt: fax.deliveredAt || null,
    lastFailureReason: fax.status === 'failed' ? fax.lastFailureReason : null,
    nextAttemptAt: fax.nextAttemptAt || null,
  };
}
