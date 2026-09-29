// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';
const db = new PGlite();
const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
async function rpc(user = a, name = '平安银行', oldName = '', role = 'service_role') {
  await db.exec(`set role ${role}`);
  try {
    return await db.query('select cloud_fill_watchlist_name($1,$2,$3,$4,$5,$6) as updated', [user, id, 'CN', '000001', oldName, name]);
  } finally { await db.exec('reset role'); }
}
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
    grant usage on schema auth, storage to anon, authenticated, service_role;
    create table storage.buckets(id text primary key, name text, public boolean);
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant all on storage.objects to anon, authenticated, service_role;
    insert into auth.users values ('${a}'),('${b}');`);
  for (const file of ['202609140001_cloud_reports.sql', '202609210003_cloud_watchlist_names.sql']) {
    await db.exec(readFileSync(new URL(`../../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  await db.exec(`insert into app_members(user_id) values ('${a}'),('${b}');
    insert into watchlists(id,user_id,market,code) values ('${id}','${a}','CN','000001');`);
}, 30000);
afterAll(() => db.close());

test('only service role can fill names; owner, active membership and compare values are enforced', async () => {
  await expect(rpc(a, '平安银行', '', 'anon')).rejects.toThrow();
  await expect(rpc(a, '平安银行', '', 'authenticated')).rejects.toThrow();
  expect((await rpc(b)).rows).toEqual([{ updated: false }]);
  await db.exec(`update app_members set enabled=false where user_id='${a}'`);
  expect((await rpc()).rows).toEqual([{ updated: false }]);
  await db.exec(`update app_members set enabled=true where user_id='${a}'`);
  expect((await rpc()).rows).toEqual([{ updated: true }]);
  expect((await rpc(a, '覆盖')).rows).toEqual([{ updated: false }]);
  expect((await db.query('select name from watchlists')).rows).toEqual([{ name: '平安银行' }]);
});

test('manual edits, changed codes, deleted/re-added rows and invalid replacements are preserved', async () => {
  await db.exec(`update watchlists set name='自定义' where id='${id}'`);
  expect((await rpc(a, '覆盖', '自定义')).rows).toEqual([{ updated: false }]);
  await db.exec(`update watchlists set name='',code='000002' where id='${id}'`);
  expect((await rpc()).rows).toEqual([{ updated: false }]);
  await db.exec(`update watchlists set code='000001' where id='${id}'`);
  for (const name of ['', '000001', 'x'.repeat(101)]) {
    expect((await rpc(a, name)).rows).toEqual([{ updated: false }]);
  }
  await db.exec(`delete from watchlists where id='${id}';
    insert into watchlists(user_id,market,code) values ('${a}','CN','000001')`);
  expect((await rpc()).rows).toEqual([{ updated: false }]);
});

test('candidate scan includes blanks and code placeholders only for the enabled owner', async () => {
  await db.exec(`insert into watchlists(user_id,market,code,name) values
    ('${a}','US','AAPL','aapl'),('${a}','HK','hk00700','腾讯'),('${b}','CN','000002','');
    set role service_role;`);
  try {
    const result = await db.query('select cloud_watchlist_name_candidates($1) as candidates', [a]);
    const rows = (result.rows[0] as { candidates: {code: string}[] }).candidates;
    expect(rows.map((r) => r.code).sort()).toEqual(['000001', 'AAPL']);
  } finally { await db.exec('reset role'); }
});
