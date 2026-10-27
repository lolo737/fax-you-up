import { formatEuro } from '../pricing.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function wrap(title, paragraphs) {
  const text = [title, '', ...paragraphs, '', '— Fax You Up!'].join('\n');
  const html = `<!doctype html><html><body style="font-family:Georgia,serif;color:#1b1a17;max-width:560px;margin:auto;padding:24px">
<h1 style="font-size:22px">${esc(title)}</h1>
${paragraphs.map((p) => `<p style="line-height:1.5">${esc(p)}</p>`).join('\n')}
<p style="color:#6b665c">— Fax You Up!</p></body></html>`;
  return { text, html };
}

export function faxDeliveredEmail({ fax, siteUrl }) {
  const subject = `Delivered: your fax to ${fax.to}`;
  return {
    subject,
    ...wrap('Your fax has been delivered.', [
      `${fax.pages} page(s) to ${fax.to} were received by the other machine.`,
      `Reference: ${fax.id}`,
      `Status page: ${siteUrl}/send.html?fax=${fax.id}&t=${fax.viewToken}`,
    ]),
  };
}

export function faxFailedEmail({ fax, siteUrl }) {
  const subject = `Not delivered: your fax to ${fax.to}`;
  return {
    subject,
    ...wrap('We could not deliver your fax.', [
      `We tried ${fax.attempts} time(s) to send ${fax.pages} page(s) to ${fax.to} and it did not go through (reason: ${fax.lastFailureReason || 'unknown'}).`,
      'The most common cause is a wrong number or a line that is not a fax machine. Please check the number and send it again.',
      `Reference: ${fax.id}`,
      `Send again: ${siteUrl}/send.html`,
    ]),
  };
}

export function loginLinkEmail({ link }) {
  return {
    subject: 'Your Fax You Up! sign-in link',
    ...wrap('Sign in to Fax You Up!', [
      'Use this link to open your account. It works once and expires in 20 minutes.',
      link,
      'If you did not ask for this, ignore this e-mail.',
    ]),
  };
}

export function subscriptionCancelledEmail({ siteUrl }) {
  return {
    subject: 'Your Fax You Up! subscription is cancelled',
    ...wrap('Cancelled. Properly.', [
      'Your monthly subscription has been cancelled and you will not be charged again.',
      `You can still download all your files as a ZIP from your account: ${siteUrl}/account.html`,
    ]),
  };
}

export function receiptLine(fax) {
  return `${fax.id}: ${fax.pages} page(s) to ${fax.to}, ${formatEuro(fax.amountCents || 0)}`;
}
