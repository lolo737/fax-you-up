import { netlifyHandler } from '../../lib/deps.js';
import { createSubscribeHandler } from '../../lib/handlers/payments.js';

export default netlifyHandler(createSubscribeHandler);

export const config = { path: '/api/subscribe' };
