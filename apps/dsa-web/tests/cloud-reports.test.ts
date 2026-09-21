// @vitest-environment node
import { expect, test, vi } from 'vitest';
import { handleReports } from '../server/cloudReports';

const user = '11111111-1111-4111-8111-111111111111';
const report = '22222222-2222-4222-8222-222222222222';
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'test-secret' };
const request = (body: unknown = { report_id: report }, token = 'user-token') => new Request('https://site.example/api/reports', {
  method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
function backend(options: { begin?: unknown; storageStatus?: number; finishStatus?: number; authUser?: unknown } = {}) {
  return vi.fn(async (url: string | URL | Request) => {
    const path = String(url);
    if (path.endsWith('/auth/v1/user')) return Response.json(options.authUser === undefined ? { id: user } : options.authUser);
    if (path.endsWith('/rpc/cloud_begin_report_purge')) return Response.json(options.begin ?? { purged: false, bucket: 'analysis-reports', object_path: `${user}/${report}/report.md` });
    if (path.includes('/storage/v1/object/')) return Response.json({}, { status: options.storageStatus ?? 200 });
    if (path.endsWith('/rpc/cloud_finish_report_purge')) return Response.json({}, { status: options.finishStatus ?? 200 });
    throw new Error(`Unexpected request: ${path}`);
  });
}

test('permanently deletes only the server-authorized report object and then finishes the purge', async () => {
  const fetcher = backend();
  const response = await handleReports(request(), env, fetcher);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ purged: true });
  const calls = fetcher.mock.calls as unknown as Array<[string, RequestInit]>;
  expect(calls.map(([url]) => url)).toEqual([
    `${env.SUPABASE_URL}/auth/v1/user`, `${env.SUPABASE_URL}/rest/v1/rpc/cloud_begin_report_purge`,
    `${env.SUPABASE_URL}/storage/v1/object/analysis-reports`, `${env.SUPABASE_URL}/rest/v1/rpc/cloud_finish_report_purge`,
  ]);
  expect(JSON.parse(String(calls[1][1].body))).toEqual({ p_user_id: user, p_task_id: report });
  expect(JSON.parse(String(calls[2][1].body))).toEqual({ prefixes: [`${user}/${report}/report.md`] });
  expect(JSON.parse(String(calls[3][1].body))).toEqual({ p_user_id: user, p_task_id: report });
  expect(calls.slice(1).every(([, init]) => init.headers?.Authorization !== 'Bearer user-token')).toBe(true);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});

test('already purged reports return success without repeating storage or finish calls', async () => {
  const fetcher = backend({ begin: { purged: true } });
  const response = await handleReports(request(), env, fetcher);
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ purged: true });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('storage failure leaves the database purge unfinished for a safe retry', async () => {
  const fetcher = backend({ storageStatus: 500 });
  const response = await handleReports(request(), env, fetcher);
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'BACKEND_UNAVAILABLE' });
  expect(fetcher.mock.calls.map(([url]) => String(url))).not.toContain(`${env.SUPABASE_URL}/rest/v1/rpc/cloud_finish_report_purge`);
});

test('a retry tolerates an already absent object and finishes the database purge', async () => {
  const fetcher = backend({ storageStatus: 404 });
  expect((await handleReports(request(), env, fetcher)).status).toBe(200);
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe(`${env.SUPABASE_URL}/rest/v1/rpc/cloud_finish_report_purge`);
});

test('database ownership and membership rejections are forbidden without exposing backend details', async () => {
  for (const message of ['member_inactive', 'report_not_owned']) {
    const fetcher = backend({ begin: undefined });
    fetcher.mockImplementation(async (url: string | URL | Request) => String(url).endsWith('/auth/v1/user')
      ? Response.json({ id: user }) : Response.json({ message }, { status: 403 }));
    const response = await handleReports(request(), env, fetcher);
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: 'FORBIDDEN' });
  }
});

test('database report state conflicts are stable client conflicts at begin and finish', async () => {
  for (const failedAt of [2, 4]) {
    const fetcher = vi.fn(async () => {
      const call = fetcher.mock.calls.length;
      if (call === 1) return Response.json({ id: user });
      if (call === failedAt) return Response.json({ message: 'report_not_trashed' }, { status: 400 });
      if (call === 2) return Response.json({ purged: false, bucket: 'analysis-reports', object_path: `${user}/${report}/report.md` });
      return Response.json({});
    });
    const response = await handleReports(request(), env, fetcher);
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'PURGE_CONFLICT' });
  }
});

test('an invalid service credential stays a sanitized server failure', async () => {
  const fetcher = backend();
  fetcher.mockImplementation(async (url: string | URL | Request) => String(url).endsWith('/auth/v1/user')
    ? Response.json({ id: user }) : Response.json({ message: 'Invalid API key: private' }, { status: 401 }));
  const response = await handleReports(request(), env, fetcher);
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'BACKEND_UNAVAILABLE' });
});

test('rejects malformed input before calling Supabase', async () => {
  for (const body of [null, {}, { report_id: report, user_id: user }, { report_id: 'not-a-uuid' }, { report_id: report, path: '../x' }]) {
    const fetcher = backend();
    const response = await handleReports(request(body), env, fetcher);
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'INVALID_INPUT' });
    expect(fetcher).not.toHaveBeenCalled();
  }
});

test('requires a verified bearer identity and fails closed for bad configuration', async () => {
  const unauthenticated = backend({ authUser: { id: 'not-a-uuid' } });
  expect((await handleReports(request())).headers.get('Cache-Control')).toBe('no-store');
  expect((await handleReports(new Request('https://site.example/api/reports', { method: 'DELETE' }), env, unauthenticated)).status).toBe(401);
  const denied = backend(); denied.mockResolvedValue(Response.json({ message: 'token secret' }, { status: 401 }));
  const response = await handleReports(request(), env, denied);
  expect(response.status).toBe(401); expect(await response.text()).not.toContain('secret');
  expect((await handleReports(request(), { SUPABASE_URL: 'http://bad.example', SUPABASE_SECRET_KEY: 'key' }, backend())).status).toBe(503);
  expect((await handleReports(request(), { SUPABASE_URL: env.SUPABASE_URL }, backend())).status).toBe(503);
  expect((await handleReports(request(), { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SECRET_KEY: 'sb_publishable_public' }, backend())).status).toBe(503);
});

test('rejects unsafe locations returned by the privileged RPC', async () => {
  for (const begin of [
    { purged: false, bucket: 'other', object_path: `${user}/${report}/a.md` },
    { purged: false, bucket: 'analysis-reports', object_path: `${user}/other/a.md` },
    { purged: false, bucket: 'analysis-reports', object_path: `${user}/${report}/../a.md` },
  ]) {
    const fetcher = backend({ begin });
    expect((await handleReports(request(), env, fetcher)).status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(2);
  }
});

test('every upstream call has an eight-second or smaller abort budget', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => new AbortController().signal);
  const fetcher = backend();
  try {
    expect((await handleReports(request(), env, fetcher)).status).toBe(200);
    expect(timeout.mock.calls).toHaveLength(4);
    expect(timeout.mock.calls.every(([milliseconds]) => typeof milliseconds === 'number' && milliseconds > 0 && milliseconds <= 8_000)).toBe(true);
  } finally { timeout.mockRestore(); }
});

test('each failed upstream stage returns the same sanitized, retryable error', async () => {
  for (const failedAt of [1, 2, 3, 4]) {
    let call = 0;
    const fetcher = vi.fn(async () => {
      call += 1;
      if (call === failedAt) return Response.json({ message: 'credential=private' }, { status: 500 });
      if (call === 1) return Response.json({ id: user });
      if (call === 2) return Response.json({ purged: false, bucket: 'analysis-reports', object_path: `${user}/${report}/report.md` });
      return Response.json({});
    });
    const response = await handleReports(request(), env, fetcher);
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'BACKEND_UNAVAILABLE' });
  }
});
