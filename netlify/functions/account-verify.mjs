import { netlifyHandler } from '../../lib/deps.js';
import { createVerifyLoginHandler } from '../../lib/handlers/account.js';

export default netlifyHandler(createVerifyLoginHandler);

export const config = { path: '/api/account-verify' };
