import { expect, test, vi } from 'vitest';
import { cloudData, createCloudClient, normalizeCloudCode } from '../client';
test('configuration fails closed and public env rejects server keys', () => {
  expect(() => createCloudClient({})).toThrow(/配置/);
  expect(() => createCloudClient({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_test' })).toThrow(/公开/);
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`;
  expect(() => createCloudClient({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: jwt })).toThrow(/公开/);
});
test('stock identifiers retain zeroes', () => {
  expect(normalizeCloudCode('CN', '000001')).toBe('000001');
  expect(normalizeCloudCode('HK', '00700')).toBe('hk00700');
  expect(normalizeCloudCode('US', 'brk.b')).toBe('BRK.B');
  expect(() => normalizeCloudCode('CN', '1')).toThrow();
});
test('records are paginated and owner-filtered, retaining failed tasks and joining index data', async () => {
  const page = {
    data: [{ id: 'task-1', status: 'publish_failed', updated_at: '2026-09-21T02:00:00Z', codes: ['600519'], analysis_reports: [
      { task_id: 'task-1', title: '贵州茅台', generated_at: '2026-09-21T02:00:00Z', market_as_of: null },
      { task_id: 'task-1', title: 'duplicate', generated_at: '2026-09-21T02:00:00Z', market_as_of: null },
    ] }], count: 4, error: null,
  };
  const active = { data: null, count: 1, error: null };
  const execution = { data: [{ id: 'exec-1', report_id: 'task-1', runner_id: 'runner-1', task_type: 'analysis', status: 'failed', result_summary: { outcome: 'failed', stock_failed: 1 } }], error: null };
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  let analysisCalls = 0;
  const from = vi.fn((table: string) => {
    analysisCalls += table === 'analysis_tasks' ? 1 : 0;
    const response = table === 'execution_tasks' ? execution : analysisCalls === 1 ? page : active;
    const builder = {} as Record<string, ReturnType<typeof vi.fn>>;
    builder.select = vi.fn((...args: unknown[]) => { calls.push({ table, method: 'select', args }); return builder; });
    for (const method of ['eq', 'in', 'order', 'is', 'not']) builder[method] = vi.fn((...args: unknown[]) => { calls.push({ table, method, args }); return builder; });
    builder.range = vi.fn((...args: unknown[]) => { calls.push({ table, method: 'range', args }); return response; });
    builder.then = vi.fn((resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve));
    return builder;
  });
  const result = await cloudData({ from } as never).records('user-a', 2, 20);
  expect(result).toMatchObject({ count: 4, active: true });
  expect(result.rows[0]).toMatchObject({ id: 'task-1', status: 'publish_failed', codes: ['600519'], report: page.data[0].analysis_reports[0], execution: execution.data[0] });
  expect(calls).toContainEqual({ table: 'analysis_tasks', method: 'range', args: [40, 59] });
  expect(calls.filter((c) => c.table === 'analysis_tasks' && c.method === 'is')).toHaveLength(4);
  expect(calls).toContainEqual({ table: 'analysis_tasks', method: 'is', args: ['deleted_at', null] });
  expect(calls.find((c) => c.method === 'select')?.args[0]).toContain('stock_name:results->0->>name');
  expect(calls).toContainEqual({ table: 'analysis_tasks', method: 'eq', args: ['user_id', 'user-a'] });
  expect(calls).toContainEqual({ table: 'execution_tasks', method: 'eq', args: ['user_id', 'user-a'] });
  expect(calls.find((call) => call.table === 'analysis_tasks' && call.method === 'select')?.args[0]).toMatch(/codes:input_snapshot->codes/);
  expect(calls.find((call) => call.table === 'analysis_tasks' && call.method === 'select')?.args[0]).not.toMatch(/markdown|,results[,)]/);
});
test('records skips execution query for an empty page and rejects execution errors', async () => {
  const makeQuery = (response: unknown) => {
    const builder = {} as Record<string, ReturnType<typeof vi.fn>>;
    builder.select = vi.fn().mockReturnValue(builder);
    for (const method of ['eq', 'in', 'order', 'is', 'not']) builder[method] = vi.fn().mockReturnValue(builder);
    builder.range = vi.fn().mockReturnValue(response);
    builder.then = vi.fn((resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve));
    return builder;
  };
  const emptyFrom = vi.fn((table: string) => makeQuery(table === 'analysis_tasks' ? { data: [], count: 0, error: null } : { data: null, error: null }));
  const empty = await cloudData({ from: emptyFrom } as never).records('user-a', 0, 20);
  expect(empty.rows).toEqual([]);
  expect(emptyFrom).not.toHaveBeenCalledWith('execution_tasks');

  let analysisCalls = 0;
  const failedExecutionFrom = vi.fn((table: string) => {
    if (table === 'analysis_tasks') {
      analysisCalls += 1;
      return makeQuery(analysisCalls === 1
        ? { data: [{ id: 'task-1', status: 'publishing', updated_at: 'now', codes: [], analysis_reports: null }], count: 1, error: null }
        : { data: null, count: 0, error: null });
    }
    return makeQuery({ data: null, error: new Error('execution failed') });
  });
  await expect(cloudData({ from: failedExecutionFrom } as never).records('user-a', 0, 1)).rejects.toThrow(/请求失败/);
});
test('one client owns the session across repeated component renders', async () => {
  const env = { VITE_SUPABASE_URL: 'https://singleton.example.test', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
  const first = createCloudClient(env);
  const second = createCloudClient(env);
  expect(second).toBe(first);
  await first.auth.stopAutoRefresh();
});

test('trash requests exclude active count and restore uses authenticated RPC without client owner input', async () => {
  const builder = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), not: vi.fn(), order: vi.fn(), range: vi.fn() };
  for (const key of ['select', 'eq', 'is', 'not', 'order'] as const) builder[key].mockReturnValue(builder);
  builder.range.mockResolvedValue({ data: [], error: null, count: 0 });
  const from = vi.fn().mockReturnValue(builder);
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const api = cloudData({ from, rpc } as never);
  expect(await api.records('owner', 0, 20, true)).toMatchObject({ rows: [], count: 0, active: false });
  expect(from).toHaveBeenCalledTimes(1);
  expect(builder.not).toHaveBeenCalledWith('deleted_at', 'is', null);
  await api.setRecordDeleted('record', false);
  expect(rpc).toHaveBeenCalledWith('cloud_set_report_deleted', { p_task_id: 'record', p_deleted: false });
  rpc.mockResolvedValue({ data: null, error: new Error('private denial') });
  await expect(api.setRecordDeleted('other', true)).rejects.toThrow(/请求失败/);
});

test('permanent deletion sends only the report ID with the current session token', async () => {
  const client = { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'session-token' } }, error: null }) } };
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
  try {
    await cloudData(client as never).permanentlyDeleteReport('id');
    expect(fetcher).toHaveBeenCalledWith('/api/reports', expect.objectContaining({ method: 'DELETE', headers: expect.objectContaining({ Authorization: 'Bearer session-token' }), body: JSON.stringify({ report_id: 'id' }) }));
    client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null } as never);
    await expect(cloudData(client as never).permanentlyDeleteReport('id')).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { fetcher.mockRestore(); }
});
