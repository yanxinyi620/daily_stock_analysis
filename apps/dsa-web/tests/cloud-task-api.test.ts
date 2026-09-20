// @vitest-environment node
import { expect, test, vi } from 'vitest';
import { handleTasks } from '../server/cloudTasks';

const owner = '11111111-1111-4111-8111-111111111111';
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'test-secret', SUPABASE_PUBLISH_USER_ID: owner, CLOUD_RUNNER_ID: 'local-primary' };
const request = (body: unknown, token = 'user-token') => new Request('https://site.example/api/tasks', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const input = { request_id: '22222222-2222-4222-8222-222222222222', task_type: 'stock_analysis', input: { stock_code: '000001' } };
const marketInput = { request_id: '33333333-3333-4333-8333-333333333333', task_type: 'market_review', input: { region: 'cn' } };
const compositeInput = { request_id: '44444444-4444-4444-8444-444444444444', task_type: 'composite_analysis', input: { region: 'cn' } };
function backend(error = '', user = owner) {
  return vi.fn(async (url: string | URL | Request) => {
    if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: user });
    if (String(url).includes('app_members')) return Response.json([{ enabled: true }]);
    return error ? Response.json({ message: error }, { status: 400 }) : Response.json({ id: input.request_id, status: 'pending' });
  });
}
test('missing authentication never contacts privileged backend', async () => {
  const fetcher = backend();
  const response = await handleTasks(new Request('https://site.example/api/tasks'), env, fetcher);
  expect(response.status).toBe(401); expect(fetcher).not.toHaveBeenCalled();
});
test('valid JWT belonging to another account cannot submit', async () => {
  const fetcher = backend('', '33333333-3333-4333-8333-333333333333');
  expect((await handleTasks(request(input), env, fetcher)).status).toBe(403);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test('offline atomic rejection returns a stable error without direct task inserts', async () => {
  const fetcher = backend('RUNNER_OFFLINE');
  const response = await handleTasks(request(input), env, fetcher);
  expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'RUNNER_OFFLINE' });
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
    `${env.SUPABASE_URL}/auth/v1/user`, `${env.SUPABASE_URL}/rest/v1/app_members?user_id=eq.${owner}&select=enabled`,
    `${env.SUPABASE_URL}/rest/v1/rpc/cloud_submit_execution`,
  ]);
});
test('caller cannot choose owner, runner, task type or arbitrary model parameters', async () => {
  for (const body of [
    { ...input, user_id: owner }, { ...input, task_type: 'ask' }, { ...input, input: { stock_code: 'x; drop table', model: 'x' } },
    { ...marketInput, input: { region: 'cn,us' } }, { ...marketInput, input: { region: ['cn'] } },
    { ...marketInput, input: { region: null } }, { ...marketInput, input: { region: 'CN' } },
    { ...marketInput, input: { region: 'cn', extra: true } }, { ...marketInput, input: { stock_code: '000001' } },
    { ...compositeInput, input: { region: 'cn', stock_codes: ['000001'] } }, { ...compositeInput, input: { region: 'cn', watchlist_snapshot: [] } },
  ]) {
    const fetcher = backend(); expect((await handleTasks(request(body), env, fetcher)).status).toBe(400);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/rpc/'))).toBe(false);
  }
});
test('composite analysis accepts only a singleton supported region', async () => {
  const fetcher = backend();
  expect((await handleTasks(request(compositeInput), env, fetcher)).status).toBe(201);
  const call = fetcher.mock.calls.at(-1)! as unknown as [string, RequestInit];
  expect(JSON.parse(String(call[1].body))).toMatchObject({ p_task_type: 'composite_analysis', p_input: { region: 'cn' } });
});
test('composite snapshot input errors are client errors', async () => {
  for (const error of ['EMPTY_WATCHLIST', 'SNAPSHOT_TOO_LARGE']) {
    const response = await handleTasks(request(compositeInput), env, backend(error));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
  }
});
test('market review accepts exactly one supported lower-case region', async () => {
  for (const region of ['cn', 'hk', 'us', 'jp', 'kr']) {
    const fetcher = backend();
    expect((await handleTasks(request({ ...marketInput, input: { region } }), env, fetcher)).status).toBe(201);
    const call = fetcher.mock.calls.at(-1)! as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toMatchObject({ p_task_type: 'market_review', p_input: { region } });
  }
});
test('owner and runner come from server configuration; JWT is not forwarded to privileged RPC', async () => {
  const fetcher = backend();
  const response = await handleTasks(request(input), env, fetcher);
  expect(response.status).toBe(201); expect(response.headers.get('Cache-Control')).toBe('no-store');
  const call = fetcher.mock.calls.at(-1)! as unknown as [string, RequestInit];
  expect(JSON.parse(String(call[1].body))).toEqual({ p_user_id: owner, p_runner_id: 'local-primary', p_request_id: input.request_id, p_task_type: 'stock_analysis', p_input: { stock_code: '000001' } });
  expect(JSON.stringify(call[1])).not.toContain('user-token');
});
test('unavailable backend never leaks response secrets or accepts an unverified token', async () => {
  const fetcher = vi.fn(async () => Response.json({ message: 'password=test-secret' }, { status: 503 }));
  const response = await handleTasks(request(input), env, fetcher);
  expect(response.status).toBe(503); expect(await response.text()).not.toContain('test-secret');
});
