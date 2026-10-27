import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { createCancelSubscriptionHandler, createDownloadHandler, createAccountHandler, createLoginLinkHandler, createVerifyLoginHandler } from '../lib/handlers/account.js';
import { createStripeWebhookHandler, createSubscribeHandler } from '../lib/handlers/payments.js';
import { createQuoteHandler } from '../lib/handlers/public.js';
import { customerSessionCookie } from '../lib/session.js';
import { getCustomer, saveCustomer } from '../lib/faxes.js';
import { makeDeps, makePdf, quoteRequest, signedStripeRequest, checkoutCompletedEvent } from './helpers.js';

const EMAIL = 'subscriber@example.com';
const cookieFor = (deps, email = EMAIL) => customerSessionCookie(deps.env, email, deps.now()).split(';')[0];

async function subscribed(deps) {
  const event = {
    id: 'evt_sub',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: { mode: 'subscription', customer: 'cus_123', subscription: 'sub_123', metadata: { kind: 'subscription', email: EMAIL } } },
  };
  const res = await createStripeWebhookHandler(deps)(signedStripeRequest(event));
  assert.equal(res.status, 200);
}

test('subscribe creates a card-only monthly Checkout session at the configured price', async () => {
  const deps = makeDeps();
  const res = await createSubscribeHandler(deps)(new Request('https://x', { method: 'POST', body: JSON.stringify({ email: EMAIL }) }));
  assert.equal(res.status, 200);
  const p = deps.stripe.calls.sessions[0];
  assert.equal(p.mode, 'subscription');
  assert.deepEqual(p.payment_method_types, ['card']);
  assert.equal(p.line_items[0].price_data.unit_amount, 2499);
  assert.equal(p.line_items[0].price_data.recurring.interval, 'month');
});

test('cancel: one press cancels immediately in Stripe, e-mails, and offers the ZIP', async () => {
  const deps = makeDeps();
  await subscribed(deps);
  const cancel = createCancelSubscriptionHandler(deps);
  const req = () => new Request('https://x/api/subscription-cancel', { method: 'POST', headers: { cookie: cookieFor(deps) } });

  const res = await cancel(req());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { cancelled: true, alreadyCancelled: false, zipUrl: '/api/account-download' });
  assert.deepEqual(deps.stripe.calls.cancels, [{ id: 'sub_123', opts: { prorate: false } }]);
  assert.equal((await getCustomer(deps.storage, EMAIL)).subscription.status, 'canceled');
  assert.match(deps.mailer.sent.at(-1).subject, /cancelled/);

  // Pressing it again is harmless and does not call Stripe twice.
  const again = await (await cancel(req())).json();
  assert.equal(again.alreadyCancelled, true);
  assert.equal(deps.stripe.calls.cancels.length, 1);
});

test('cancel requires a signed-in customer', async () => {
  const deps = makeDeps();
  await subscribed(deps);
  const res = await createCancelSubscriptionHandler(deps)(new Request('https://x', { method: 'POST' }));
  assert.equal(res.status, 401);
  const forged = await createCancelSubscriptionHandler(deps)(
    new Request('https://x', { method: 'POST', headers: { cookie: 'fyu_session=eyJlIjoic3Vic2NyaWJlckBleGFtcGxlLmNvbSJ9.fake' } }),
  );
  assert.equal(forged.status, 401);
  assert.equal(deps.stripe.calls.cancels.length, 0);
});

test('Stripe-side cancellation (customer.subscription.deleted) is mirrored', async () => {
  const deps = makeDeps();
  await subscribed(deps);
  await createStripeWebhookHandler(deps)(
    signedStripeRequest({ id: 'evt_del', object: 'event', type: 'customer.subscription.deleted', data: { object: { id: 'sub_123', customer: 'cus_123', status: 'canceled' } } }),
  );
  assert.equal((await getCustomer(deps.storage, EMAIL)).subscription.status, 'canceled');
});

test('download gives a ZIP with every sent PDF and a receipts.csv', async () => {
  const deps = makeDeps();
  const quote = createQuoteHandler(deps);
  const webhook = createStripeWebhookHandler(deps);
  for (const pages of [1, 4]) {
    const q = await (await quote(await quoteRequest({ pdf: await makePdf(pages), email: EMAIL }))).json();
    const fax = await deps.storage.getJSON(`fax/${q.faxId}`);
    const ev = checkoutCompletedEvent(fax);
    ev.data.object.payment_intent = `pi_${pages}`;
    await webhook(signedStripeRequest(ev));
  }
  const res = await createDownloadHandler(deps)(new Request('https://x/api/account-download', { headers: { cookie: cookieFor(deps) } }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const pdfs = Object.keys(files).filter((n) => n.endsWith('.pdf'));
  assert.equal(pdfs.length, 2);
  for (const n of pdfs) assert.equal(strFromU8(files[n].subarray(0, 5)), '%PDF-');
  const csv = strFromU8(files['receipts.csv']);
  assert.equal(csv.split('\r\n').length, 3);
});

test('subscriber with pages left can send without paying again', async () => {
  const deps = makeDeps();
  await subscribed(deps);
  const { createCheckoutHandler } = await import('../lib/handlers/payments.js');
  const cookie = cookieFor(deps);
  const q = await (await createQuoteHandler(deps)(await quoteRequest({ pdf: await makePdf(2), email: EMAIL, cookie }))).json();
  assert.equal(q.subscriptionCovered, true);
  const res = await createCheckoutHandler(deps)(
    new Request('https://x/api/checkout', { method: 'POST', headers: { cookie }, body: JSON.stringify({ faxId: q.faxId, viewToken: q.viewToken }) }),
  );
  assert.equal((await res.json()).sent, true);
  assert.equal(deps.stripe.calls.sessions.length, 0);
  assert.equal(deps.telnyx.sent.length, 1);
  assert.equal((await getCustomer(deps.storage, EMAIL)).subscription.pagesUsed, 2);
});

test('magic-link sign-in round trip', async () => {
  const deps = makeDeps();
  await createLoginLinkHandler(deps)(new Request('https://x', { method: 'POST', body: JSON.stringify({ email: EMAIL }) }));
  const link = deps.mailer.sent[0].text.match(/https:\/\/\S+account-verify\S+/)[0];
  const res = await createVerifyLoginHandler(deps)(new Request(link));
  assert.equal(res.status, 303);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const acct = await createAccountHandler(deps)(new Request('https://x/api/account', { headers: { cookie } }));
  assert.equal((await acct.json()).email, EMAIL);
  // The login token itself is not a session.
  const misuse = await createAccountHandler(deps)(new Request('https://x', { headers: { cookie: `fyu_session=${new URL(link).searchParams.get('t')}` } }));
  assert.equal(misuse.status, 401);
});

test('no subscription → cancel says so', async () => {
  const deps = makeDeps();
  await saveCustomer(deps.storage, await getCustomer(deps.storage, EMAIL));
  const res = await createCancelSubscriptionHandler(deps)(new Request('https://x', { method: 'POST', headers: { cookie: cookieFor(deps) } }));
  assert.equal(res.status, 404);
});
