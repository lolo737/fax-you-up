import { netlifyHandler } from '../../lib/deps.js';
import { createDownloadHandler } from '../../lib/handlers/account.js';

export default netlifyHandler(createDownloadHandler);

export const config = { path: '/api/account-download' };
