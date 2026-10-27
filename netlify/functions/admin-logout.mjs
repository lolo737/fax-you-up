import { netlifyHandler } from '../../lib/deps.js';
import { createAdminLogoutHandler } from '../../lib/handlers/admin.js';

export default netlifyHandler(createAdminLogoutHandler);

export const config = { path: '/api/admin-logout' };
