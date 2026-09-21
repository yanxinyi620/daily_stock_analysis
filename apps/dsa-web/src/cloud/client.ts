import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type Market = 'CN' | 'HK' | 'US';
export interface WatchItem { id: string; market: Market; code: string; name: string; position: number }
export interface ReportIndex { task_id: string; title: string; generated_at: string; market_as_of: string | null; stock_name?: string | null; stock_code?: string | null }
export interface CloudReport extends ReportIndex { markdown: string; bucket: string; object_path: string }
export interface PublishTask { id: string; status: 'publishing' | 'publish_failed' | 'succeeded' | 'cancelled'; updated_at: string }
export interface RecordExecution {
  id: string;
  report_id: string;
  runner_id: string | null;
  task_type: string;
  status: string;
  result_summary: {
    outcome?: string;
    stock_completed?: number;
    stock_failed?: number;
    market_review_status?: string;
  } | null;
}
export interface AnalysisRecord {
  id: string;
  status: PublishTask['status'];
  updated_at: string;
  codes: string[];
  deleted_at?: string | null;
  report: ReportIndex | null;
  execution: RecordExecution | null;
}

let sharedClient: { url: string; key: string; client: SupabaseClient } | undefined;

export function createCloudClient(env: Record<string, string | undefined> = import.meta.env): SupabaseClient {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('云端配置缺失，请配置 Supabase 地址和公开 Key。');
  let publicKey = key.startsWith('sb_publishable_');
  if (key.startsWith('eyJ')) {
    try {
      const body = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      publicKey = JSON.parse(atob(body)).role === 'anon';
    } catch { publicKey = false; }
  }
  if (!publicKey) throw new Error('浏览器只能使用公开 Publishable Key / anon key。');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) {
    throw new Error('云端配置必须使用 HTTPS。');
  }
  if (sharedClient?.url === url && sharedClient.key === key) return sharedClient.client;
  if (sharedClient) void sharedClient.client.auth.stopAutoRefresh();
  const client = createClient(url, key, { auth: { detectSessionInUrl: false, persistSession: true, autoRefreshToken: true } });
  sharedClient = { url, key, client };
  return client;
}

export function normalizeCloudCode(market: Market, value: string): string {
  let code = value.trim();
  if (market === 'HK') code = `hk${code.replace(/^hk/i, '').padStart(5, '0')}`;
  if (market === 'US') code = code.toUpperCase();
  const pattern = { CN: /^\d{6}$/, HK: /^hk\d{5}$/, US: /^[A-Z][A-Z0-9.^-]{0,19}$/ }[market];
  if (!pattern.test(code)) throw new Error('股票代码格式不正确，请核对市场和代码。');
  return code;
}

function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw new Error('请求失败，请检查网络、登录状态及账户权限后重试。');
  return result.data;
}

export function cloudData(client: SupabaseClient) {
  return {
    async member(user: string) {
      const data = checked(await client.from('app_members').select('enabled').eq('user_id', user).maybeSingle());
      return data?.enabled === true;
    },
    async watchlist(user: string): Promise<WatchItem[]> {
      return checked(await client.from('watchlists').select('id,market,code,name,position').eq('user_id', user)
        .order('position').order('created_at')) ?? [];
    },
    async saveWatch(user: string, item: Omit<WatchItem, 'id'>, id?: string) {
      const values = { ...item, code: normalizeCloudCode(item.market, item.code), name: item.name.trim() };
      if (id) checked(await client.from('watchlists').update(values).eq('user_id', user).eq('id', id));
      else checked(await client.from('watchlists').insert({ ...values, user_id: user }));
    },
    async deleteWatch(user: string, id: string) {
      checked(await client.from('watchlists').delete().eq('user_id', user).eq('id', id));
    },
    async records(user: string, page: number, size: number, trash = false) {
      const index = client.from('analysis_tasks')
        .select('id,status,updated_at,deleted_at,codes:input_snapshot->codes,analysis_reports(task_id,title,generated_at,market_as_of,stock_name:results->0->>name,stock_code:results->0->>code)', { count: 'exact' })
        .eq('user_id', user);
      const filtered = trash ? index.not('deleted_at', 'is', null) : index.is('deleted_at', null);
      const [taskResult, activeResult] = await Promise.all([
        filtered.order('updated_at', { ascending: false }).order('id')
          .range(page * size, (page + 1) * size - 1),
        trash ? Promise.resolve({ data: null, count: 0, error: null }) : client.from('analysis_tasks').select('id', { count: 'exact', head: true })
          .eq('user_id', user).eq('status', 'publishing').is('deleted_at', null),
      ]);
      const tasks = (checked(taskResult) ?? []) as Array<{
        id: string;
        status: string;
        updated_at: string;
        codes?: unknown;
        deleted_at?: string | null;
        analysis_reports?: ReportIndex | ReportIndex[] | null;
      }>;
      checked(activeResult);
      const ids = tasks.map((task) => task.id);
      let executions: RecordExecution[] = [];
      if (ids.length > 0) {
        executions = (checked(await client.from('execution_tasks')
          .select('id,report_id,runner_id,task_type,status,result_summary')
          .eq('user_id', user).in('report_id', ids)) ?? []) as RecordExecution[];
      }
      const executionByReport = new Map<string, RecordExecution>();
      for (const execution of executions) {
        if (!executionByReport.has(execution.report_id)) executionByReport.set(execution.report_id, execution);
      }
      return {
        rows: tasks.map((task) => {
          const report = Array.isArray(task.analysis_reports) ? task.analysis_reports[0] ?? null : task.analysis_reports ?? null;
          const codes = Array.isArray(task.codes) ? task.codes.filter((code): code is string => typeof code === 'string') : [];
          return { id: task.id, status: task.status, updated_at: task.updated_at, deleted_at: task.deleted_at ?? null, codes, report, execution: executionByReport.get(task.id) ?? null };
        }) as AnalysisRecord[],
        count: taskResult.count ?? 0,
        active: !trash && ((activeResult.count ?? 0) > 0 || tasks.some((task) => task.status === 'publishing')),
      };
    },
    async setRecordDeleted(id: string, deleted: boolean) {
      // Ownership is derived by the database from the authenticated session.
      checked(await client.rpc('cloud_set_report_deleted', { p_task_id: id, p_deleted: deleted }));
    },
    async report(user: string, id: string): Promise<CloudReport> {
      const data = checked(await client.from('analysis_reports').select('task_id,title,markdown,bucket,object_path,generated_at,market_as_of,stock_name:results->0->>name,stock_code:results->0->>code')
        .eq('user_id', user).eq('task_id', id).single());
      if (!data) throw new Error('报告不存在或无权访问。');
      return data as CloudReport;
    },
    async download(report: CloudReport) {
      // Authenticated download; no signed URL persisted, cached or logged.
      const blob = checked(await client.storage.from(report.bucket).download(report.object_path));
      if (!blob) throw new Error('附件不存在或无权访问。');
      return blob;
    },
  };
}
export type CloudData = ReturnType<typeof cloudData>;
