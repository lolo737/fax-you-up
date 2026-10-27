import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateQuote, countPdfPages, normaliseFaxNumber, QuoteError, formatEuro } from '../lib/pricing.js';
import pricing from '../config/pricing.js';
import { makePdf } from './helpers.js';

test('a fax of up to 3 pages costs the base price', () => {
  for (const pages of [1, 2, 3]) {
    const q = calculateQuote(pages);
    assert.equal(q.totalCents, pricing.perFax.basePriceCents);
    assert.equal(q.extraPages, 0);
    assert.equal(q.promoApplied, false);
  }
  assert.equal(calculateQuote(3).totalCents, 150);
});

test('pages beyond the included three are charged per page', () => {
  const q = calculateQuote(5);
  assert.equal(q.extraPages, 2);
  assert.equal(q.extraCents, 2 * pricing.perFax.extraPageCents);
  assert.equal(q.totalCents, 150 + 2 * 50);
});

test('zero, fractional and oversized page counts are refused', () => {
  assert.throws(() => calculateQuote(0), QuoteError);
  assert.throws(() => calculateQuote(1.5), QuoteError);
  assert.throws(() => calculateQuote(pricing.perFax.maxPages + 1), (e) => e.code === 'too_many_pages');
});

test('pricing is configurable: a different config gives a different quote', () => {
  const cfg = structuredClone(pricing);
  cfg.perFax.basePriceCents = 200;
  cfg.perFax.includedPages = 1;
  cfg.perFax.extraPageCents = 25;
  assert.equal(calculateQuote(3, {}, cfg).totalCents, 250);
});

test('page counting uses the real PDF', async () => {
  assert.equal(await countPdfPages(await makePdf(1)), 1);
  assert.equal(await countPdfPages(await makePdf(7)), 7);
});

test('non-PDF uploads are rejected', async () => {
  await assert.rejects(countPdfPages(new TextEncoder().encode('hello, not a pdf')), (e) => e.code === 'not_pdf');
  await assert.rejects(countPdfPages(new TextEncoder().encode('%PDF-1.7 garbage')), (e) => e.code === 'unreadable_pdf');
});

test('fax numbers are normalised to E.164 and checked against allowed countries', () => {
  assert.equal(normaliseFaxNumber('+353 (1) 234-5678'), '+35312345678');
  assert.equal(normaliseFaxNumber('0049 30 1234567'), '+49301234567');
  assert.throws(() => normaliseFaxNumber('01 234 5678'), (e) => e.code === 'bad_number');
  assert.throws(() => normaliseFaxNumber('+86 10 1234 5678'), (e) => e.code === 'destination_not_supported');
});

test('euro formatting', () => {
  assert.equal(formatEuro(150), '€1.50');
  assert.equal(formatEuro(2499), '€24.99');
});
