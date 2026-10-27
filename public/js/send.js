import { api, euro, show, t } from './common.js';

const $ = (s) => document.querySelector(s);
const form = $('#send-form');
const fileInput = $('#file');
const drop = $('#drop');
const fileName = $('#file-name');
const msg = $('#send-msg');
const quoteBox = $('#quote');
const payBtn = $('#pay');
const quoteBtn = $('#get-quote');
const statusBox = $('#status');
let current = null;

function setFileLabel() {
  const f = fileInput.files[0];
  const size = f && (f.size < 1e6 ? `${Math.max(1, Math.round(f.size / 1e3))} KB` : `${(f.size / 1e6).toFixed(1)} MB`);
  fileName.textContent = f ? `${f.name} · ${size}` : '';
  quoteBox.hidden = true;
  current = null;
}

fileInput?.addEventListener('change', setFileLabel);
['dragenter', 'dragover'].forEach((e) => drop?.addEventListener(e, () => drop.classList.add('over')));
['dragleave', 'drop'].forEach((e) => drop?.addEventListener(e, () => drop.classList.remove('over')));
form?.addEventListener('input', (e) => {
  if (e.target !== fileInput) { quoteBox.hidden = true; current = null; }
});

function renderQuote(q) {
  const rows = [
    [t('send.quote.pages'), String(q.pages)],
    [t('send.quote.base', { n: q.quote.includedPages }), euro(q.quote.baseCents)],
  ];
  if (q.quote.extraPages) rows.push([`${t('send.quote.extra')} (${q.quote.extraPages})`, euro(q.quote.extraCents)]);
  const dl = $('#quote-lines');
  dl.replaceChildren();
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  $('#quote-promo').hidden = !q.quote.promoApplied || q.subscriptionCovered;
  $('#quote-sub').hidden = !q.subscriptionCovered;
  $('#quote-to').textContent = q.to;
  $('#quote-total').textContent = q.subscriptionCovered ? euro(0) : euro(q.quote.totalCents);
  quoteBox.hidden = false;
  quoteBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  payBtn.focus({ preventScroll: true });
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  show(msg, '');
  if (!fileInput.files[0]) return show(msg, 'Please choose a PDF first.');
  quoteBtn.disabled = true;
  try {
    const fd = new FormData(form);
    current = await api('/api/quote', { method: 'POST', form: fd });
    renderQuote(current);
  } catch (err) {
    show(msg, err.message);
  } finally {
    quoteBtn.disabled = false;
  }
});

payBtn?.addEventListener('click', async () => {
  if (!current) return;
  payBtn.disabled = true;
  try {
    const res = await api('/api/checkout', { method: 'POST', body: { faxId: current.faxId, viewToken: current.viewToken } });
    if (res.url) location.assign(res.url);
    else if (res.statusUrl) location.assign(res.statusUrl);
  } catch (err) {
    show(msg, err.message);
    payBtn.disabled = false;
  }
});

/* Status view: /send.html?fax=<id>&t=<token> */
async function pollStatus(id, token, tries = 0) {
  try {
    const s = await api(`/api/fax-status?id=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}`);
    const pill = $('#status-pill');
    pill.className = `status-pill ${s.status}`;
    pill.textContent = t(`status.${s.status}`);
    $('#status-to').textContent = s.to;
    $('#status-pages').textContent = String(s.pages);
    $('#status-attempts').textContent = String(s.attempts);
    $('#status-reason').hidden = s.status !== 'failed';
    $('#status-reason').textContent = s.lastFailureReason ? `Reason: ${s.lastFailureReason}` : '';
    if (!['delivered', 'failed'].includes(s.status) && tries < 120) {
      setTimeout(() => pollStatus(id, token, tries + 1), tries < 20 ? 3000 : 15000);
    }
  } catch (err) {
    show($('#status-msg'), err.message);
  }
}

const params = new URLSearchParams(location.search);
if (params.get('fax') && params.get('t')) {
  form.hidden = true;
  $('#send-intro').hidden = true;
  statusBox.hidden = false;
  if (params.get('cancelled')) show($('#status-msg'), 'Payment was cancelled. Nothing has been charged or sent.', 'info');
  if (params.get('paid')) show($('#status-msg'), 'Payment received. Sending now — you can close this page; we will email you.', 'ok');
  pollStatus(params.get('fax'), params.get('t'));
}
