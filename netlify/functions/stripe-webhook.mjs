import { netlifyHandler } from '../../lib/deps.js';
import { createStripeWebhookHandler } from '../../lib/handlers/payments.js';

export default netlifyHandler(createStripeWebhookHandler);

export const config = { path: '/api/stripe-webhook' };
