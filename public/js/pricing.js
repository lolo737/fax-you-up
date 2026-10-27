import { api, show } from './common.js';

const form = document.querySelector('#subscribe-form');
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.querySelector('#subscribe-msg');
  try {
    const res = await api('/api/subscribe', { method: 'POST', body: { email: form.email.value } });
    location.assign(res.url);
  } catch (err) {
    show(msg, err.message);
  }
});
