import { PDFDocument } from 'pdf-lib';
import defaultPricing from '../config/pricing.js';

export class QuoteError extends Error {
  constructor(message, code = 'bad_request') {
    super(message);
    this.code = code;
  }
}

/**
 * Work out what one fax costs. Pure function: no I/O, no surprises.
 * @param {number} pages
 * @param {{ isFirstFax?: boolean }} opts
 */
export function calculateQuote(pages, { isFirstFax = false } = {}, cfg = defaultPricing) {
  if (!Number.isInteger(pages) || pages < 1) {
    throw new QuoteError('The document has no pages we can fax.', 'no_pages');
  }
  if (pages > cfg.perFax.maxPages) {
    throw new QuoteError(`That is ${pages} pages; the limit is ${cfg.perFax.maxPages} per fax.`, 'too_many_pages');
  }
  const promoApplied = Boolean(isFirstFax && cfg.promo.firstFaxEnabled);
  const baseCents = promoApplied ? cfg.promo.firstFaxBasePriceCents : cfg.perFax.basePriceCents;
  const extraPages = Math.max(0, pages - cfg.perFax.includedPages);
  const extraCents = extraPages * cfg.perFax.extraPageCents;
  return {
    currency: cfg.currency,
    pages,
    includedPages: cfg.perFax.includedPages,
    baseCents,
    extraPages,
    extraCents,
    totalCents: baseCents + extraCents,
    promoApplied,
  };
}

/** Count pages in a PDF. Throws QuoteError for anything that is not a readable PDF. */
export async function countPdfPages(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const head = Buffer.from(buf.subarray(0, 1024)).toString('latin1');
  if (!head.includes('%PDF-')) {
    throw new QuoteError('That file is not a PDF.', 'not_pdf');
  }
  try {
    const doc = await PDFDocument.load(buf, { updateMetadata: false });
    return doc.getPageCount();
  } catch (err) {
    if (/encrypted/i.test(String(err && err.message))) {
      throw new QuoteError('That PDF is password-protected. Please remove the password and try again.', 'encrypted_pdf');
    }
    throw new QuoteError('We could not read that PDF.', 'unreadable_pdf');
  }
}

export function formatEuro(cents) {
  return `€${(cents / 100).toFixed(2)}`;
}

/** Normalise a fax number to E.164 and check it is in an allowed destination. */
export function normaliseFaxNumber(input, cfg = defaultPricing) {
  const cleaned = String(input || '')
    .trim()
    .replace(/^00/, '+')
    .replace(/[\s().\-/]/g, '');
  if (!/^\+[1-9]\d{6,14}$/.test(cleaned)) {
    throw new QuoteError('Please enter the fax number in international format, e.g. +353 1 234 5678.', 'bad_number');
  }
  if (!cfg.allowedDestinationPrefixes.some((p) => cleaned.startsWith(p))) {
    throw new QuoteError('Sorry, we do not fax to that country yet.', 'destination_not_supported');
  }
  return cleaned;
}

/** Public, display-friendly pricing (what /api/pricing returns). */
export function publicPricing(cfg = defaultPricing) {
  return {
    currency: cfg.currency,
    basePriceCents: cfg.perFax.basePriceCents,
    includedPages: cfg.perFax.includedPages,
    extraPageCents: cfg.perFax.extraPageCents,
    maxPages: cfg.perFax.maxPages,
    promo: cfg.promo.firstFaxEnabled ? { firstFaxBasePriceCents: cfg.promo.firstFaxBasePriceCents } : null,
    subscription: cfg.subscription.enabled
      ? { monthlyPriceCents: cfg.subscription.monthlyPriceCents, includedPagesPerMonth: cfg.subscription.includedPagesPerMonth }
      : null,
    allowedDestinationPrefixes: cfg.allowedDestinationPrefixes,
  };
}
