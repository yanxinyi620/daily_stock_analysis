// @vitest-environment node
/** Real API -> PostgreSQL RPC contract. Only the remote HTTP transport is replaced. */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { handleTasks } from '../server/cloudTasks';

const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111';
const session = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const env = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test', SUPABASE_PUBLISH_USER_ID: owner, CLOUD_RUNNER_ID: 'local-primary' };
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,storage to anon,authenticated,service_role;
    create table storage.buckets(id text primary key,name text,public boolean);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security; grant all on storage.objects to anon,authenticated,service_role;
    insert into auth.users values ('${owner}');`);
  for (const name of ['202609140001_cloud_reports', '202609180001_cloud_runner', '202609180002_cloud_engine', '202609200001_cloud_market_review', '202609200002_cloud_composite']) {
    await db.exec(readFileSync(new URL(`../../../supabase/migrations/${name}.sql`, import.meta.url), 'utf8'));
  }
  await db.exec(`insert into app_members(user_id) values('${owner}')`);
}, 30000);
afterAll(() => db.close());
async function sqlRpc(name: string, params: Record<string, unknown>) {
  const keys = Object.keys(params);
  await db.exec('set role service_role');
  try {
    const result = await db.query<{ result: unknown }>(`select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(',')}) as result`, Object.values(params).map((v) => typeof v === 'object' && v !== null ? JSON.stringify(v) : v));
    return result.rows[0].result;
  } finally { await db.exec('reset role'); }
}
const fetcher: typeof fetch = async (url, init) => {
  const path = new URL(String(url)).pathname;
  if (path === '/auth/v1/user') return Response.json({ id: owner });
  if (path === '/rest/v1/app_members') return Response.json([{ enabled: true }]);
  const name = path.split('/').at(-1)!;
  if (!/^cloud_[a-z_]+$/.test(name)) throw new Error('unexpected route');
  try { return Response.json(await sqlRpc(name, JSON.parse(String(init?.body)))); }
  catch (error) { return Response.json({ message: (error as Error).message }, { status: 400 }); }
};
function submit(id = requestId) {
  return handleTasks(new Request('https://site.test/api/tasks', { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: id, task_type: 'stock_analysis', input: { stock_code: '000001' } }) }), env, fetcher);
}
function submitMarket(id = '55555555-5555-4555-8555-555555555555', region = 'cn') {
  return handleTasks(new Request('https://site.test/api/tasks', { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: id, task_type: 'market_review', input: { region } }) }), env, fetcher);
}
function submitComposite(id = '77777777-7777-4777-8777-777777777777', region = 'cn') {
  return handleTasks(new Request('https://site.test/api/tasks', { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: id, task_type: 'composite_analysis', input: { region } }) }), env, fetcher);
}
test('API offline/online/busy plus database output match the Python runner and browser fields', async () => {
  expect((await submit()).status).toBe(409);
  expect((await db.query('select * from execution_tasks')).rows).toHaveLength(0);
  const identity = { p_user_id: owner, p_runner_id: 'local-primary', p_session_id: session };
  await sqlRpc('cloud_runner_register', identity);
  const response = await submit(); expect(response.status).toBe(201);
  const task = await response.json() as { id: string; input_json: unknown; status: string };
  expect(task.input_json).toEqual({ stock_code: '000001' }); expect(task.status).toBe('pending');
  expect((await submit()).status).toBe(201); // Same request is idempotent even when busy.
  const busy = await submit('44444444-4444-4444-8444-444444444444');
  expect(busy.status).toBe(409); expect(await busy.json()).toEqual({ error: 'RUNNER_BUSY' });
  expect(await sqlRpc('cloud_claim_execution', identity)).toMatchObject({ id: task.id, input_json: { stock_code: '000001' }, status: 'running' });
  expect(await sqlRpc('cloud_claim_execution', identity)).toBeNull();
  expect(await sqlRpc('cloud_progress_execution', { ...identity, p_task_id: task.id, p_progress: 25, p_message: '正在分析' })).toMatchObject({ progress: 25, progress_message: '正在分析' });
  await sqlRpc('cloud_runner_stop', identity);
  expect((await db.query('select status from execution_tasks')).rows).toEqual([{ status: 'failed' }]);
});
test('API submits a market review with one region and preserves type in the execution task', async () => {
  await sqlRpc('cloud_runner_register', { p_user_id: owner, p_runner_id: 'local-primary', p_session_id: '66666666-6666-4666-8666-666666666666' });
  const response = await submitMarket();
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ task_type: 'market_review', input_json: { region: 'cn' }, status: 'pending' });
});
test('API creates composite input only from the configured owner watchlist', async () => {
  await db.exec(`update execution_tasks set status='failed', error_code='TEST_DONE', completed_at=now() where status in ('pending','running');
    insert into watchlists(user_id,market,code,name,position) values('${owner}','US','AAPL','Apple',3),('${owner}','CN','000001','Ping An',1)`);
  const response = await submitComposite();
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ task_type: 'composite_analysis', input_json: {
    region: 'cn', stock_codes: ['000001', 'AAPL'], watchlist_snapshot: [
      { market: 'CN', code: '000001', name: 'Ping An', position: 1 }, { market: 'US', code: 'AAPL', name: 'Apple', position: 3 },
    ],
  } });
});
