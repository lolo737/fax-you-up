import { netlifyHandler } from '../../lib/deps.js';
import { createTelnyxWebhookHandler } from '../../lib/handlers/telnyx-webhook.js';

export default netlifyHandler(createTelnyxWebhookHandler);

export const config = { path: '/api/telnyx-webhook' };
