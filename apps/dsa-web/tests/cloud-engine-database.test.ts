// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';

const db = new PGlite();

const engineTables = [
  'agent_provider_turns', 'alert_cooldowns', 'alert_notifications', 'alert_rules', 'alert_triggers',
  'analysis_history', 'backtest_results', 'backtest_runs', 'backtest_summaries', 'conversation_messages',
  'conversation_session_states', 'conversation_summaries', 'decision_signal_feedback', 'decision_signal_outcomes',
  'decision_signals', 'fundamental_snapshot', 'intelligence_items', 'intelligence_sources', 'llm_usage',
  'news_intel', 'portfolio_accounts', 'portfolio_cash_ledger', 'portfolio_corporate_actions',
  'portfolio_daily_snapshots', 'portfolio_fx_rates', 'portfolio_position_lots', 'portfolio_positions',
  'portfolio_trades', 'schema_migrations', 'screening_runs', 'skill_opinion_outcomes', 'skill_opinion_samples',
  'stock_daily',
];

beforeAll(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(readFileSync(
    new URL('../../../supabase/migrations/202609180002_cloud_engine.sql', import.meta.url),
    'utf8',
  ));
}, 30000);

afterAll(() => db.close());

test('private migration creates every ORM table and its foreign-key graph', async () => {
  const tables = await db.query<{ table_name: string }>(`
    select table_name from information_schema.tables
    where table_schema = 'dsa_engine' and table_type = 'BASE TABLE'
    order by table_name
  `);
  expect(tables.rows.map((row) => row.table_name)).toEqual([...engineTables].sort());

  const foreignKeys = await db.query<{ table_name: string }>(`
    select distinct table_name from information_schema.table_constraints
    where table_schema = 'dsa_engine' and constraint_type = 'FOREIGN KEY'
  `);
  expect(foreignKeys.rows.map((row) => row.table_name)).toContain('portfolio_positions');
  expect(foreignKeys.rows.map((row) => row.table_name)).toContain('skill_opinion_outcomes');
});

test('PostgREST-facing roles cannot use private runner tables', async () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await db.exec(`set role ${role}`);
    try {
      await expect(db.query('select * from dsa_engine.analysis_history')).rejects.toThrow();
    } finally {
      await db.exec('reset role');
    }
  }
});
