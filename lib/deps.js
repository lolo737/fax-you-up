/**
 * Builds the real dependencies for a Netlify Function from environment
 * variables. Tests never call this; they hand mocks to the handler factories.
 */
import Stripe from 'stripe';
import pricing from '../config/pricing.js';
import retryPolicy from '../config/retry.js';
import { getStorage } from './storage/index.js';
import { getMailer } from './email/index.js';
import { createTelnyxClient } from './telnyx.js';

let stripeClient;
let mailer;

export async function getDeps(env = process.env) {
  if (!stripeClient && env.STRIPE_SECRET_KEY) stripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  if (!mailer) mailer = getMailer(env);
  return {
    env,
    pricing,
    retryPolicy,
    storage: await getStorage(env),
    mailer,
    get stripe() {
      if (!stripeClient) throw new Error('STRIPE_SECRET_KEY is not set');
      return stripeClient;
    },
    get telnyx() {
      return createTelnyxClient({
        apiKey: env.TELNYX_API_KEY,
        connectionId: env.TELNYX_CONNECTION_ID,
        fromNumber: env.TELNYX_FROM_NUMBER,
      });
    },
    now: () => Date.now(),
  };
}

/** Wrap a handler factory so each request gets deps and errors become JSON 500s. */
export function netlifyHandler(factory) {
  return async (req, context) => {
    try {
      const deps = await getDeps();
      return await factory(deps)(req, context);
    } catch (err) {
      console.error(err);
      return new Response(JSON.stringify({ error: { code: 'server_error', message: 'Something went wrong on our side.' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
}
