import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateQuote } from '../lib/pricing.js';
import { createQuoteHandler } from '../lib/handlers/public.js';
import { createStripeWebhookHandler } from '../lib/handlers/payments.js';
import pricing from '../config/pricing.js';
import { makeDeps, makePdf, quoteRequest, signedStripeRequest, checkoutCompletedEvent } from './helpers.js';

test('first fax gets the promo base price; extra pages still cost extra', () => {
  assert.equal(calculateQuote(2, { isFirstFax: true }).totalCents, 100);
  const q = calculateQuote(4, { isFirstFax: true });
  assert.equal(q.promoApplied, true);
  assert.equal(q.totalCents, 100 + 50);
});

test('promo can be switched off in config', () => {
  const cfg = structuredClone(pricing);
  cfg.promo.firstFaxEnabled = false;
  const q = calculateQuote(2, { isFirstFax: true }, cfg);
  assert.equal(q.promoApplied, false);
  assert.equal(q.totalCents, 150);
});

test('promo applies to a new e-mail address and stops once a fax has been paid', async () => {
  const deps = makeDeps();
  const quote = createQuoteHandler(deps);
  const pdf = await makePdf(2);

  const first = await (await quote(await quoteRequest({ pdf }))).json();
  assert.equal(first.quote.promoApplied, true);
  assert.equal(first.quote.totalCents, 100);

  // Pay for it (signed webhook) — that makes the customer a returning one.
  const fax = await deps.storage.getJSON(`fax/${first.faxId}`);
  const res = await createStripeWebhookHandler(deps)(signedStripeRequest(checkoutCompletedEvent(fax)));
  assert.equal(res.status, 200);

  const second = await (await quote(await quoteRequest({ pdf }))).json();
  assert.equal(second.quote.promoApplied, false);
  assert.equal(second.quote.totalCents, 150);

  // E-mail matching is case-insensitive, so shouting does not earn a second promo.
  const third = await (await quote(await quoteRequest({ pdf, email: 'CUSTOMER@Example.com' }))).json();
  assert.equal(third.quote.promoApplied, false);
});

test('an unpaid quote does not use up the promo', async () => {
  const deps = makeDeps();
  const quote = createQuoteHandler(deps);
  const pdf = await makePdf(1);
  await quote(await quoteRequest({ pdf, email: 'new@example.com' }));
  const again = await (await quote(await quoteRequest({ pdf, email: 'new@example.com' }))).json();
  assert.equal(again.quote.promoApplied, true);
});
