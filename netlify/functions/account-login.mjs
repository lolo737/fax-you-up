import { netlifyHandler } from '../../lib/deps.js';
import { createLoginLinkHandler } from '../../lib/handlers/account.js';

export default netlifyHandler(createLoginLinkHandler);

export const config = { path: '/api/account-login' };
