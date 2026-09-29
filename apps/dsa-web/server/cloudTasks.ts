/** Trusted submission boundary. Never imported by the browser bundle. */
import { ApiError, authorizeOwner, json, type Environment, type Fetcher } from './cloudAuth.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const errors: Record<string, number> = {
  RUNNER_OFFLINE: 409, RUNNER_BUSY: 409, IDEMPOTENCY_CONFLICT: 409,
  INVALID_INPUT: 400, EMPTY_WATCHLIST: 400, SNAPSHOT_TOO_LARGE: 400, MEMBER_DISABLED: 403,
};
export async function handleTasks(request: Request, env: Environment = process.env, fetcher: Fetcher = fetch): Promise<Response> {
  try {
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    const { owner, call } = await authorizeOwner(request, env, fetcher, errors);
    const runner = env.CLOUD_RUNNER_ID ?? 'local-primary';
    const identity = { p_user_id: owner, p_runner_id: runner };
    if (request.method === 'GET') return json(await call('/rest/v1/rpc/cloud_runner_snapshot', identity));
    if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'INVALID_INPUT' }, 400);
    const raw = await request.text();
    if (raw.length > 2048) return json({ error: 'INVALID_INPUT' }, 400);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: 'INVALID_INPUT' }, 400); }
    const stockInput = body?.task_type === 'stock_analysis' && Object.keys(body.input ?? {}).join(',') === 'stock_code' &&
      typeof body.input?.stock_code === 'string' && /^(?:\d{6}|hk\d{5}|[A-Z][A-Z0-9.^-]{0,19})$/.test(body.input.stock_code);
    const marketInput = body?.task_type === 'market_review' && Object.keys(body.input ?? {}).join(',') === 'region' &&
      typeof body.input?.region === 'string' && ['cn', 'hk', 'us', 'jp', 'kr'].includes(body.input.region);
    const compositeInput = body?.task_type === 'composite_analysis' && Object.keys(body.input ?? {}).join(',') === 'region' &&
      typeof body.input?.region === 'string' && ['cn', 'hk', 'us', 'jp', 'kr'].includes(body.input.region);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'input,request_id,task_type' || !uuid.test(body.request_id ?? '') ||
        !body.input || typeof body.input !== 'object' || Array.isArray(body.input) || (!stockInput && !marketInput && !compositeInput)) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }
    return json(await call('/rest/v1/rpc/cloud_submit_execution', {
      ...identity, p_request_id: body.request_id, p_task_type: body.task_type, p_input: body.input,
    }), 201);
  } catch (error) {
    return json({ error: error instanceof ApiError ? error.message : 'BACKEND_UNAVAILABLE' }, error instanceof ApiError ? error.status : 503);
  }
}
