import { netlifyHandler } from '../../lib/deps.js';
import { createQuoteHandler } from '../../lib/handlers/public.js';

export default netlifyHandler(createQuoteHandler);

export const config = { path: '/api/quote' };
