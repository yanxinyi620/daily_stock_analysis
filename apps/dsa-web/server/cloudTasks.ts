/** Trusted submission boundary. Never imported by the browser bundle. */
type Environment = Record<string, string | undefined>;
type Fetcher = typeof fetch;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const errors: Record<string, number> = {
  RUNNER_OFFLINE: 409, RUNNER_BUSY: 409, IDEMPOTENCY_CONFLICT: 409,
  INVALID_INPUT: 400, EMPTY_WATCHLIST: 400, SNAPSHOT_TOO_LARGE: 400, MEMBER_DISABLED: 403,
};
class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
export async function handleTasks(request: Request, env: Environment = process.env, fetcher: Fetcher = fetch): Promise<Response> {
  try {
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    const authorization = request.headers.get('authorization') ?? '';
    if (!/^Bearer \S+$/i.test(authorization)) return json({ error: 'UNAUTHENTICATED' }, 401);
    const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: key, SUPABASE_PUBLISH_USER_ID: owner, CLOUD_RUNNER_ID: runner = 'local-primary' } = env;
    if (!url || !key || !owner || !uuid.test(owner)) throw new ApiError('NOT_CONFIGURED', 503);
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new ApiError('NOT_CONFIGURED', 503);
    const base = parsed.origin;
    const call = async (path: string, args?: unknown, auth?: string) => {
      const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
      if (auth) headers.Authorization = auth;
      // Legacy service_role JWTs need Authorization too; modern Secret Keys use apikey.
      else if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
      const response = await fetcher(`${base}${path}`, { method: args === undefined ? 'GET' : 'POST', headers,
        body: args === undefined ? undefined : JSON.stringify(args), redirect: 'error', signal: AbortSignal.timeout(8000) });
      if (!response.ok) {
        if (auth && [401, 403].includes(response.status)) throw new ApiError('UNAUTHENTICATED', 401);
        let message = '';
        try { const data = await response.json() as { message?: unknown }; message = typeof data?.message === 'string' ? data.message : ''; } catch { /* use sanitized default */ }
        if (Object.prototype.hasOwnProperty.call(errors, message)) throw new ApiError(message, errors[message]);
        throw new ApiError('BACKEND_UNAVAILABLE', 503);
      }
      return response.json();
    };
    const user = await call('/auth/v1/user', undefined, authorization) as { id?: unknown };
    if (user?.id !== owner) return json({ error: 'FORBIDDEN' }, 403);
    const members = await call(`/rest/v1/app_members?user_id=eq.${owner}&select=enabled`);
    if (!Array.isArray(members) || members[0]?.enabled !== true) return json({ error: 'FORBIDDEN' }, 403);
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
