import { netlifyHandler } from '../../lib/deps.js';
import { createCheckoutHandler } from '../../lib/handlers/payments.js';

export default netlifyHandler(createCheckoutHandler);

export const config = { path: '/api/checkout' };
