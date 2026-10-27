import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQuoteHandler, createMediaHandler, createFaxStatusHandler } from '../lib/handlers/public.js';
import { createCheckoutHandler, createStripeWebhookHandler, PAYMENT_METHOD_TYPES } from '../lib/handlers/payments.js';
import { makeDeps, makePdf, quoteRequest, signedStripeRequest, checkoutCompletedEvent } from './helpers.js';

async function quoted(deps, pages = 2) {
  const res = await createQuoteHandler(deps)(await quoteRequest({ pdf: await makePdf(pages) }));
  assert.equal(res.status, 200);
  return res.json();
}

test('quote → checkout: Stripe is asked for exactly the quoted amount, card-only', async () => {
  const deps = makeDeps();
  const q = await quoted(deps, 5);
  const res = await createCheckoutHandler(deps)(
    new Request('https://x/api/checkout', { method: 'POST', body: JSON.stringify({ faxId: q.faxId, viewToken: q.viewToken }) }),
  );
  assert.equal(res.status, 200);
  assert.match((await res.json()).url, /^https:\/\/checkout\.stripe\.com\//);
  const params = deps.stripe.calls.sessions[0];
  assert.equal(params.mode, 'payment');
  assert.deepEqual(params.payment_method_types, ['card']);
  assert.deepEqual(PAYMENT_METHOD_TYPES, ['card'], 'no SEPA Direct Debit, no Klarna');
  assert.equal(params.line_items[0].price_data.unit_amount, q.quote.totalCents);
  assert.equal(params.metadata.faxId, q.faxId);
  assert.equal(deps.telnyx.sent.length, 0, 'nothing is faxed before payment');
});

test('checkout refuses a wrong view token', async () => {
  const deps = makeDeps();
  const q = await quoted(deps);
  const res = await createCheckoutHandler(deps)(
    new Request('https://x/api/checkout', { method: 'POST', body: JSON.stringify({ faxId: q.faxId, viewToken: 'nope' }) }),
  );
  assert.equal(res.status, 404);
});

test('paid checkout webhook sends the fax via Telnyx exactly once', async () => {
  const deps = makeDeps();
  const q = await quoted(deps);
  const fax = await deps.storage.getJSON(`fax/${q.faxId}`);
  const webhook = createStripeWebhookHandler(deps);

  const res = await webhook(signedStripeRequest(checkoutCompletedEvent(fax)));
  assert.equal(res.status, 200);
  assert.equal(deps.telnyx.sent.length, 1);
  const call = deps.telnyx.sent[0];
  assert.equal(call.to, '+35312345678');
  assert.equal(call.webhookUrl, 'https://faxyouup.example/api/telnyx-webhook');
  assert.match(call.mediaUrl, /^https:\/\/faxyouup\.example\/api\/media\?t=/);

  const after = await deps.storage.getJSON(`fax/${q.faxId}`);
  assert.equal(after.status, 'sending');
  assert.equal(after.attempts, 1);
  assert.equal(after.currentTelnyxFaxId, 'tx_1');
  assert.ok(await deps.storage.getJSON('payment/pi_test_1'), 'money in is recorded');

  // Stripe retries webhooks; a duplicate must not send a second fax.
  await webhook(signedStripeRequest(checkoutCompletedEvent(fax)));
  assert.equal(deps.telnyx.sent.length, 1);
});

test('the media URL handed to Telnyx serves the PDF, and only with a valid token', async () => {
  const deps = makeDeps();
  const q = await quoted(deps, 3);
  const fax = await deps.storage.getJSON(`fax/${q.faxId}`);
  await createStripeWebhookHandler(deps)(signedStripeRequest(checkoutCompletedEvent(fax)));
  const media = createMediaHandler(deps);
  const good = await media(new Request(deps.telnyx.sent[0].mediaUrl));
  assert.equal(good.status, 200);
  assert.equal(good.headers.get('content-type'), 'application/pdf');
  const bad = await media(new Request('https://faxyouup.example/api/media?t=forged.token'));
  assert.equal(bad.status, 403);
});

test('unpaid or wrong-amount sessions never trigger a fax', async () => {
  const deps = makeDeps();
  const q = await quoted(deps);
  const fax = await deps.storage.getJSON(`fax/${q.faxId}`);
  const webhook = createStripeWebhookHandler(deps);
  await webhook(signedStripeRequest(checkoutCompletedEvent(fax, { paymentStatus: 'unpaid' })));
  await webhook(signedStripeRequest(checkoutCompletedEvent(fax, { amount: 1 })));
  assert.equal(deps.telnyx.sent.length, 0);
  assert.equal((await deps.storage.getJSON(`fax/${q.faxId}`)).status, 'quoted');
});

test('fax status endpoint needs the view token and hides the e-mail', async () => {
  const deps = makeDeps();
  const q = await quoted(deps);
  const status = createFaxStatusHandler(deps);
  const ok = await status(new Request(`https://x/api/fax-status?id=${q.faxId}&t=${q.viewToken}`));
  const body = await ok.json();
  assert.equal(body.status, 'quoted');
  assert.equal(body.email, undefined);
  const nope = await status(new Request(`https://x/api/fax-status?id=${q.faxId}&t=wrong`));
  assert.equal(nope.status, 404);
});

test('quote rejects a non-PDF and a bad number with friendly errors', async () => {
  const deps = makeDeps();
  const quote = createQuoteHandler(deps);
  const notPdf = await quote(await quoteRequest({ pdf: new TextEncoder().encode('plain text') }));
  assert.equal(notPdf.status, 400);
  assert.equal((await notPdf.json()).error.code, 'not_pdf');
  const badNo = await quote(await quoteRequest({ pdf: await makePdf(1), to: '12345' }));
  assert.equal((await badNo.json()).error.code, 'bad_number');
});
