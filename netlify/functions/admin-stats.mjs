import { netlifyHandler } from '../../lib/deps.js';
import { createAdminStatsHandler } from '../../lib/handlers/admin.js';

export default netlifyHandler(createAdminStatsHandler);

export const config = { path: '/api/admin-stats' };
