/** Controls only the daily workflow. No dispatch, cancellation or caller-selected target. */
import { ApiError, authorizeOwner, json, type Environment, type Fetcher } from './cloudAuth.js';

export async function handleSchedule(request: Request, env: Environment = process.env, fetcher: Fetcher = fetch): Promise<Response> {
  try {
    if (!['GET', 'PUT'].includes(request.method)) return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    await authorizeOwner(request, env, fetcher);
    const repository = env.CLOUD_ACTIONS_REPOSITORY ?? '';
    const token = env.CLOUD_ACTIONS_TOKEN;
    if (!token || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(repository)) throw new ApiError('NOT_CONFIGURED', 503);
    let enabled: boolean | undefined;
    if (request.method === 'PUT') {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json({ error: 'INVALID_INPUT' }, 400);
      const raw = await request.text();
      if (raw.length > 128) return json({ error: 'INVALID_INPUT' }, 400);
      let body;
      try { body = JSON.parse(raw); } catch { return json({ error: 'INVALID_INPUT' }, 400); }
      if (!body || Array.isArray(body) || Object.keys(body).join(',') !== 'enabled' || typeof body.enabled !== 'boolean') return json({ error: 'INVALID_INPUT' }, 400);
      enabled = body.enabled;
    }
    const target = `https://api.github.com/repos/${repository}/actions/workflows/00-daily-analysis.yml`;
    const github = async (action = '') => {
      const response = await fetcher(`${target}${action}`, {
        method: action ? 'PUT' : 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      });
      if (response.status !== (action ? 204 : 200)) throw new ApiError('GITHUB_UNAVAILABLE', 503);
      return response;
    };
    if (enabled !== undefined) await github(enabled ? '/enable' : '/disable');
    const body = await (await github()).json() as { state?: unknown };
    if (!['active', 'disabled_manually', 'disabled_inactivity'].includes(String(body?.state))) throw new ApiError('STATE_UNCONFIRMED', 503);
    const actual = body.state === 'active';
    if (enabled !== undefined && actual !== enabled) throw new ApiError('STATE_UNCONFIRMED', 503);
    return json({ enabled: actual });
  } catch (error) {
    return json({ error: error instanceof ApiError ? error.message : 'BACKEND_UNAVAILABLE' }, error instanceof ApiError ? error.status : 503);
  }
}
