import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffSeconds, decideAfterFailure, isPermanentFailure } from '../lib/retry.js';
import retryPolicy from '../config/retry.js';
import { createQuoteHandler } from '../lib/handlers/public.js';
import { createStripeWebhookHandler } from '../lib/handlers/payments.js';
import { createTelnyxWebhookHandler } from '../lib/handlers/telnyx-webhook.js';
import { runDueRetries } from '../lib/faxes.js';
import { makeDeps, makePdf, quoteRequest, signedStripeRequest, checkoutCompletedEvent, telnyxEvent } from './helpers.js';

test('back-off grows exponentially and is capped', () => {
  assert.equal(backoffSeconds(2), 120);
  assert.equal(backoffSeconds(3), 480);
  assert.equal(backoffSeconds(4), 1920);
  assert.equal(backoffSeconds(5), retryPolicy.backoffMaxSeconds);
});

test('busy / no answer is retried; a bad number is not', () => {
  assert.equal(isPermanentFailure('user_busy'), false);
  assert.equal(isPermanentFailure('no_answer'), false);
  assert.equal(isPermanentFailure('invalid_number_format'), true);
  assert.equal(isPermanentFailure('not_a_fax_machine'), true);
  assert.equal(decideAfterFailure({ attemptsMade: 1, failureReason: 'user_busy' }).action, 'retry');
  const perm = decideAfterFailure({ attemptsMade: 1, failureReason: 'invalid_number' });
  assert.deepEqual(perm, { action: 'give_up', notifyCustomer: true, why: 'permanent_failure' });
  const spent = decideAfterFailure({ attemptsMade: retryPolicy.maxAttempts, failureReason: 'user_busy' });
  assert.equal(spent.why, 'attempts_exhausted');
});

async function paidFax(deps) {
  deps.env.TELNYX_SKIP_SIGNATURE_VERIFICATION = 'true'; // signature itself is tested in webhooks.test.js
  const q = await (await createQuoteHandler(deps)(await quoteRequest({ pdf: await makePdf(2) }))).json();
  const fax = await deps.storage.getJSON(`fax/${q.faxId}`);
  await createStripeWebhookHandler(deps)(signedStripeRequest(checkoutCompletedEvent(fax)));
  return q.faxId;
}

const telnyxPost = (body) => new Request('https://x/api/telnyx-webhook', { method: 'POST', body: JSON.stringify(body) });

test('transient failures are retried with back-off and the customer hears nothing until it is final', async () => {
  const deps = makeDeps();
  const id = await paidFax(deps);
  const tx = createTelnyxWebhookHandler(deps);

  for (let attempt = 1; attempt < retryPolicy.maxAttempts; attempt++) {
    await tx(telnyxPost(telnyxEvent('fax.failed', `tx_${attempt}`, { failure_reason: 'user_busy' })));
    const fax = await deps.storage.getJSON(`fax/${id}`);
    assert.equal(fax.status, 'retry_scheduled');
    assert.equal(deps.mailer.sent.length, 0, 'no e-mail while we are still trying');

    // Not due yet: nothing happens.
    assert.deepEqual(await runDueRetries(deps), []);
    deps.advance(backoffSeconds(attempt + 1));
    assert.deepEqual(await runDueRetries(deps), [id]);
    assert.equal(deps.telnyx.sent.length, attempt + 1);
  }

  // Last attempt fails too → final, exactly one failure e-mail.
  await tx(telnyxPost(telnyxEvent('fax.failed', `tx_${retryPolicy.maxAttempts}`, { failure_reason: 'user_busy' })));
  const fax = await deps.storage.getJSON(`fax/${id}`);
  assert.equal(fax.status, 'failed');
  assert.equal(deps.mailer.sent.length, 1);
  assert.match(deps.mailer.sent[0].subject, /^Not delivered/);
  assert.equal(deps.mailer.sent[0].to, 'customer@example.com');

  // Late duplicate webhooks do not e-mail again.
  await tx(telnyxPost(telnyxEvent('fax.failed', `tx_${retryPolicy.maxAttempts}`, { failure_reason: 'user_busy' })));
  assert.equal(deps.mailer.sent.length, 1);
});

test('a permanent failure (bad number) is final at once, with one e-mail', async () => {
  const deps = makeDeps();
  const id = await paidFax(deps);
  await createTelnyxWebhookHandler(deps)(telnyxPost(telnyxEvent('fax.failed', 'tx_1', { failure_reason: 'invalid_number' })));
  const fax = await deps.storage.getJSON(`fax/${id}`);
  assert.equal(fax.status, 'failed');
  assert.equal(fax.attempts, 1);
  assert.equal(deps.mailer.sent.length, 1);
});

test('fail then deliver: success e-mail only, no failure e-mail', async () => {
  const deps = makeDeps();
  const id = await paidFax(deps);
  const tx = createTelnyxWebhookHandler(deps);
  await tx(telnyxPost(telnyxEvent('fax.failed', 'tx_1', { failure_reason: 'no_answer' })));
  deps.advance(backoffSeconds(2));
  await runDueRetries(deps);
  // A late event for the old attempt is ignored.
  const stale = await (await tx(telnyxPost(telnyxEvent('fax.failed', 'tx_1', { failure_reason: 'no_answer' })))).json();
  assert.equal(stale.ignored, 'stale_attempt');
  await tx(telnyxPost(telnyxEvent('fax.delivered', 'tx_2')));
  const fax = await deps.storage.getJSON(`fax/${id}`);
  assert.equal(fax.status, 'delivered');
  assert.equal(deps.mailer.sent.length, 1);
  assert.match(deps.mailer.sent[0].subject, /^Delivered/);
});

test('a Telnyx API error at send time goes through the same retry policy', async () => {
  const deps = makeDeps();
  deps.telnyx.failWith = 'Telnyx error 503: Service Unavailable';
  const id = await paidFax(deps);
  let fax = await deps.storage.getJSON(`fax/${id}`);
  assert.equal(fax.status, 'retry_scheduled');
  assert.equal(deps.mailer.sent.length, 0);
  deps.telnyx.failWith = null;
  deps.advance(backoffSeconds(2));
  await runDueRetries(deps);
  fax = await deps.storage.getJSON(`fax/${id}`);
  assert.equal(fax.status, 'sending');
  assert.equal(fax.attempts, 2);
});
