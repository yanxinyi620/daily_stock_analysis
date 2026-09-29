import { handleSchedule } from '../server/cloudSchedule.js';

export default { fetch: (request: Request) => handleSchedule(request) };
