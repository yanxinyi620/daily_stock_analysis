// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';

const db = new PGlite();
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const dailyRunner = 'github-actions-daily';
const session = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

async function rpc(sql: string) {
  await db.exec('set role service_role');
  try { return await db.query(sql); } finally { await db.exec('reset role'); }
}

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth, storage to anon, authenticated, service_role;
    create table storage.buckets(id text primary key, name text, public boolean);
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant all on storage.objects to anon, authenticated, service_role;
    insert into auth.users values ('${owner}'), ('${other}');
  `);
  for (const file of [
    '202609140001_cloud_reports.sql',
    '202609180001_cloud_runner.sql',
    '202609180002_cloud_engine.sql',
    '202609200001_cloud_market_review.sql',
    '202609200002_cloud_composite.sql',
    '202609200003_cloud_daily_actions.sql',
  ]) await db.exec(readFileSync(new URL(`../../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  await db.exec(`insert into public.app_members(user_id) values ('${owner}'), ('${other}');`);
});
afterAll(() => db.close());

test('daily submission atomically snapshots the owner watchlist and creates its independent session', async () => {
  await db.exec(`
    insert into watchlists(user_id, market, code, name, position)
      values ('${owner}', 'CN', '000001', '平安银行', 1), ('${owner}', 'HK', 'hk00700', 'Tencent', 2),
             ('${other}', 'US', 'MSFT', 'Microsoft', 0);
  `);
  const request = '11111111-1111-4111-8111-111111111111';
  const result = await rpc(`select cloud_submit_daily_execution('${owner}','${dailyRunner}','${request}','${session}','cn') as task`);
  const task = (result.rows[0] as { task: { id: string; task_type: string; session_id: string; input_json: unknown } }).task;
  expect(task).toMatchObject({ task_type: 'composite_analysis', session_id: session, input_json: {
    region: 'cn', stock_codes: ['000001', 'hk00700'], watchlist_snapshot: [
      { market: 'CN', code: '000001', name: '平安银行', position: 1 },
      { market: 'HK', code: 'hk00700', name: 'Tencent', position: 2 },
    ],
  } });
  expect((await db.query(`select session_id from runner_status where user_id='${owner}' and runner_id='${dailyRunner}'`)).rows)
    .toEqual([{ session_id: session }]);
});

test('daily retry deduplicates before changing the active session or resnapshotting', async () => {
  const request = '11111111-1111-4111-8111-111111111111';
  await db.exec(`delete from watchlists where user_id='${owner}' and code='000001';`);
  const retry = await rpc(`select cloud_submit_daily_execution('${owner}','${dailyRunner}','${request}','dddddddd-dddd-4ddd-8ddd-dddddddddddd','cn') as task`);
  expect((retry.rows[0] as { task: { session_id: string; input_json: unknown } }).task).toMatchObject({
    session_id: session,
    input_json: { stock_codes: ['000001', 'hk00700'] },
  });
  expect((await db.query(`select count(*)::integer as count from execution_tasks where runner_id='${dailyRunner}'`)).rows)
    .toEqual([{ count: 1 }]);
});

test('a second daily run cannot replace a live session and never writes a task', async () => {
  const before = (await db.query(`select count(*)::integer as count from execution_tasks where runner_id='${dailyRunner}'`)).rows;
  await expect(rpc(`select cloud_submit_daily_execution('${owner}','${dailyRunner}','22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','cn')`))
    .rejects.toThrow(/RUNNER_BUSY/i);
  expect((await db.query(`select count(*)::integer as count from execution_tasks where runner_id='${dailyRunner}'`)).rows).toEqual(before);
  expect((await db.query(`select session_id from runner_status where user_id='${owner}' and runner_id='${dailyRunner}'`)).rows)
    .toEqual([{ session_id: session }]);
});

test('daily submission preserves owner isolation and rejects empty watchlists', async () => {
  await db.exec(`delete from watchlists where user_id='${other}';`);
  await expect(rpc(`select cloud_submit_daily_execution('${other}','github-actions-other','33333333-3333-4333-8333-333333333333','ffffffff-ffff-4fff-8fff-ffffffffffff','cn')`))
    .rejects.toThrow(/EMPTY_WATCHLIST/i);
  await expect(rpc(`select cloud_submit_daily_execution('${owner}','${dailyRunner}','44444444-4444-4444-8444-444444444444','99999999-9999-4999-8999-999999999999','CN')`))
    .rejects.toThrow(/INVALID_INPUT/i);
});

test('expired daily retry fails the old task without taking a new session or snapshot', async () => {
  await db.exec(`update runner_status set online_until=now()-interval '1 minute' where runner_id='${dailyRunner}';`);
  const result = await rpc(`select cloud_submit_daily_execution('${owner}','${dailyRunner}','11111111-1111-4111-8111-111111111111','99999999-9999-4999-8999-999999999999','cn') as task`);
  expect((result.rows[0] as {task: unknown}).task).toMatchObject({status:'failed',session_id:session,input_json:{stock_codes:['000001','hk00700']}});
  expect((await db.query(`select session_id from runner_status where runner_id='${dailyRunner}'`)).rows).toEqual([{session_id:session}]);
});

test('a later daily request leaves the local runner session unchanged', async () => {
  await rpc(`select cloud_runner_register('${owner}','local-primary','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',60,30)`);
  await rpc(`select cloud_submit_daily_execution('${owner}','${dailyRunner}','55555555-5555-4555-8555-555555555555','99999999-9999-4999-8999-999999999999','cn')`);
  expect((await db.query(`select session_id from runner_status where runner_id='local-primary'`)).rows).toEqual([{session_id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}]);
});

test('browser roles cannot submit daily tasks or read another owner task', async () => {
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await expect(db.query(`select cloud_submit_daily_execution('${owner}','${dailyRunner}','66666666-6666-4666-8666-666666666666','99999999-9999-4999-8999-999999999999','cn')`)).rejects.toThrow(/permission denied/i);
    } finally { await db.exec('reset role'); }
  }
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${other}'`);
  try { expect((await db.query(`select id from execution_tasks where user_id='${owner}'`)).rows).toEqual([]); }
  finally { await db.exec('reset role'); }
});
