import { api, euro, show } from './common.js';

const $ = (s) => document.querySelector(s);

function row(cells, numeric = []) {
  const tr = document.createElement('tr');
  cells.forEach((c, i) => {
    const td = document.createElement('td');
    td.textContent = c ?? '';
    if (numeric.includes(i)) td.className = 'num';
    tr.append(td);
  });
  return tr;
}

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IE', { dateStyle: 'short', timeStyle: 'short' }) : '');

async function load() {
  try {
    const s = await api('/api/admin-stats');
    $('#login-form').hidden = true;
    $('#dash').hidden = false;
    $('#s-delivered').textContent = s.faxes.delivered;
    $('#s-failed').textContent = s.faxes.failed;
    $('#s-inflight').textContent = s.faxes.inFlight;
    $('#s-money-week').textContent = euro(s.money.last7DaysCents);
    $('#s-money-total').textContent = euro(s.money.totalCents);
    $('#s-money-fax').textContent = euro(s.money.faxCents);
    $('#s-money-sub').textContent = euro(s.money.subscriptionCents);
    $('#s-pages').textContent = s.faxes.pagesDelivered;
    $('#generated').textContent = when(s.generatedAt);
    const fb = $('#t-faxes tbody');
    fb.replaceChildren(...s.recentFaxes.map((f) => row([when(f.createdAt), f.to, f.pages, f.status, f.attempts, euro(f.amountCents || 0), f.lastFailureReason || (f.nextAttemptAt ? `retry ${when(f.nextAttemptAt)}` : '')], [2, 4, 5])));
    const pb = $('#t-payments tbody');
    pb.replaceChildren(...s.recentPayments.map((p) => row([when(p.at), p.kind, euro(p.amountCents)], [2])));
  } catch (err) {
    if (err.status === 401) {
      $('#login-form').hidden = false;
      $('#dash').hidden = true;
    } else show($('#admin-msg'), err.message);
  }
}

$('#login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/admin-login', { method: 'POST', body: { password: f.password.value, code: f.code.value } });
    f.reset();
    load();
  } catch (err) {
    show($('#admin-msg'), err.message);
  }
});

$('#logout')?.addEventListener('click', async () => {
  await api('/api/admin-logout', { method: 'POST' }).catch(() => {});
  location.reload();
});
$('#refresh')?.addEventListener('click', load);
load();
