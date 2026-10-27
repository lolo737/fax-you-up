import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStripeWebhookHandler } from '../lib/handlers/payments.js';
import { createTelnyxWebhookHandler } from '../lib/handlers/telnyx-webhook.js';
import { verifyTelnyxSignature } from '../lib/crypto.js';
import { makeDeps, signedStripeRequest, signedTelnyxRequest, telnyxEvent, telnyxKeys } from './helpers.js';

const event = { id: 'evt_1', object: 'event', type: 'checkout.session.completed', data: { object: { mode: 'payment', payment_status: 'paid', metadata: {} } } };

test('Stripe webhook: missing signature is rejected', async () => {
  const deps = makeDeps();
  const res = await createStripeWebhookHandler(deps)(
    new Request('https://x/api/stripe-webhook', { method: 'POST', body: JSON.stringify(event) }),
  );
  assert.equal(res.status, 400);
});

test('Stripe webhook: signature made with the wrong secret is rejected', async () => {
  const deps = makeDeps();
  const res = await createStripeWebhookHandler(deps)(signedStripeRequest(event, { secret: 'whsec_wrong' }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'bad_signature');
});

test('Stripe webhook: tampered body is rejected', async () => {
  const deps = makeDeps();
  const res = await createStripeWebhookHandler(deps)(signedStripeRequest(event, { tamper: true }));
  assert.equal(res.status, 400);
});

test('Stripe webhook: correctly signed event is accepted', async () => {
  const deps = makeDeps();
  const res = await createStripeWebhookHandler(deps)(signedStripeRequest(event));
  assert.equal(res.status, 200);
});

test('Stripe webhook: GET is not allowed', async () => {
  const res = await createStripeWebhookHandler(makeDeps())(new Request('https://x/api/stripe-webhook'));
  assert.equal(res.status, 405);
});

test('Telnyx webhook: valid Ed25519 signature passes, bad ones fail', async () => {
  const { publicKeyB64, privateKey } = telnyxKeys();
  const now = Date.parse('2026-10-27T10:00:00Z');
  const ts = Math.floor(now / 1000);
  const deps = makeDeps();
  deps.env.TELNYX_PUBLIC_KEY = publicKeyB64;
  const handler = createTelnyxWebhookHandler(deps);

  const ok = await handler(signedTelnyxRequest(telnyxEvent('fax.queued', 'unknown'), { privateKey, timestamp: ts }));
  assert.equal(ok.status, 200);

  const other = telnyxKeys();
  const forged = await handler(signedTelnyxRequest(telnyxEvent('fax.delivered', 'x'), { privateKey: other.privateKey, timestamp: ts }));
  assert.equal(forged.status, 400);

  const stale = await handler(signedTelnyxRequest(telnyxEvent('fax.delivered', 'x'), { privateKey, timestamp: ts - 3600 }));
  assert.equal(stale.status, 400, 'replayed (old) webhooks are refused');

  const unsigned = await handler(new Request('https://x/api/telnyx-webhook', { method: 'POST', body: '{}' }));
  assert.equal(unsigned.status, 400);
});

test('Telnyx signature skip is ignored in production', async () => {
  const deps = makeDeps();
  deps.env.TELNYX_SKIP_SIGNATURE_VERIFICATION = 'true';
  deps.env.CONTEXT = 'production';
  const res = await createTelnyxWebhookHandler(deps)(new Request('https://x', { method: 'POST', body: '{}' }));
  assert.equal(res.status, 400);
});

test('verifyTelnyxSignature: garbage key returns false rather than throwing', () => {
  assert.equal(verifyTelnyxSignature({ rawBody: '{}', signature: 'AAAA', timestamp: String(Math.floor(Date.now() / 1000)), publicKey: 'nope' }), false);
});
