// @vitest-environment node
import { expect, test, vi } from 'vitest';
import { handleSchedule } from '../server/cloudSchedule';
const owner = '11111111-1111-4111-8111-111111111111';
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'private-supabase', SUPABASE_PUBLISH_USER_ID: owner, CLOUD_ACTIONS_REPOSITORY: 'example/stocks', CLOUD_ACTIONS_TOKEN: 'private-github' };
const target = 'https://api.github.com/repos/example/stocks/actions/workflows/00-daily-analysis.yml';
const req = (body?: unknown) => new Request('https://site.example/api/schedule', { method: body === undefined ? 'GET' : 'PUT', headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
function backend({ user = owner, member = true, state = 'active', failure = 0, mismatch = false } = {}) {
  let current = state;
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: user });
    if (String(url).includes('app_members')) return Response.json([{ enabled: member }]);
    if (failure) return Response.json({ message: 'private-github private-supabase' }, { status: failure });
    if (init?.method === 'PUT') { if (!mismatch) current = String(url).endsWith('/enable') ? 'active' : 'disabled_manually'; return new Response(null, { status: 204 }); }
    return Response.json({ state: current, name: '每日股票分析' });
  });
}
test('missing JWT, other account and disabled member cannot contact GitHub', async () => {
  const absent = backend();
  expect((await handleSchedule(new Request('https://site.example/api/schedule'), env, absent)).status).toBe(401);
  expect(absent).not.toHaveBeenCalled();
  for (const options of [{ user: 'other' }, { member: false }]) {
    const fetcher = backend(options);
    expect((await handleSchedule(req({ enabled: false }), env, fetcher)).status).toBe(403);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('api.github.com'))).toBe(false);
  }
});
test.each([['active', true], ['disabled_manually', false], ['disabled_inactivity', false]])('reads GitHub state %s without mutation', async (state, enabled) => {
  const fetcher = backend({ state }); const response = await handleSchedule(req(), env, fetcher);
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ enabled });
  const [url, init] = fetcher.mock.calls.at(-1)!;
  expect(url).toBe(target); expect(init?.method).toBe('GET'); expect(init?.redirect).toBe('error'); expect(init?.signal).toBeDefined();
  expect(new Headers(init?.headers).get('authorization')).toBe('Bearer private-github');
});
test.each([true, false])('sets explicit enabled=%s and reads back actual state', async (enabled) => {
  const fetcher = backend(); const response = await handleSchedule(req({ enabled }), env, fetcher);
  expect(await response.json()).toEqual({ enabled });
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT').map(([url]) => url)).toEqual([`${target}/${enabled ? 'enable' : 'disable'}`]);
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe(target);
  expect(fetcher.mock.calls.some(([url]) => /dispatches|cancel|variables/.test(String(url)))).toBe(false);
});
test('mismatched readback is never reported as success', async () => {
  const response = await handleSchedule(req({ enabled: false }), env, backend({ mismatch: true }));
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'STATE_UNCONFIRMED' });
});
test.each([null, [], {}, { enabled: 'false' }, { enabled: false, repository: 'attacker/repo' }])('rejects invalid payload %j', async (body) => {
  const fetcher = backend(); expect((await handleSchedule(req(body), env, fetcher)).status).toBe(400);
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
});
test.each([401, 403, 404, 429, 500])('upstream %s is sanitized and no credential is returned', async (failure) => {
  const response = await handleSchedule(req(), env, backend({ failure }));
  expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/private-/);
});
test('unknown workflow state fails closed', async () => {
  expect((await handleSchedule(req(), env, backend({ state: 'deleted' }))).status).toBe(503);
});
test('missing or unsafe repository configuration cannot direct credentials elsewhere', async () => {
  for (const repository of ['', '../repo', 'https://evil.test/repo', 'a/b/c', 'a/..']) {
    const fetcher = backend();
    expect((await handleSchedule(req(), { ...env, CLOUD_ACTIONS_REPOSITORY: repository }, fetcher)).status).toBe(503);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('api.github.com'))).toBe(false);
  }
});
test('network failure returns stable error', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('private-github'));
  const response = await handleSchedule(req(), env, fetcher);
  expect(response.status).toBe(503); expect(await response.text()).not.toContain('private-github');
});
test('unsupported method has no side effect', async () => {
  const fetcher = backend(); expect((await handleSchedule(new Request('https://site.example/api/schedule', { method: 'DELETE' }), env, fetcher)).status).toBe(405);
  expect(fetcher).not.toHaveBeenCalled();
});
test('expired JWT stops before member and GitHub reads', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ message: 'expired' }, { status: 401 }));
  expect((await handleSchedule(req({ enabled: false }), env, fetcher)).status).toBe(401);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test('malformed JSON, wrong content type and oversized payload never mutate GitHub', async () => {
  for (const [contentType, body] of [['application/json', '{'], ['text/plain', '{"enabled":false}'], ['application/json', ' '.repeat(129)]]) {
    const fetcher = backend();
    const request = new Request('https://site.example/api/schedule', { method: 'PUT', headers: { authorization: 'Bearer user-token', 'content-type': contentType }, body });
    expect((await handleSchedule(request, env, fetcher)).status).toBe(400);
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  }
});
test('successful PUT followed by failed read does not claim confirmed success', async () => {
  const fetcher = backend(); fetcher.mockImplementationOnce(async () => Response.json({ id: owner })).mockImplementationOnce(async () => Response.json([{ enabled: true }])).mockImplementationOnce(async () => new Response(null, { status: 204 })).mockImplementationOnce(async () => { throw new Error('timeout'); });
  expect((await handleSchedule(req({ enabled: false }), env, fetcher)).status).toBe(503);
});
test('deployment routes the schedule API before the generic API denial', async () => {
  const { readFileSync } = await import('node:fs');
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  for (const path of ['/api/tasks', '/api/reports', '/api/schedule']) {
    const match = config.routes.find((route: { src?: string }) => route.src && new RegExp(`^${route.src}$`).test(path));
    expect(match).toMatchObject({ dest: path });
  }
  const unknown = config.routes.find((route: { src?: string }) => route.src && new RegExp(`^${route.src}$`).test('/api/unknown'));
  expect(unknown.status).toBe(404);
});
