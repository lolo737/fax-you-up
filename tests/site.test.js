import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import pricing from '../config/pricing.js';
import { calculateQuote, formatEuro } from '../lib/pricing.js';

const html = (f) => fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');

test('the static fallback prices in the HTML match config/pricing.js', () => {
  const page = html('pricing.html');
  const want = {
    base: formatEuro(pricing.perFax.basePriceCents),
    promo: formatEuro(pricing.promo.firstFaxBasePriceCents),
    extra: formatEuro(pricing.perFax.extraPageCents),
    monthly: formatEuro(pricing.subscription.monthlyPriceCents),
    included: String(pricing.perFax.includedPages),
    'sub-pages': String(pricing.subscription.includedPagesPerMonth),
    'max-pages': String(pricing.perFax.maxPages),
  };
  for (const [key, value] of Object.entries(want)) {
    for (const m of page.matchAll(new RegExp(`data-price="${key}">([^<]*)<`, 'g'))) assert.equal(m[1], value, `data-price="${key}"`);
  }
});

test('the worked-examples table on the pricing page is correct', () => {
  const page = html('pricing.html');
  for (const [pages, label] of [[3, '1–3 pages'], [5, '5 pages'], [10, '10 pages']]) {
    const first = formatEuro(calculateQuote(pages, { isFirstFax: true }).totalCents);
    const later = formatEuro(calculateQuote(pages).totalCents);
    assert.ok(page.includes(`<td>${label}</td><td class="num">${first}</td><td class="num">${later}</td>`), `${label}: ${first} / ${later}`);
  }
});

test('terms state the no-refund rule and the one-click cancel', () => {
  const page = html('terms.html');
  assert.match(page, /Single \(pay-per-fax\) faxes are not refundable/);
  assert.match(page, /Cancel now/);
  assert.match(page, /ZIP/);
});

test('link checker passes', () => {
  const out = execFileSync(process.execPath, [new URL('../scripts/check-links.mjs', import.meta.url).pathname], { encoding: 'utf8' });
  assert.match(out, /all present and correct/);
});
