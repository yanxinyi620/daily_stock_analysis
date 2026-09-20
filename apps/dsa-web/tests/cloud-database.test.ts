// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';

const db = new PGlite();
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const task = '33333333-3333-4333-8333-333333333333';
const digest = 'a'.repeat(64);
const path = `${a}/${task}/${digest}.md`;
async function asUser(user: string, sql: string) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await db.query(sql); } finally { await db.exec('reset role'); }
}
beforeAll(async () => {
  // Actual PostgreSQL RLS/constraints/RPCs; only Supabase-owned schemas are minimal fixtures.
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
  await db.exec(`insert into public.app_members(user_id) values ('${a}'), ('${b}');`);
}, 30000);
afterAll(() => db.close());

test('watchlists isolate users, retain zeroes and forbid ownership changes', async () => {
  await asUser(a, `insert into watchlists(user_id, market, code) values ('${a}', 'CN', '000001')`);
  expect((await asUser(a, 'select code from watchlists')).rows).toEqual([{ code: '000001' }]);
  expect((await asUser(b, 'select * from watchlists')).rows).toEqual([]);
  await expect(asUser(b, `insert into watchlists(user_id, market, code) values ('${a}', 'CN', '000002')`)).rejects.toThrow();
  await expect(asUser(a, `update watchlists set user_id='${b}'`)).rejects.toThrow();
  await expect(asUser(a, `insert into watchlists(user_id, market, code) values ('${a}', 'CN', '000001')`)).rejects.toThrow();
  await asUser(b, 'delete from watchlists');
  expect((await asUser(a, 'select * from watchlists')).rows).toHaveLength(1);
});

test('publication is transactional, immutable, idempotent and owner-bound', async () => {
  await db.exec(`select cloud_begin_publish('${task}', '${a}', '${digest}', '{"codes":["000001"]}');`);
  await expect(db.exec(`select cloud_begin_publish('${task}', '${b}', '${digest}', '{}');`)).rejects.toThrow();
  const payload = JSON.stringify({ title: '测试报告', markdown: '# report', results: [], generated_at: '2026-09-14T00:00:00Z', market_as_of: null });
  const finish = `select cloud_complete_publish('${task}', '${a}', '${digest}', '${payload}', '${path}')`;
  await expect(db.exec(finish)).rejects.toThrow(); // required object absent, no success/report
  expect((await db.query('select * from analysis_reports')).rows).toHaveLength(0);
  await db.exec(`insert into storage.objects(bucket_id,name) values ('analysis-reports','${path}');`);
  await db.exec(finish);
  await db.exec(finish);
  await db.exec(`select cloud_fail_publish('${task}', '${a}', '${digest}');`); // late failure cannot overwrite success
  expect((await db.query('select status from analysis_tasks')).rows).toEqual([{ status: 'succeeded' }]);
  expect((await asUser(a, 'select * from analysis_reports')).rows).toHaveLength(1);
  expect((await asUser(b, 'select * from analysis_reports')).rows).toHaveLength(0);
  await expect(db.exec(`select cloud_begin_publish('${task}', '${a}', '${'b'.repeat(64)}', '{}');`)).rejects.toThrow();
  await expect(db.exec(`insert into analysis_reports(task_id,user_id,title,markdown,results,object_path) values ('${task}','${b}','x','x','[]','x')`)).rejects.toThrow();
});

test('clients cannot write tasks, reports or membership or invoke privileged RPCs', async () => {
  for (const sql of [
    `update analysis_tasks set status='succeeded'`,
    `insert into analysis_tasks(id,user_id,content_hash,input_snapshot) values ('${b}','${a}','${digest}','{}')`,
    'delete from analysis_reports',
    'update app_members set enabled=true',
    `select cloud_begin_publish('${b}','${a}','${digest}','{}')`,
    `select cloud_fail_publish('${task}','${a}','${digest}')`,
    `select cloud_complete_publish('${task}','${a}','${digest}','{}','${path}')`,
  ]) await expect(asUser(a, sql)).rejects.toThrow();
});

test('Storage needs linked report AND active owner, never just a path prefix', async () => {
  await db.exec(`insert into storage.objects(bucket_id,name) values ('analysis-reports','${a}/${b}/orphan.md');`);
  expect((await asUser(a, 'select name from storage.objects')).rows).toEqual([{ name: path }]);
  expect((await asUser(b, 'select * from storage.objects')).rows).toHaveLength(0);
  await expect(asUser(a, `insert into storage.objects(bucket_id,name) values ('analysis-reports','${a}/evil.md')`)).rejects.toThrow();
  await asUser(a, 'delete from storage.objects');
  expect((await db.query('select * from storage.objects')).rows).toHaveLength(2);
  // An unrelated permissive storage policy must not make our private bucket public.
  await db.exec('create policy unrelated_public_read on storage.objects for select to anon, authenticated using (true)');
  expect((await asUser(b, 'select * from storage.objects')).rows).toHaveLength(0);
  await db.exec('set role anon');
  try {
    expect((await db.query('select * from storage.objects')).rows).toHaveLength(0);
    for (const table of ['app_members', 'watchlists', 'analysis_tasks', 'analysis_reports']) {
      await expect(db.query(`select * from ${table}`)).rejects.toThrow();
    }
  } finally { await db.exec('reset role'); }
  await db.exec(`update app_members set enabled=false where user_id='${a}'`);
  expect((await asUser(a, 'select * from analysis_reports')).rows).toHaveLength(0);
  expect((await asUser(a, 'select * from analysis_tasks')).rows).toHaveLength(0);
  expect((await asUser(a, 'select * from watchlists')).rows).toHaveLength(0);
  expect((await asUser(a, 'select * from storage.objects')).rows).toHaveLength(0);
  await expect(asUser(a, `insert into watchlists(user_id,market,code) values ('${a}','US','AAPL')`)).rejects.toThrow();
});

test('cleanup cannot delete a report; cancellation prevents late commit or re-publication', async () => {
  await expect(db.exec(`select cloud_cleanup_publish('${task}','${a}','${digest}',true)`)).rejects.toThrow();
  const pending = '44444444-4444-4444-8444-444444444444';
  await db.exec(`set role service_role; select cloud_begin_publish('${pending}', '${b}', '${digest}', '{}'); reset role;`);
  await db.exec(`select cloud_cleanup_publish('${pending}','${b}','${digest}',false)`);
  expect((await db.query(`select status from analysis_tasks where id='${pending}'`)).rows).toEqual([{ status: 'publishing' }]);
  await expect(asUser(b, `select cloud_cleanup_publish('${pending}','${b}','${digest}',true)`)).rejects.toThrow();
  await db.exec(`select cloud_cleanup_publish('${pending}','${b}','${digest}',true)`);
  await expect(db.exec(`select cloud_begin_publish('${pending}','${b}','${digest}','{}')`)).rejects.toThrow();
  await expect(db.exec(`select cloud_complete_publish('${pending}','${b}','${digest}','{}','${b}/${pending}/${digest}.md')`)).rejects.toThrow();
  await db.exec(`select cloud_fail_publish('${pending}','${b}','${digest}')`);
  expect((await db.query(`select status from analysis_tasks where id='${pending}'`)).rows).toEqual([{ status: 'cancelled' }]);
});
