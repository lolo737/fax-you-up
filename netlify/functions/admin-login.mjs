import { netlifyHandler } from '../../lib/deps.js';
import { createAdminLoginHandler } from '../../lib/handlers/admin.js';

export default netlifyHandler(createAdminLoginHandler);

export const config = { path: '/api/admin-login' };
