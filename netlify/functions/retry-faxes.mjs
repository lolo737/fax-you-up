/**
 * Scheduled function: every minute, re-send faxes whose back-off has elapsed.
 * (Scheduled functions run on published deploys; locally, invoke with
 * `netlify functions:invoke retry-faxes`.)
 */
import { getDeps } from '../../lib/deps.js';
import { runDueRetries } from '../../lib/faxes.js';

export default async () => {
  const deps = await getDeps();
  const sent = await runDueRetries(deps);
  if (sent.length) console.log(`retry-faxes: re-sent ${sent.length} fax(es): ${sent.join(', ')}`);
  return new Response(null, { status: 204 });
};

export const config = { schedule: '* * * * *' };
