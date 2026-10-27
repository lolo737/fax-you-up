import { errorResponse, isEmail, json, methodNotAllowed, readJson } from '../http.js';
import {
  addHistory,
  attemptSend,
  getCustomer,
  getCustomerByStripeId,
  getFax,
  hasActiveSubscription,
  recordPayment,
  saveCustomer,
  saveFax,
  siteUrl,
  subscriptionPagesLeft,
} from '../faxes.js';
import { safeEqual } from '../crypto.js';
import { getCustomerEmail } from '../session.js';

/**
 * Only card is offered. Apple Pay and Google Pay ride on the card method in
 * Stripe Checkout (enable them in the Dashboard, verify the domain). Listing
 * 'card' explicitly keeps out slow-settling methods such as SEPA Direct Debit
 * and Klarna, so every payment is confirmed before a fax is sent.
 */
export const PAYMENT_METHOD_TYPES = ['card'];

/** Mark a fax paid (once), bump the customer's counters, and start sending. */
async function payAndSend(fax, { paymentId, amountCents, viaSubscription = false }, deps) {
  const { storage, now = () => Date.now() } = deps;
  if (fax.status !== 'quoted') return { alreadyHandled: true };
  const t = now();
  fax.status = 'paid';
  fax.paidAt = new Date(t).toISOString();
  fax.paymentId = paymentId || null;
  addHistory(fax, viaSubscription ? 'covered_by_subscription' : 'paid', t, { amountCents });
  await saveFax(storage, fax, t);

  const customer = await getCustomer(storage, fax.email);
  if (viaSubscription) {
    customer.subscription.pagesUsed = (customer.subscription.pagesUsed || 0) + fax.pages;
  } else {
    customer.paidFaxCount = (customer.paidFaxCount || 0) + 1;
    await recordPayment(storage, { id: paymentId, amountCents, currency: fax.quote.currency, kind: 'fax', email: fax.email, faxId: fax.id }, t);
  }
  if (!customer.faxIds.includes(fax.id)) customer.faxIds.push(fax.id);
  await saveCustomer(storage, customer);

  await attemptSend(fax, deps);
  return { alreadyHandled: false };
}

/**
 * POST { faxId, viewToken } — creates a Stripe Checkout session for the quoted
 * amount, or (for a signed-in subscriber with pages left) sends straight away.
 */
export const createCheckoutHandler = (deps) => async (req) => {
  if (req.method !== 'POST') return methodNotAllowed('POST');
  const { storage, stripe, env, pricing, now = () => Date.now() } = deps;
  const body = await readJson(req);
  const fax = await getFax(storage, body.faxId);
  if (!fax || !safeEqual(fax.viewToken, body.viewToken || '')) return errorResponse(404, 'No such fax.', 'not_found');
  if (fax.status !== 'quoted') return errorResponse(409, 'This fax has already been paid for.', 'already_paid');
  const base = siteUrl(env);
  const statusUrl = `${base}/send.html?fax=${fax.id}&t=${fax.viewToken}`;

  if (fax.subscriptionCovered) {
    const customer = await getCustomer(storage, fax.email);
    const sessionEmail = getCustomerEmail(req, env, now());
    if (sessionEmail === fax.email && subscriptionPagesLeft(customer, pricing) >= fax.pages) {
      await payAndSend(fax, { paymentId: null, amountCents: 0, viaSubscription: true }, deps);
      return json({ sent: true, statusUrl });
    }
    // Subscription lapsed between quote and send: fall back to paying.
    fax.subscriptionCovered = false;
    fax.amountCents = fax.quote.totalCents;
    await saveFax(storage, fax, now());
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: PAYMENT_METHOD_TYPES,
    customer_email: fax.email,
    client_reference_id: fax.id,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: fax.quote.currency,
          unit_amount: fax.amountCents,
          product_data: {
            name: `Fax to ${fax.to}`,
            description: `${fax.pages} page(s)${fax.quote.promoApplied ? ' — first-fax promo' : ''}`,
          },
        },
      },
    ],
    metadata: { kind: 'fax', faxId: fax.id },
    payment_intent_data: { metadata: { kind: 'fax', faxId: fax.id } },
    success_url: `${statusUrl}&paid=1`,
    cancel_url: `${statusUrl}&cancelled=1`,
  });
  fax.checkoutSessionId = session.id;
  await saveFax(storage, fax, now());
  return json({ url: session.url });
};

/** POST { email? } — Stripe Checkout for the monthly subscription. */
export const createSubscribeHandler = (deps) => async (req) => {
  if (req.method !== 'POST') return methodNotAllowed('POST');
  const { storage, stripe, env, pricing, now = () => Date.now() } = deps;
  if (!pricing.subscription.enabled) return errorResponse(404, 'Subscriptions are not available.', 'disabled');
  const body = await readJson(req);
  const email = (getCustomerEmail(req, env, now()) || String(body.email || '')).trim().toLowerCase();
  if (!isEmail(email)) return errorResponse(400, 'Please enter a valid e-mail address.', 'bad_email');
  const customer = await getCustomer(storage, email);
  if (hasActiveSubscription(customer)) return errorResponse(409, 'You already have an active subscription.', 'already_subscribed');
  const base = siteUrl(env);
  const params = {
    mode: 'subscription',
    payment_method_types: PAYMENT_METHOD_TYPES,
    client_reference_id: email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: pricing.currency,
          unit_amount: pricing.subscription.monthlyPriceCents,
          recurring: { interval: 'month' },
          product_data: { name: pricing.subscription.productName },
        },
      },
    ],
    metadata: { kind: 'subscription', email },
    subscription_data: { metadata: { kind: 'subscription', email } },
    success_url: `${base}/account.html?subscribed=1`,
    cancel_url: `${base}/pricing.html`,
  };
  if (customer.stripeCustomerId) params.customer = customer.stripeCustomerId;
  else params.customer_email = email;
  const session = await stripe.checkout.sessions.create(params);
  return json({ url: session.url });
};

/**
 * POST — Stripe webhook. The signature is checked against the raw body before
 * anything else happens; an unsigned or tampered request gets a 400 and is ignored.
 */
export const createStripeWebhookHandler = (deps) => async (req) => {
  if (req.method !== 'POST') return methodNotAllowed('POST');
  const { stripe, env, storage, now = () => Date.now() } = deps;
  const signature = req.headers.get('stripe-signature');
  const rawBody = await req.text();
  if (!signature || !env.STRIPE_WEBHOOK_SECRET) return errorResponse(400, 'Missing signature.', 'bad_signature');
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return errorResponse(400, 'Invalid signature.', 'bad_signature');
  }

  const obj = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      if (obj.mode === 'payment' && obj.metadata?.kind === 'fax') {
        if (obj.payment_status !== 'paid') break; // never send before the money is confirmed
        const fax = await getFax(storage, obj.metadata.faxId);
        if (!fax) break;
        if (obj.amount_total !== fax.amountCents) {
          addHistory(fax, 'amount_mismatch', now(), { expected: fax.amountCents, got: obj.amount_total });
          await saveFax(storage, fax, now());
          break;
        }
        await payAndSend(fax, { paymentId: obj.payment_intent || obj.id, amountCents: obj.amount_total }, deps);
      } else if (obj.mode === 'subscription') {
        const email = String(obj.metadata?.email || obj.customer_details?.email || '').toLowerCase();
        if (!email) break;
        const customer = await getCustomer(storage, email);
        customer.stripeCustomerId = obj.customer;
        customer.subscription = {
          id: obj.subscription,
          status: 'active',
          pagesUsed: 0,
          startedAt: new Date(now()).toISOString(),
        };
        await saveCustomer(storage, customer);
      }
      break;
    }
    case 'invoice.paid': {
      // Money in for every subscription period (including the first).
      if (!obj.customer) break;
      const customer = await getCustomerByStripeId(storage, obj.customer);
      await recordPayment(storage, {
        id: obj.id,
        amountCents: obj.amount_paid,
        currency: obj.currency,
        kind: 'subscription',
        email: customer?.email || null,
      }, now());
      if (customer?.subscription && obj.billing_reason === 'subscription_cycle') {
        customer.subscription.pagesUsed = 0;
        await saveCustomer(storage, customer);
      }
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const customer = await getCustomerByStripeId(storage, obj.customer);
      if (customer?.subscription && customer.subscription.id === obj.id) {
        customer.subscription.status = event.type === 'customer.subscription.deleted' ? 'canceled' : obj.status;
        await saveCustomer(storage, customer);
      }
      break;
    }
    default:
      break;
  }
  return json({ received: true });
};
