import { api, euro, show, t } from './common.js';

const $ = (s) => document.querySelector(s);
const signin = $('#signin');
const panel = $('#account');
const msg = $('#account-msg');

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString(document.documentElement.lang === 'de' ? 'de-DE' : 'en-IE', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

function renderSubscription(sub) {
  const box = $('#sub-body');
  const cancelBtn = $('#cancel');
  const subscribeBtn = $('#subscribe');
  if (!sub) {
    box.textContent = 'You have no subscription. Everything you send is pay-per-fax.';
    cancelBtn.hidden = true;
    subscribeBtn.hidden = false;
    return;
  }
  if (sub.status === 'active') {
    box.textContent = `Active since ${fmtDate(sub.startedAt)}. ${sub.pagesLeft} pages left this month.`;
    cancelBtn.hidden = false;
    subscribeBtn.hidden = true;
  } else {
    box.textContent = `Cancelled${sub.cancelledAt ? ` on ${fmtDate(sub.cancelledAt)}` : ''}. You will not be charged again.`;
    cancelBtn.hidden = true;
    subscribeBtn.hidden = false;
  }
}

function renderFaxes(faxes) {
  const tbody = $('#faxes tbody');
  tbody.replaceChildren();
  $('#no-faxes').hidden = faxes.length > 0;
  for (const f of faxes) {
    const tr = document.createElement('tr');
    const cells = [['Date', fmtDate(f.createdAt)], ['To', f.to], ['Pages', String(f.pages)], ['Paid', euro(f.amountCents || 0)]];
    for (const [label, c] of cells) {
      const td = document.createElement('td');
      td.dataset.label = label;
      td.textContent = c;
      tr.append(td);
    }
    tr.children[2].className = 'num';
    tr.children[3].className = 'num';
    const st = document.createElement('td');
    st.dataset.label = 'Status';
    const pill = document.createElement('span');
    pill.className = `status-pill ${f.status}`;
    pill.textContent = t(`status.${f.status}`);
    st.append(pill);
    tr.append(st);
    tbody.append(tr);
  }
}

async function load() {
  try {
    const data = await api('/api/account');
    signin.hidden = true;
    panel.hidden = false;
    $('#who').textContent = data.email;
    renderSubscription(data.subscription);
    renderFaxes(data.faxes);
  } catch (err) {
    if (err.status === 401) {
      signin.hidden = false;
      panel.hidden = true;
    } else show(msg, err.message);
  }
}

$('#signin-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter;
  btn.disabled = true;
  try {
    await api('/api/account-login', { method: 'POST', body: { email: $('#signin-email').value } });
    show(msg, 'Check your inbox: we have sent you a sign-in link (valid for 20 minutes).', 'ok');
  } catch (err) {
    show(msg, err.message);
  } finally {
    btn.disabled = false;
  }
});

/* The big honest button. One press. No maze. */
$('#cancel')?.addEventListener('click', async () => {
  const btn = $('#cancel');
  btn.disabled = true;
  try {
    await api('/api/subscription-cancel', { method: 'POST' });
    show(msg, 'Done. Your subscription is cancelled and you will not be charged again. Your files are below as a ZIP.', 'ok');
    await load();
    $('#download').focus();
  } catch (err) {
    show(msg, err.message);
  } finally {
    btn.disabled = false;
  }
});

$('#subscribe')?.addEventListener('click', async () => {
  try {
    const res = await api('/api/subscribe', { method: 'POST', body: {} });
    location.assign(res.url);
  } catch (err) {
    show(msg, err.message);
  }
});

$('#signout')?.addEventListener('click', async () => {
  await api('/api/account-logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

const params = new URLSearchParams(location.search);
if (params.get('login') === 'expired') show(msg, 'That sign-in link has expired or was already used. Ask for a new one below.', 'warn');
if (params.get('subscribed')) show(msg, 'Welcome aboard. Your subscription is active — and the Cancel button is right there whenever you want it.', 'ok');
load();
