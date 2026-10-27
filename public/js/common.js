import { initI18n, t } from './i18n.js';

export { t };

export const euro = (cents) =>
  new Intl.NumberFormat(document.documentElement.lang === 'de' ? 'de-DE' : 'en-IE', { style: 'currency', currency: 'EUR' }).format(cents / 100);

export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, opts);
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data?.error?.code;
    throw err;
  }
  return data;
}

export function show(el, msg, kind = 'error') {
  if (!el) return;
  el.className = `notice ${kind}`;
  el.textContent = msg;
  el.hidden = !msg;
}

/** Fill every [data-price] element from /api/pricing so pages never drift from config. */
export async function fillPrices() {
  const els = document.querySelectorAll('[data-price]');
  if (!els.length) return null;
  try {
    const p = await api('/api/pricing');
    const values = {
      base: euro(p.basePriceCents),
      promo: p.promo ? euro(p.promo.firstFaxBasePriceCents) : '',
      extra: euro(p.extraPageCents),
      monthly: p.subscription ? euro(p.subscription.monthlyPriceCents) : '',
      included: String(p.includedPages),
      'sub-pages': p.subscription ? String(p.subscription.includedPagesPerMonth) : '',
      'max-pages': String(p.maxPages),
    };
    els.forEach((el) => {
      const v = values[el.dataset.price];
      if (v) el.textContent = v;
    });
    return p;
  } catch {
    return null; // static values in the HTML stay as they are
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initI18n();
  fillPrices();
  const y = document.querySelector('[data-year]');
  if (y) y.textContent = String(new Date().getFullYear());
});
