// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';

const db = new PGlite();
const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const runner = 'desktop-1';
const session = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const replacement = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const request = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const reportTask = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

async function asUser(user: string, sql: string) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await db.query(sql); } finally { await db.exec('reset role'); }
}
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
    insert into auth.users values ('${a}'), ('${b}');
  `);
  await db.exec(readFileSync(new URL('../../../supabase/migrations/202609140001_cloud_reports.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../../../supabase/migrations/202609180001_cloud_runner.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../../../supabase/migrations/202609180002_cloud_engine.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../../../supabase/migrations/202609200001_cloud_market_review.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../../../supabase/migrations/202609200002_cloud_composite.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into public.app_members(user_id) values ('${a}'), ('${b}');`);
}, 30000);
afterAll(() => db.close());

test('only service role can invoke runner RPCs and members only read their own rows', async () => {
  await expect(asUser(a, `select cloud_runner_register('${a}','${runner}','${session}',60,30)`)).rejects.toThrow();
  await rpc(`select cloud_runner_register('${a}','${runner}','${session}',60,30)`);
  expect((await asUser(a, 'select runner_id from runner_status')).rows).toEqual([{ runner_id: runner }]);
  expect((await asUser(b, 'select * from runner_status')).rows).toEqual([]);
  await expect(asUser(a, `insert into runner_status(user_id,runner_id) values ('${a}','nope')`)).rejects.toThrow();
  await db.exec('set role anon');
  try { await expect(db.query('select * from execution_tasks')).rejects.toThrow(); } finally { await db.exec('reset role'); }
});

test('offline submit creates no row and requests are owner/input idempotent', async () => {
  const offlineRequest = '11111111-1111-4111-8111-111111111111';
  await expect(rpc(`select cloud_submit_execution('${a}','missing','${offlineRequest}','stock_analysis','{"stock_code":"000001"}')`)).rejects.toThrow(/RUNNER_OFFLINE/i);
  expect((await db.query(`select * from execution_tasks where request_id='${offlineRequest}'`)).rows).toEqual([]);
  const result = await rpc(`select cloud_submit_execution('${a}','${runner}','${request}','stock_analysis','{"stock_code":"000001"}') as task`);
  const first = (result.rows[0] as { task: { id: string } }).task;
  expect((await rpc(`select cloud_runner_snapshot('${a}','${runner}') as state`)).rows[0]).toMatchObject({ state: { busy: true } });
  await expect(rpc(`select cloud_submit_execution('${a}','${runner}','11111111-1111-4111-8111-111111111113','stock_analysis','{"stock_code":"000002"}')`)).rejects.toThrow(/RUNNER_BUSY/i);
  const again = await rpc(`select cloud_submit_execution('${a}','${runner}','${request}','stock_analysis','{"stock_code":"000001"}') as task`);
  expect((again.rows[0] as { task: { id: string } }).task.id).toBe(first.id);
  await expect(rpc(`select cloud_submit_execution('${a}','${runner}','${request}','stock_analysis','{}')`)).rejects.toThrow();
  await expect(rpc(`select cloud_submit_execution('${a}','${runner}','11111111-1111-4111-8111-111111111112','other','{}')`)).rejects.toThrow();
});

test('market review accepts a singleton region and rejects invalid or cross-type idempotency inputs without writes', async () => {
  const marketRequest = '12121212-1212-4212-8212-121212121212';
  await rpc(`select cloud_runner_register('${b}','desktop-market','45454545-4545-4454-8454-454545454545',60,30)`);
  const beforeOffline = (await db.query(`select count(*)::integer as count from execution_tasks`)).rows;
  await expect(rpc(`select cloud_submit_execution('${b}','missing','${marketRequest}','market_review','{"region":"cn"}')`)).rejects.toThrow(/RUNNER_OFFLINE/i);
  expect((await db.query(`select count(*)::integer as count from execution_tasks`)).rows).toEqual(beforeOffline);
  const regions = ['cn', 'hk', 'us', 'jp', 'kr'];
  for (const [index, region] of regions.entries()) {
    const id = `12121212-1212-4212-8212-12121212121${index}`;
    const result = await rpc(`select cloud_submit_execution('${b}','desktop-market','${id}','market_review','{"region":"${region}"}') as task`);
    expect((result.rows[0] as { task: { task_type: string; input_json: unknown } }).task).toMatchObject({ task_type: 'market_review', input_json: { region } });
    await db.exec(`update execution_tasks set status='failed', error_code='TEST_DONE', completed_at=now() where request_id='${id}'`);
  }
  const validId = '13131313-1313-4313-8313-131313131313';
  const valid = await rpc(`select cloud_submit_execution('${b}','desktop-market','${validId}','market_review','{"region":"cn"}') as task`);
  const taskId = (valid.rows[0] as { task: { id: string } }).task.id;
  await expect(rpc(`select cloud_submit_execution('${b}','desktop-market','${validId}','stock_analysis','{"stock_code":"000001"}')`)).rejects.toThrow(/IDEMPOTENCY_CONFLICT/i);
  for (const payload of ['{}', '{"region":"cn,us"}', '{"region":"CN"}', '{"region":["cn"]}', '{"region":null}', '{"region":"cn","extra":true}', '{"stock_code":"000001"}']) {
    await expect(rpc(`select cloud_submit_execution('${b}','desktop-market','24242424-2424-4242-8242-242424242424','market_review','${payload}')`)).rejects.toThrow(/INVALID_INPUT/i);
  }
  const beforeBusy = (await db.query(`select id,status from execution_tasks where user_id='${b}' order by id`)).rows;
  await expect(rpc(`select cloud_submit_execution('${b}','desktop-market','34343434-3434-4342-8342-343434343434','market_review','{"region":"hk"}')`)).rejects.toThrow(/RUNNER_BUSY/i);
  expect((await db.query(`select id,status from execution_tasks where user_id='${b}' order by id`)).rows).toEqual(beforeBusy);
  expect((await db.query(`select id from execution_tasks where id='${taskId}'`)).rows).toEqual([{ id: taskId }]);
});

test('a runner has one claim, a stale session cannot revive, and restart fails old work', async () => {
  const claimed = await rpc(`select cloud_claim_execution('${a}','${runner}','${session}') as task`);
  const task = (claimed.rows[0] as { task: { id: string } }).task;
  expect(task).toBeTruthy();
  await rpc(`select cloud_runner_register('${a}','${runner}','${session}',60,30)`);
  expect((await db.query(`select status,session_id from execution_tasks where id='${task.id}'`)).rows).toEqual([{ status: 'running', session_id: session }]);
  await db.exec(`update execution_tasks set claim_deadline=now()-interval '1 second' where id='${task.id}'`);
  await rpc(`select cloud_runner_heartbeat('${a}','${runner}','${session}')`);
  expect((await db.query(`select status from execution_tasks where id='${task.id}'`)).rows).toEqual([{ status: 'running' }]);
  expect((await rpc(`select cloud_claim_execution('${a}','${runner}','${session}') as task`)).rows[0]).toEqual({ task: null });
  await expect(rpc(`select cloud_runner_register('${a}','${runner}','${replacement}',60,30)`)).rejects.toThrow(/RUNNER_BUSY/i);
  await db.exec(`update runner_status set online_until=now()-interval '1 second' where user_id='${a}' and runner_id='${runner}'`);
  await expect(rpc(`select cloud_runner_heartbeat('${a}','${runner}','${session}')`)).rejects.toThrow(/RUNNER_STALE/i);
  await expect(rpc(`select cloud_runner_register('${a}','${runner}','${session}',60,30)`)).rejects.toThrow(/RUNNER_STALE/i);
  await rpc(`select cloud_runner_register('${a}','${runner}','${replacement}',60,30)`);
  expect((await db.query(`select status from execution_tasks where id='${task.id}'`)).rows).toEqual([{ status: 'failed' }]);
});

test('late completion cannot overwrite failure; successful completion needs a matching old report', async () => {
  const request2 = '22222222-2222-4222-8222-222222222222';
  const submitted = await rpc(`select cloud_submit_execution('${a}','${runner}','${request2}','stock_analysis','{"stock_code":"000001"}') as task`);
  const id = (submitted.rows[0] as { task: { id: string } }).task.id;
  await rpc(`select cloud_claim_execution('${a}','${runner}','${replacement}')`);
  await rpc(`select cloud_finish_execution('${a}','${runner}','${replacement}','${id}',null,'RUN_FAILED')`);
  expect((await rpc(`select cloud_finish_execution('${a}','${runner}','${replacement}','${id}',null,'RUN_FAILED') as task`)).rows[0]).toMatchObject({ task: { status: 'failed', error_code: 'RUN_FAILED' } });
  await expect(rpc(`select cloud_finish_execution('${a}','${runner}','${replacement}','${id}',null,null)`)).rejects.toThrow();
  const otherReportTask = '12121212-1212-4212-8212-121212121212';
  await db.exec(`insert into analysis_tasks(id,user_id,content_hash,input_snapshot,status) values ('${otherReportTask}','${b}','${'b'.repeat(64)}','{}','succeeded')`);
  await db.exec(`insert into analysis_reports(task_id,user_id,title,markdown,results,object_path) values ('${otherReportTask}','${b}','x','x','[]','${b}/${otherReportTask}/r.md')`);
  await db.exec(`insert into analysis_tasks(id,user_id,content_hash,input_snapshot,status) values ('${reportTask}','${a}','${'a'.repeat(64)}','{}','succeeded')`);
  await db.exec(`insert into analysis_reports(task_id,user_id,title,markdown,results,object_path) values ('${reportTask}','${a}','x','x','[]','${a}/${reportTask}/r.md')`);
  const request3 = '33333333-3333-4333-8333-333333333333';
  const next = await rpc(`select cloud_submit_execution('${a}','${runner}','${request3}','stock_analysis','{"stock_code":"000001"}') as task`);
  const nextId = (next.rows[0] as { task: { id: string } }).task.id;
  await rpc(`select cloud_claim_execution('${a}','${runner}','${replacement}')`);
  await expect(rpc(`select cloud_finish_execution('${a}','${runner}','${replacement}','${nextId}','${otherReportTask}',null)`)).rejects.toThrow(/REPORT_NOT_OWNED/i);
  await rpc(`select cloud_finish_execution('${a}','${runner}','${replacement}','${nextId}','${reportTask}',null)`);
  expect((await rpc(`select cloud_finish_execution('${a}','${runner}','${replacement}','${nextId}','${reportTask}',null) as task`)).rows[0]).toMatchObject({ task: { status: 'succeeded', report_id: reportTask } });
  expect((await db.query(`select status, report_id from execution_tasks where id='${nextId}'`)).rows).toEqual([{ status: 'succeeded', report_id: reportTask }]);
  const terminalBefore = (await db.query(`select id,status,report_id,progress,completed_at,error_code from execution_tasks where id in ('${id}','${nextId}') order by id`)).rows;
  await rpc(`select cloud_runner_stop('${a}','${runner}','${replacement}')`);
  await rpc(`select cloud_runner_register('${a}','${runner}','98989898-9898-4989-8989-989898989898',60,30)`);
  expect((await db.query(`select id,status,report_id,progress,completed_at,error_code from execution_tasks where id in ('${id}','${nextId}') order by id`)).rows).toEqual(terminalBefore);
});

test('expired pending work is bound to its session and invalid input has stable error codes', async () => {
  const runnerB = 'desktop-b';
  const sessionB = '45454545-4545-4454-8454-454545454545';
  const sessionB2 = '56565656-5656-4656-8656-565656565656';
  const pending = '67676767-6767-4767-8767-676767676767';
  await expect(rpc(`select cloud_runner_register('${b}','${runnerB}',null,60,30)`)).rejects.toThrow(/INVALID_INPUT/i);
  await expect(rpc(`select cloud_submit_execution('${b}','${runnerB}','${pending}',null,'[]')`)).rejects.toThrow(/INVALID_INPUT/i);
  await rpc(`select cloud_runner_register('${b}','${runnerB}','${sessionB}',60,30)`);
  const submitted = await rpc(`select cloud_submit_execution('${b}','${runnerB}','${pending}','stock_analysis','{"stock_code":"000001"}') as task`);
  expect((submitted.rows[0] as { task: { session_id: string } }).task.session_id).toBe(sessionB);
  await db.exec(`update runner_status set online_until=now()-interval '1 second' where user_id='${b}' and runner_id='${runnerB}'`);
  await rpc(`select cloud_runner_register('${b}','${runnerB}','${sessionB2}',60,30)`);
  expect((await db.query(`select status from execution_tasks where request_id='${pending}'`)).rows).toEqual([{ status: 'failed' }]);
  const expiredClaim = '78787878-7878-4787-8787-787878787878';
  const queued = await rpc(`select cloud_submit_execution('${b}','${runnerB}','${expiredClaim}','stock_analysis','{"stock_code":"000002"}') as task`);
  const queuedId = (queued.rows[0] as { task: { id: string } }).task.id;
  await db.exec(`update execution_tasks set claim_deadline=now()-interval '1 second' where id='${queuedId}'`);
  expect((await rpc(`select cloud_claim_execution('${b}','${runnerB}','${sessionB2}') as task`)).rows).toEqual([{ task: null }]);
  expect((await db.query(`select status from execution_tasks where id='${queuedId}'`)).rows).toEqual([{ status: 'failed' }]);
  const stateBeforeInvalidCalls = (await db.query(`select session_id,online_until,last_seen_at,current_task_id from runner_status where user_id='${b}' and runner_id='${runnerB}'`)).rows;
  for (const sql of [
    `select cloud_runner_heartbeat('${b}','${runnerB}',null)`,
    `select cloud_runner_stop('${b}','${runnerB}',null)`,
    `select cloud_claim_execution('${b}','${runnerB}',null)`,
    `select cloud_progress_execution('${b}','${runnerB}',null,null,0,'')`,
    `select cloud_finish_execution('${b}','${runnerB}',null,null,null,'FAIL')`,
    `select cloud_submit_execution('${b}','${runnerB}',null,'stock_analysis','{"stock_code":"000001"}')`,
  ]) await expect(rpc(sql)).rejects.toThrow(/INVALID_INPUT/i);
  expect((await db.query(`select session_id,online_until,last_seen_at,current_task_id from runner_status where user_id='${b}' and runner_id='${runnerB}'`)).rows).toEqual(stateBeforeInvalidCalls);
});

test('combined completion cannot publish stale work and atomically commits a live report', async () => {
  const liveSession = '98989898-9898-4989-8989-989898989898';
  const staleSession = 'abababab-abab-4bab-8bab-abababababab';
  const staleRequest = '90909090-9090-4090-8090-909090909090';
  const stalePublish = '91919191-9191-4191-8191-919191919191';
  const liveRequest = '92929292-9292-4292-8292-929292929292';
  const livePublish = '93939393-9393-4393-8393-939393939393';
  const hash = 'c'.repeat(64);
  const payload = JSON.stringify({ title: 'runner', markdown: '# runner', results: [], generated_at: '2026-09-18T00:00:00Z', market_as_of: null });
  const staleExecution = await rpc(`select cloud_submit_execution('${a}','${runner}','${staleRequest}','stock_analysis','{"stock_code":"000001"}') as task`);
  const staleId = (staleExecution.rows[0] as { task: { id: string } }).task.id;
  await rpc(`select cloud_claim_execution('${a}','${runner}','${liveSession}')`);
  await rpc(`select cloud_begin_publish('${stalePublish}','${a}','${hash}','{}')`);
  const stalePath = `${a}/${stalePublish}/${hash}.md`;
  await db.exec(`insert into storage.objects(bucket_id,name) values ('analysis-reports','${stalePath}')`);
  const reportsBefore = (await db.query(`select count(*)::integer as count from analysis_reports where task_id='${stalePublish}'`)).rows;
  await db.exec(`update runner_status set online_until=now()-interval '1 second' where user_id='${a}' and runner_id='${runner}'`);
  await rpc(`select cloud_runner_register('${a}','${runner}','${staleSession}',60,30)`);
  await expect(rpc(`select cloud_complete_runner_publish('${a}','${runner}','${liveSession}','${staleId}','${stalePublish}','${hash}','${payload}','${stalePath}')`)).rejects.toThrow(/TASK_NOT_OWNED/i);
  expect((await db.query(`select count(*)::integer as count from analysis_reports where task_id='${stalePublish}'`)).rows).toEqual(reportsBefore);
  const liveExecution = await rpc(`select cloud_submit_execution('${a}','${runner}','${liveRequest}','stock_analysis','{"stock_code":"000002"}') as task`);
  const liveId = (liveExecution.rows[0] as { task: { id: string } }).task.id;
  await rpc(`select cloud_claim_execution('${a}','${runner}','${staleSession}')`);
  await rpc(`select cloud_begin_publish('${livePublish}','${a}','${hash}','{}')`);
  const livePath = `${a}/${livePublish}/${hash}.md`;
  await db.exec(`insert into storage.objects(bucket_id,name) values ('analysis-reports','${livePath}')`);
  expect((await rpc(`select cloud_complete_runner_publish('${a}','${runner}','${staleSession}','${liveId}','${livePublish}','${hash}','${payload}','${livePath}')`)).rows).toEqual([{ cloud_complete_runner_publish: 'succeeded' }]);
  expect((await db.query(`select status,report_id from execution_tasks where id='${liveId}'`)).rows).toEqual([{ status: 'succeeded', report_id: livePublish }]);
  expect((await db.query(`select status from analysis_tasks where id='${livePublish}'`)).rows).toEqual([{ status: 'succeeded' }]);
});

test('composite submissions snapshot only the owner and publish one validated immutable summary', async () => {
  const compositeRunner = 'desktop-composite';
  const compositeSession = '10101010-1010-4010-8010-101010101010';
  const offlineRequest = '20202020-2020-4020-8020-202020202020';
  const emptyRequest = '30303030-3030-4030-8030-303030303030';
  const requestId = '40404040-4040-4040-8040-404040404040';
  const publishId = '50505050-5050-4050-8050-505050505050';
  const hash = 'd'.repeat(64);
  await rpc(`select cloud_runner_register('${b}','${compositeRunner}','${compositeSession}',60,30)`);
  const before = (await db.query(`select count(*)::integer as count from execution_tasks where request_id in ('${offlineRequest}','${emptyRequest}')`)).rows;
  await expect(rpc(`select cloud_submit_execution('${b}','missing','${offlineRequest}','composite_analysis','{"region":"cn"}')`)).rejects.toThrow(/RUNNER_OFFLINE/i);
  await expect(rpc(`select cloud_submit_execution('${b}','${compositeRunner}','${emptyRequest}','composite_analysis','{"region":"cn"}')`)).rejects.toThrow(/EMPTY_WATCHLIST/i);
  expect((await db.query(`select count(*)::integer as count from execution_tasks where request_id in ('${offlineRequest}','${emptyRequest}')`)).rows).toEqual(before);
  await db.exec(`insert into watchlists(user_id,market,code,name,position) values ('${a}','CN','000001','Other owner',0), ('${b}','US','MSFT','Microsoft',2), ('${b}','CN','000001','Ping An',1)`);
  await expect(rpc(`select cloud_submit_execution('${b}','${compositeRunner}','60606060-6060-4060-8060-606060606060','composite_analysis','{"region":"cn;drop table watchlists"}')`)).rejects.toThrow(/INVALID_INPUT/i);
  const created = await rpc(`select cloud_submit_execution('${b}','${compositeRunner}','${requestId}','composite_analysis','{"region":"cn"}') as task`);
  const task = (created.rows[0] as { task: { id: string; input_json: unknown } }).task;
  expect(task.input_json).toEqual({ region: 'cn', stock_codes: ['000001', 'MSFT'], watchlist_snapshot: [
    { market: 'CN', code: '000001', name: 'Ping An', position: 1 }, { market: 'US', code: 'MSFT', name: 'Microsoft', position: 2 },
  ] });
  await db.exec(`delete from watchlists where user_id='${b}'`);
  const retry = await rpc(`select cloud_submit_execution('${b}','${compositeRunner}','${requestId}','composite_analysis','{"region":"cn"}') as task`);
  expect((retry.rows[0] as { task: { id: string; input_json: unknown } }).task).toEqual(task);
  await expect(rpc(`select cloud_submit_execution('${b}','${compositeRunner}','${requestId}','composite_analysis','{"region":"hk"}')`)).rejects.toThrow(/IDEMPOTENCY_CONFLICT/i);
  await expect(rpc(`select cloud_submit_execution('${b}','${compositeRunner}','70707070-7070-4070-8070-707070707070','composite_analysis','{"region":"cn"}')`)).rejects.toThrow(/RUNNER_BUSY/i);
  await rpc(`select cloud_claim_execution('${b}','${compositeRunner}','${compositeSession}')`);
  await expect(rpc(`select cloud_finish_execution('${b}','${compositeRunner}','${compositeSession}','${task.id}','${publishId}',null)`)).rejects.toThrow(/COMPOSITE_SUMMARY_REQUIRED/i);
  await rpc(`select cloud_begin_publish('${publishId}','${b}','${hash}','{}')`);
  const path = `${b}/${publishId}/${hash}.md`;
  await db.exec(`insert into storage.objects(bucket_id,name) values ('analysis-reports','${path}')`);
  const basePayload = { title: 'Composite', markdown: '# Composite', results: [], generated_at: '2026-09-20T00:00:00Z', market_as_of: null };
  const summary = { outcome: 'partial', stock_completed: 1, stock_failed: 1, market_review_status: 'completed', failed_stocks: ['MSFT'] };
  const badPayload = { ...basePayload, execution_summary: { outcome: 'completed', stock_completed: 2, stock_failed: 0, market_review_status: 'failed', failed_stocks: [] } };
  await expect(rpc(`select cloud_complete_runner_publish('${b}','${compositeRunner}','${compositeSession}','${task.id}','${publishId}','${hash}','${JSON.stringify(badPayload)}','${path}')`)).rejects.toThrow(/INVALID_INPUT/i);
  for (const field of ['outcome', 'stock_completed', 'stock_failed', 'market_review_status', 'failed_stocks'] as const) {
    const nullPayload = { ...basePayload, execution_summary: { ...summary, [field]: null } };
    await expect(rpc(`select cloud_complete_runner_publish('${b}','${compositeRunner}','${compositeSession}','${task.id}','${publishId}','${hash}','${JSON.stringify(nullPayload)}','${path}')`)).rejects.toThrow(/INVALID_INPUT/i);
  }
  expect((await db.query(`select status,result_summary from execution_tasks where id='${task.id}'`)).rows).toEqual([{ status: 'running', result_summary: null }]);
  expect((await db.query(`select count(*)::integer as count from analysis_reports where task_id='${publishId}'`)).rows).toEqual([{ count: 0 }]);
  const payload = { ...basePayload, execution_summary: summary };
  await rpc(`select cloud_complete_runner_publish('${b}','${compositeRunner}','${compositeSession}','${task.id}','${publishId}','${hash}','${JSON.stringify(payload)}','${path}')`);
  expect((await db.query(`select status,result_summary from execution_tasks where id='${task.id}'`)).rows).toEqual([{ status: 'succeeded', result_summary: summary }]);
  const duplicate = { ...basePayload, execution_summary: { ...summary, failed_stocks: ['000001'] } };
  await rpc(`select cloud_complete_runner_publish('${b}','${compositeRunner}','${compositeSession}','${task.id}','${publishId}','${hash}','${JSON.stringify(duplicate)}','${path}')`);
  expect((await db.query(`select result_summary from execution_tasks where id='${task.id}'`)).rows).toEqual([{ result_summary: summary }]);
});
