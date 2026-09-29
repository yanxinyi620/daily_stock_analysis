/** Shared trusted owner boundary; never imported into browser code. */
export type Environment = Record<string, string | undefined>;
export type Fetcher = typeof fetch;
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function authorizeOwner(request: Request, env: Environment, fetcher: Fetcher, errors: Record<string, number> = {}) {
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer \S+$/i.test(authorization)) throw new ApiError('UNAUTHENTICATED', 401);
  const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: key, SUPABASE_PUBLISH_USER_ID: owner } = env;
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
  if (user?.id !== owner) throw new ApiError('FORBIDDEN', 403);
  const members = await call(`/rest/v1/app_members?user_id=eq.${owner}&select=enabled`);
  if (!Array.isArray(members) || members[0]?.enabled !== true) throw new ApiError('FORBIDDEN', 403);
  return { owner, call };
}
