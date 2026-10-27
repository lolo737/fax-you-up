import { netlifyHandler } from '../../lib/deps.js';
import { createCancelSubscriptionHandler } from '../../lib/handlers/account.js';

export default netlifyHandler(createCancelSubscriptionHandler);

export const config = { path: '/api/subscription-cancel' };
