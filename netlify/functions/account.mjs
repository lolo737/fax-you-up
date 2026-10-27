import { netlifyHandler } from '../../lib/deps.js';
import { createAccountHandler } from '../../lib/handlers/account.js';

export default netlifyHandler(createAccountHandler);

export const config = { path: '/api/account' };
