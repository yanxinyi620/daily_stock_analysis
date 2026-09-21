/** Privileged permanent deletion boundary. Never import this from browser code. */
type Environment = Record<string, string | undefined>;
type Fetcher = typeof fetch;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const totalBudgetMs = 25_000;
const requestBudgetMs = 8_000;
const purgeForbidden = new Set(['member_inactive', 'report_not_owned']);
const purgeConflicts = new Set(['report_not_trashed', 'report_publishing', 'report_execution_active', 'report_purge_not_started']);

class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function serviceHeaders(key: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function isServerKey(key: string): boolean {
  if (key.startsWith('sb_publishable_')) return false;
  if (!key.startsWith('eyJ')) return true;
  try {
    const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).role === 'service_role';
  } catch { return false; }
}

function validObjectLocation(value: unknown, userId: string, taskId: string): value is { bucket: string; object_path: string } {
  if (!value || typeof value !== 'object') return false;
  const { bucket, object_path: objectPath } = value as { bucket?: unknown; object_path?: unknown };
  if (bucket !== 'analysis-reports' || typeof objectPath !== 'string' || objectPath.length > 1024) return false;
  const prefix = `${userId}/${taskId}/`;
  return objectPath.startsWith(prefix) && objectPath.slice(prefix.length).length > 0 &&
    !objectPath.includes('..') && !objectPath.includes('\\') && !objectPath.startsWith('/') && !objectPath.endsWith('/');
}

export async function handleReports(request: Request, env: Environment = process.env, fetcher: Fetcher = fetch): Promise<Response> {
  const started = Date.now();
  try {
    if (request.method !== 'DELETE') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    const authorization = request.headers.get('authorization') ?? '';
    if (!/^Bearer \S+$/i.test(authorization)) return json({ error: 'UNAUTHENTICATED' }, 401);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'INVALID_INPUT' }, 400);
    const raw = await request.text();
    if (raw.length > 2048) return json({ error: 'INVALID_INPUT' }, 400);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json({ error: 'INVALID_INPUT' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).join(',') !== 'report_id' ||
        !uuid.test((body as { report_id?: unknown }).report_id as string)) return json({ error: 'INVALID_INPUT' }, 400);
    const taskId = (body as { report_id: string }).report_id;
    const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: key } = env;
    if (!url || !key || !isServerKey(key)) throw new ApiError('NOT_CONFIGURED', 503);
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new ApiError('NOT_CONFIGURED', 503);
    }
    const base = parsed.origin;
    const signal = () => {
      const remaining = totalBudgetMs - (Date.now() - started);
      if (remaining <= 0) throw new ApiError('BACKEND_UNAVAILABLE', 503);
      return AbortSignal.timeout(Math.min(requestBudgetMs, remaining));
    };
    const call = async (path: string, init: RequestInit, userAuth = false, accessCheck = false): Promise<Response> => {
      let response: Response;
      try {
        response = await fetcher(`${base}${path}`, { ...init, redirect: 'error', signal: signal() });
      } catch { throw new ApiError('BACKEND_UNAVAILABLE', 503); }
      if (!response.ok) {
        if (userAuth && [401, 403].includes(response.status)) throw new ApiError('UNAUTHENTICATED', 401);
        if (accessCheck) {
          let message = '';
          try {
            const data = await response.json() as { message?: unknown };
            message = typeof data.message === 'string' ? data.message : '';
          } catch { /* upstream body is never surfaced */ }
          if (purgeForbidden.has(message)) throw new ApiError('FORBIDDEN', 403);
          if (purgeConflicts.has(message)) throw new ApiError('PURGE_CONFLICT', 409);
        }
        throw new ApiError('BACKEND_UNAVAILABLE', 503);
      }
      return response;
    };
    const authResponse = await call('/auth/v1/user', { method: 'GET', headers: { apikey: key, Authorization: authorization } }, true);
    let identity: unknown;
    try { identity = await authResponse.json(); } catch { throw new ApiError('UNAUTHENTICATED', 401); }
    const userId = (identity as { id?: unknown } | null)?.id;
    if (typeof userId !== 'string' || !uuid.test(userId)) throw new ApiError('UNAUTHENTICATED', 401);
    const rpcBody = JSON.stringify({ p_user_id: userId, p_task_id: taskId });
    const beginResponse = await call('/rest/v1/rpc/cloud_begin_report_purge', { method: 'POST', headers: serviceHeaders(key), body: rpcBody }, false, true);
    let begin: unknown;
    try { begin = await beginResponse.json(); } catch { throw new ApiError('BACKEND_UNAVAILABLE', 503); }
    if (Array.isArray(begin)) begin = begin[0];
    if (begin && typeof begin === 'object' && (begin as { purged?: unknown }).purged === true) return json({ purged: true });
    if (!validObjectLocation(begin, userId, taskId)) throw new ApiError('BACKEND_UNAVAILABLE', 503);
    const storageResponse = await fetcher(`${base}/storage/v1/object/${begin.bucket}`, {
      method: 'DELETE', headers: serviceHeaders(key), body: JSON.stringify({ prefixes: [begin.object_path] }), redirect: 'error', signal: signal(),
    }).catch(() => { throw new ApiError('BACKEND_UNAVAILABLE', 503); });
    // Storage's collection remove API succeeds for absent prefixes. Accept an explicit
    // not-found response too, so a retried purge can complete its database phase.
    if (!storageResponse.ok && storageResponse.status !== 404) throw new ApiError('BACKEND_UNAVAILABLE', 503);
    await call('/rest/v1/rpc/cloud_finish_report_purge', { method: 'POST', headers: serviceHeaders(key), body: rpcBody }, false, true);
    return json({ purged: true });
  } catch (error) {
    const known = error instanceof ApiError ? error : new ApiError('BACKEND_UNAVAILABLE', 503);
    return json({ error: known.code }, known.status);
  }
}
