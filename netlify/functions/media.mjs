import { netlifyHandler } from '../../lib/deps.js';
import { createMediaHandler } from '../../lib/handlers/public.js';

export default netlifyHandler(createMediaHandler);

export const config = { path: '/api/media' };
