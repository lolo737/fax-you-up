#!/usr/bin/env node
/**
 * Offline preview: serves public/ and runs the real API handlers against an
 * in-memory store with mocked Stripe and Telnyx. Handy for poking at the UI
 * (and for the README screenshots) without any accounts or keys.
 *   node scripts/preview-server.mjs   → http://localhost:8899
 * For the real thing, use `netlify dev`.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pricing from '../config/pricing.js';
import retryPolicy from '../config/retry.js';
import { createMemoryStorage } from '../lib/storage/memory.js';
import { createConsoleMailer } from '../lib/email/index.js';
import * as pub from '../lib/handlers/public.js';
import * as pay from '../lib/handlers/payments.js';
import * as acct from '../lib/handlers/account.js';
import * as admin from '../lib/handlers/admin.js';
import { createTelnyxWebhookHandler } from '../lib/handlers/telnyx-webhook.js';
import { hashPassword } from '../lib/crypto.js';
import { generateSecret, otpauthUrl, totp } from '../lib/totp.js';
import { saveCustomer, saveFax, recordPayment, fileKey } from '../lib/faxes.js';
import { PDFDocument } from 'pdf-lib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const port = Number(process.env.PORT || 8899);
const deps = {
  env: { SITE_URL: `http://localhost:${port}`, SESSION_SECRET: 'preview-only-secret', TELNYX_SKIP_SIGNATURE_VERIFICATION: 'true' },
  pricing,
  retryPolicy,
  storage: createMemoryStorage(),
  mailer: createConsoleMailer(),
  stripe: {
    checkout: { sessions: { create: async () => ({ id: 'cs_preview', url: `http://localhost:${port}/send.html?preview-checkout=1` }) } },
    subscriptions: { cancel: async (id) => ({ id, status: 'canceled' }) },
    webhooks: { constructEventAsync: async () => { throw new Error('no webhooks in preview'); } },
  },
  telnyx: { sendFax: async () => ({ id: `tx_${Date.now()}`, status: 'queued' }) },
  now: () => Date.now(),
  delayMs: 0,
};

/* Preview-only admin credentials, printed at start-up (never used in production). */
const ADMIN_PASSWORD = 'preview-admin-password';
const ADMIN_TOTP = generateSecret();
deps.env.ADMIN_PASSWORD_HASH = hashPassword(ADMIN_PASSWORD);
deps.env.ADMIN_TOTP_SECRET = ADMIN_TOTP;

/** Demo data: a subscriber (demo@example.com) with a few faxes in various states. */
async function seed() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const pdf = await doc.save();
  const now = Date.now();
  const iso = (minsAgo) => new Date(now - minsAgo * 60000).toISOString();
  const faxes = [
    { id: 'fax_demo_delivered', to: '+49301234567', pages: 2, status: 'delivered', attempts: 1, amountCents: 150, createdAt: iso(2900) },
    { id: 'fax_demo_retrying', to: '+35312345678', pages: 5, status: 'retry_scheduled', attempts: 2, amountCents: 250, createdAt: iso(30), nextAttemptAt: new Date(now + 8 * 60000).toISOString(), lastFailureReason: 'user_busy' },
    { id: 'fax_demo_failed', to: '+4940999999', pages: 1, status: 'failed', attempts: 1, amountCents: 100, createdAt: iso(5000), lastFailureReason: 'not_a_fax_machine' },
    { id: 'fax_demo_sub', to: '+442071234567', pages: 3, status: 'delivered', attempts: 1, amountCents: 0, createdAt: iso(600) },
  ];
  for (const f of faxes) {
    await saveFax(deps.storage, { ...f, email: 'demo@example.com', viewToken: 'demo', fileName: 'letter.pdf', quote: { currency: 'eur' } });
    await deps.storage.setBytes(fileKey(f.id), pdf);
    if (f.amountCents) await recordPayment(deps.storage, { id: `pi_${f.id}`, amountCents: f.amountCents, currency: 'eur', kind: 'fax', email: 'demo@example.com', faxId: f.id }, Date.parse(f.createdAt));
  }
  await recordPayment(deps.storage, { id: 'in_demo_1', amountCents: 2499, currency: 'eur', kind: 'subscription', email: 'demo@example.com' }, now - 86400000 * 3);
  await saveCustomer(deps.storage, {
    email: 'demo@example.com',
    paidFaxCount: 3,
    faxIds: faxes.map((f) => f.id),
    stripeCustomerId: 'cus_demo',
    subscription: { id: 'sub_demo', status: 'active', pagesUsed: 3, startedAt: iso(86400 / 60 * 3) },
  });
}

const routes = {
  '/api/pricing': pub.createPricingHandler,
  '/api/quote': pub.createQuoteHandler,
  '/api/fax-status': pub.createFaxStatusHandler,
  '/api/media': pub.createMediaHandler,
  '/api/checkout': pay.createCheckoutHandler,
  '/api/subscribe': pay.createSubscribeHandler,
  '/api/stripe-webhook': pay.createStripeWebhookHandler,
  '/api/telnyx-webhook': createTelnyxWebhookHandler,
  '/api/account': acct.createAccountHandler,
  '/api/account-login': acct.createLoginLinkHandler,
  '/api/account-verify': acct.createVerifyLoginHandler,
  '/api/account-logout': acct.createLogoutHandler,
  '/api/account-download': acct.createDownloadHandler,
  '/api/subscription-cancel': acct.createCancelSubscriptionHandler,
  '/api/admin-login': admin.createAdminLoginHandler,
  '/api/admin-logout': admin.createAdminLogoutHandler,
  '/api/admin-stats': admin.createAdminStatsHandler,
};
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const factory = routes[url.pathname];
    if (factory) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);
      const r = await factory(deps)(new Request(url, { method: req.method, headers: req.headers, body, duplex: 'half' }));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    let file = path.join(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': types['.html'] });
      res.end(fs.readFileSync(path.join(root, '404.html')));
      return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await seed();
  createServer().listen(port, () => {
    console.log(`Fax You Up! preview (mocked Stripe/Telnyx, in-memory data) on http://localhost:${port}`);
    console.log(`Demo customer: demo@example.com — the sign-in link is printed below when you request one.`);
    console.log(`Admin (/ops-room.html): password "${ADMIN_PASSWORD}", TOTP secret ${ADMIN_TOTP}`);
    console.log(`  current code: ${totp(ADMIN_TOTP)}   (otpauth: ${otpauthUrl({ secret: ADMIN_TOTP })})`);
  });
}
