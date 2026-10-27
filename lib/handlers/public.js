import { calculateQuote, countPdfPages, normaliseFaxNumber, publicPricing, QuoteError } from '../pricing.js';
import { errorResponse, isEmail, json, methodNotAllowed } from '../http.js';
import { addHistory, fileKey, getCustomer, getFax, publicFaxView, saveFax, subscriptionPagesLeft } from '../faxes.js';
import { randomId, safeEqual, verifyToken } from '../crypto.js';
import { getCustomerEmail } from '../session.js';

export const createPricingHandler = (deps) => async (req) => {
  if (req.method !== 'GET') return methodNotAllowed('GET');
  return json(publicPricing(deps.pricing), 200, { 'Cache-Control': 'public, max-age=300' });
};

/**
 * POST multipart/form-data { file: PDF, to: fax number, email }
 * Counts the pages, stores the PDF, creates a "quoted" fax and returns the price.
 * The price is fixed here, before anything is paid or sent.
 */
export const createQuoteHandler = (deps) => async (req) => {
  if (req.method !== 'POST') return methodNotAllowed('POST');
  const { storage, pricing, env, now = () => Date.now() } = deps;
  let form;
  try {
    form = await req.formData();
  } catch {
    return errorResponse(400, 'Please upload a PDF using the form.', 'bad_form');
  }
  const file = form.get('file');
  const email = String(form.get('email') || '').trim().toLowerCase();
  if (!file || typeof file === 'string') return errorResponse(400, 'Please choose a PDF to fax.', 'no_file');
  if (!isEmail(email)) return errorResponse(400, 'Please enter a valid e-mail address so we can tell you how it went.', 'bad_email');
  if (file.size > pricing.upload.maxBytes) {
    return errorResponse(413, `That file is too big (limit ${Math.round(pricing.upload.maxBytes / 1e6)} MB).`, 'too_big');
  }
  try {
    const to = normaliseFaxNumber(form.get('to'), pricing);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pages = await countPdfPages(bytes);
    const customer = await getCustomer(storage, email);
    const quote = calculateQuote(pages, { isFirstFax: customer.paidFaxCount === 0 }, pricing);
    const sessionEmail = getCustomerEmail(req, env, now());
    const subscriptionCovered = sessionEmail === email && subscriptionPagesLeft(customer, pricing) >= pages;
    const id = randomId('fax_', 12);
    const t = now();
    const fax = {
      id,
      viewToken: randomId('', 18),
      status: 'quoted',
      email,
      to,
      pages,
      fileName: String(file.name || 'document.pdf').slice(0, 120),
      quote,
      amountCents: subscriptionCovered ? 0 : quote.totalCents,
      subscriptionCovered,
      attempts: 0,
      createdAt: new Date(t).toISOString(),
    };
    addHistory(fax, 'quoted', t, { totalCents: quote.totalCents });
    await storage.setBytes(fileKey(id), bytes);
    await saveFax(storage, fax, t);
    return json({ faxId: id, viewToken: fax.viewToken, to, pages, quote, subscriptionCovered });
  } catch (err) {
    if (err instanceof QuoteError) return errorResponse(400, err.message, err.code);
    throw err;
  }
};

/** GET ?id=<faxId>&t=<viewToken> — status for the customer's status page. */
export const createFaxStatusHandler = (deps) => async (req) => {
  if (req.method !== 'GET') return methodNotAllowed('GET');
  const url = new URL(req.url);
  const fax = await getFax(deps.storage, url.searchParams.get('id'));
  if (!fax || !safeEqual(fax.viewToken, url.searchParams.get('t') || '')) return errorResponse(404, 'No such fax.', 'not_found');
  return json(publicFaxView(fax));
};

/** GET ?t=<signed token> — the PDF, for Telnyx to fetch. Token expires after 24 h. */
export const createMediaHandler = (deps) => async (req) => {
  if (req.method !== 'GET') return methodNotAllowed('GET');
  const { env, storage, now = () => Date.now() } = deps;
  const token = new URL(req.url).searchParams.get('t');
  const payload = verifyToken(token, env.MEDIA_URL_SECRET || env.SESSION_SECRET, now());
  if (!payload) return new Response('Forbidden', { status: 403 });
  const bytes = await storage.getBytes(fileKey(payload.f));
  if (!bytes) return new Response('Not found', { status: 404 });
  return new Response(bytes, {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store' },
  });
};
