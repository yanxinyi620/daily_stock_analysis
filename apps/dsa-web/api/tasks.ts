import { handleTasks } from '../server/cloudTasks.js';

export default { fetch: (request: Request) => handleTasks(request) };
