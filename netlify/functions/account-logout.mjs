import { netlifyHandler } from '../../lib/deps.js';
import { createLogoutHandler } from '../../lib/handlers/account.js';

export default netlifyHandler(createLogoutHandler);

export const config = { path: '/api/account-logout' };
