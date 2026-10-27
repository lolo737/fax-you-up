import { zipSync } from 'fflate';
import { errorResponse, isEmail, json, methodNotAllowed, readJson, redirect } from '../http.js';
import { fileKey, getCustomer, getFax, hasActiveSubscription, publicFaxView, saveCustomer, siteUrl, subscriptionPagesLeft } from '../faxes.js';
import { signToken, verifyToken } from '../crypto.js';
import { clearCookie, customerSessionCookie, CUSTOMER_COOKIE, getCustomerEmail } from '../session.js';
import { loginLinkEmail, subscriptionCancelledEmail } from '../email/templates.js';

const unauthorised = () => errorResponse(401, 'Please sign in first.', 'unauthorised');

/** POST { email } — e-mails a one-time sign-in link. Same answer whether or not we know the address. */
export const createLoginLinkHandler = (deps) => async (req) => {
  if (req.method !== 'POST') return methodNotAllowed('POST');
  const { env, mailer, now = () => Date.now() } = deps;
  const { email } = await readJson(req);
  if (!isEmail(email)) return errorResponse(400, 'Please enter a valid e-mail address.', 'bad_email');
  const clean = email.trim().toLowerCase();
  const token = signToken({ e: clean, k: 'login', exp: now() + 20 * 60 * 1000 }, env.SESSION_SECRET);
  const link = `${siteUrl(env)}/api/account-verify?t=${encodeURIComponent(token)}`;
  await mailer.send({ to: clean, ...loginLinkEmail({ link }) });
  return json({ sent: true });
};

/** GET ?t=<login token> — sets the session cookie and lands on the account page. */
export const createVerifyLoginHandler = (deps) => async (req) => {
  const { env, now = () => Date.now() } = deps;
  const payload = verifyToken(new URL(req.url).searchParams.get('t'), env.SESSION_SECRET, now());
  if (!payload || payload.k !== 'login') return redirect(`${siteUrl(env)}/account.html?login=expired`);
  return redirect(`${siteUrl(env)}/account.html`, { 'Set-Cookie': customerSessionCookie(env, payload.e, now()) });
};

export const createLogoutHandler = (deps) => async (req) => {
  if (req.method !== 'POST') return methodNotAllowed('POST');
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(CUSTOMER_COOKIE, deps.env) });
};

/** GET — the signed-in customer's subscription and faxes. */
export const createAccountHandler = (deps) => async (req) => {
  if (req.method !== 'GET') return methodNotAllowed('GET');
  const { env, storage, pricing, now = () => Date.now() } = deps;
  const email = getCustomerEmail(req, env, now());
  if (!email) return unauthorised();
  const customer = await getCustomer(storage, email);
  const faxes = [];
  for (const id of customer.faxIds.slice(-100).reverse()) {
    const fax = await getFax(storage, id);
    if (fax) faxes.push(publicFaxView(fax));
  }
  faxes.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return json({
    email,
    subscription: customer.subscription
      ? {
          status: customer.subscription.status,
          startedAt: customer.subscription.startedAt,
          cancelledAt: customer.subscription.cancelledAt || null,
          pagesUsed: customer.subscription.pagesUsed || 0,
          pagesLeft: subscriptionPagesLeft(customer, pricing),
        }
      : null,
    faxes,
  });
};

/**
 * POST — the big honest button. Cancels the Stripe subscription immediately
 * (no "are you sure you want to lose your benefits?" labyrinth, no retention
 * offers, no phone call). Idempotent: a second press just says it's done.
 */
export const createCancelSubscriptionHandler = (deps) => async (req) => {
  if (req.method !== 'POST') return methodNotAllowed('POST');
  const { env, storage, stripe, mailer, now = () => Date.now() } = deps;
  const email = getCustomerEmail(req, env, now());
  if (!email) return unauthorised();
  const customer = await getCustomer(storage, email);
  if (!customer.subscription) return errorResponse(404, 'You do not have a subscription.', 'no_subscription');
  if (!hasActiveSubscription(customer)) {
    return json({ cancelled: true, alreadyCancelled: true, zipUrl: '/api/account-download' });
  }
  await stripe.subscriptions.cancel(customer.subscription.id, { prorate: false });
  customer.subscription.status = 'canceled';
  customer.subscription.cancelledAt = new Date(now()).toISOString();
  await saveCustomer(storage, customer);
  await mailer.send({ to: email, ...subscriptionCancelledEmail({ siteUrl: siteUrl(env) }) });
  return json({ cancelled: true, alreadyCancelled: false, zipUrl: '/api/account-download' });
};

/** GET — every PDF the customer has sent, plus a receipts.csv, as one ZIP. */
export const createDownloadHandler = (deps) => async (req) => {
  if (req.method !== 'GET') return methodNotAllowed('GET');
  const { env, storage, now = () => Date.now() } = deps;
  const email = getCustomerEmail(req, env, now());
  if (!email) return unauthorised();
  const customer = await getCustomer(storage, email);
  const files = {};
  const rows = [['fax_id', 'created_at', 'to', 'pages', 'amount_eur', 'status', 'file']];
  for (const id of customer.faxIds) {
    const fax = await getFax(storage, id);
    if (!fax) continue;
    const bytes = await storage.getBytes(fileKey(id));
    const name = `${id}-${fax.fileName.replace(/[^\w.-]+/g, '_')}`;
    if (bytes) files[`faxes/${name}`] = bytes;
    rows.push([id, fax.createdAt, fax.to, fax.pages, ((fax.amountCents || 0) / 100).toFixed(2), fax.status, bytes ? `faxes/${name}` : '']);
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  files['receipts.csv'] = new TextEncoder().encode(csv);
  const zip = zipSync(files, { level: 6 });
  return new Response(zip, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="fax-you-up-my-files.zip"',
      'Cache-Control': 'no-store',
    },
  });
};
