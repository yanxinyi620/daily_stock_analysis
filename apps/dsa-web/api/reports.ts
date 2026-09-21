import { handleReports } from '../server/cloudReports.js';

export default { fetch: (request: Request) => handleReports(request) };
