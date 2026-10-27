import { netlifyHandler } from '../../lib/deps.js';
import { createFaxStatusHandler } from '../../lib/handlers/public.js';

export default netlifyHandler(createFaxStatusHandler);

export const config = { path: '/api/fax-status' };
