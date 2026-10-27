import { netlifyHandler } from '../../lib/deps.js';
import { createPricingHandler } from '../../lib/handlers/public.js';

export default netlifyHandler(createPricingHandler);

export const config = { path: '/api/pricing' };
