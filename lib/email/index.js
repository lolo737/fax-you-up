/**
 * Mailer interface: { send({ to, subject, text, html }) -> { id } }.
 * Pick a provider with EMAIL_PROVIDER=resend | postmark | console | memory.
 */
export function createMemoryMailer() {
  const sent = [];
  return {
    provider: 'memory',
    sent,
    async send(msg) {
      sent.push(msg);
      return { id: `mem_${sent.length}` };
    },
  };
}

export function createConsoleMailer(log = console.log) {
  return {
    provider: 'console',
    async send(msg) {
      log(`[email] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
      return { id: 'console' };
    },
  };
}

export function createResendMailer({ apiKey, from, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');
  return {
    provider: 'resend',
    async send({ to, subject, text, html }) {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text, html }),
      });
      if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
      const body = await res.json();
      return { id: body.id };
    },
  };
}

export function createPostmarkMailer({ serverToken, from, fetchImpl = fetch }) {
  if (!serverToken) throw new Error('POSTMARK_SERVER_TOKEN is not set');
  return {
    provider: 'postmark',
    async send({ to, subject, text, html }) {
      const res = await fetchImpl('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          'X-Postmark-Server-Token': serverToken,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ From: from, To: to, Subject: subject, TextBody: text, HtmlBody: html, MessageStream: 'outbound' }),
      });
      if (!res.ok) throw new Error(`Postmark error ${res.status}: ${await res.text()}`);
      const body = await res.json();
      return { id: body.MessageID };
    },
  };
}

export function getMailer(env = process.env) {
  const from = env.EMAIL_FROM || 'Fax You Up! <faxes@example.com>';
  switch (env.EMAIL_PROVIDER || 'console') {
    case 'resend':
      return createResendMailer({ apiKey: env.RESEND_API_KEY, from });
    case 'postmark':
      return createPostmarkMailer({ serverToken: env.POSTMARK_SERVER_TOKEN, from });
    case 'memory':
      return createMemoryMailer();
    case 'console':
      return createConsoleMailer();
    default:
      throw new Error(`Unknown EMAIL_PROVIDER "${env.EMAIL_PROVIDER}"`);
  }
}
