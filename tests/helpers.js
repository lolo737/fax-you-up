import crypto from 'node:crypto';
import Stripe from 'stripe';
import { PDFDocument } from 'pdf-lib';
import pricing from '../config/pricing.js';
import retryPolicy from '../config/retry.js';
import { createMemoryStorage } from '../lib/storage/memory.js';
import { createMemoryMailer } from '../lib/email/index.js';

export const STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';

/** Real Stripe signature verification, mocked network calls. */
export function mockStripe() {
  const real = new Stripe('sk_test_dummy_not_a_real_key');
  const calls = { sessions: [], cancels: [] };
  return {
    calls,
    webhooks: real.webhooks,
    checkout: {
      sessions: {
        async create(params) {
          calls.sessions.push(params);
          return { id: `cs_test_${calls.sessions.length}`, url: `https://checkout.stripe.com/c/pay/cs_test_${calls.sessions.length}` };
        },
      },
    },
    subscriptions: {
      async cancel(id, opts) {
        calls.cancels.push({ id, opts });
        return { id, status: 'canceled' };
      },
    },
  };
}

/** Telnyx mock: each sendFax returns a fresh id, or throws if told to. */
export function mockTelnyx({ failWith = null } = {}) {
  const sent = [];
  return {
    sent,
    failWith,
    async sendFax(args) {
      if (this.failWith) throw new Error(this.failWith);
      sent.push(args);
      return { id: `tx_${sent.length}`, status: 'queued' };
    },
  };
}

export function makeDeps(overrides = {}) {
  let clock = Date.parse('2026-10-27T10:00:00Z');
  const deps = {
    env: {
      SITE_URL: 'https://faxyouup.example',
      SESSION_SECRET: 'test-session-secret-0123456789abcdef',
      STRIPE_WEBHOOK_SECRET,
    },
    pricing,
    retryPolicy,
    storage: createMemoryStorage(),
    mailer: createMemoryMailer(),
    stripe: mockStripe(),
    telnyx: mockTelnyx(),
    now: () => clock,
    advance(seconds) {
      clock += seconds * 1000;
    },
    delayMs: 0,
    ...overrides,
  };
  return deps;
}

export async function makePdf(pages) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  return doc.save();
}

export function signedStripeRequest(event, { secret = STRIPE_WEBHOOK_SECRET, tamper = false } = {}) {
  const payload = JSON.stringify(event);
  const header = new Stripe('sk_test_dummy').webhooks.generateTestHeaderString({ payload, secret });
  return new Request('https://faxyouup.example/api/stripe-webhook', {
    method: 'POST',
    headers: { 'stripe-signature': header, 'content-type': 'application/json' },
    body: tamper ? payload.replace('"paid"', '"PAID"') : payload,
  });
}

export function telnyxKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  return { publicKeyB64: raw.toString('base64'), privateKey };
}

export function signedTelnyxRequest(body, { privateKey, timestamp }) {
  const raw = JSON.stringify(body);
  const sig = crypto.sign(null, Buffer.from(`${timestamp}|${raw}`), privateKey).toString('base64');
  return new Request('https://faxyouup.example/api/telnyx-webhook', {
    method: 'POST',
    headers: { 'telnyx-signature-ed25519': sig, 'telnyx-timestamp': String(timestamp), 'content-type': 'application/json' },
    body: raw,
  });
}

export function telnyxEvent(type, faxId, extra = {}) {
  return { data: { event_type: type, id: crypto.randomUUID(), payload: { fax_id: faxId, ...extra } } };
}

export async function quoteRequest({ pdf, to = '+353 1 234 5678', email = 'customer@example.com', cookie } = {}) {
  const form = new FormData();
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'letter.pdf');
  form.append('to', to);
  form.append('email', email);
  const headers = cookie ? { cookie } : {};
  return new Request('https://faxyouup.example/api/quote', { method: 'POST', body: form, headers });
}

export function checkoutCompletedEvent(fax, { paymentStatus = 'paid', amount = fax.amountCents } = {}) {
  return {
    id: 'evt_test_1',
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_1',
        object: 'checkout.session',
        mode: 'payment',
        payment_status: paymentStatus,
        amount_total: amount,
        payment_intent: 'pi_test_1',
        metadata: { kind: 'fax', faxId: fax.id },
      },
    },
  };
}
