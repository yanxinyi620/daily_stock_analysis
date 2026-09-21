import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Link } from 'react-router-dom';
import { normalizeCloudCode, type Market } from './client';

type RunnerState = { online: boolean; busy: boolean; last_seen_at: string | null; current_task_id: string | null };
type TaskType = 'stock_analysis' | 'market_review' | 'composite_analysis';
type MarketReviewRegion = 'cn' | 'hk' | 'us' | 'jp' | 'kr';
type CompositeSummary = { outcome?: 'completed' | 'partial'; stock_completed?: number; stock_failed?: number; market_review_status?: 'completed' | 'failed'; failed_stocks?: string[] };
type Task = { id: string; status: 'pending' | 'running' | 'succeeded' | 'failed'; task_type?: TaskType; input_json?: { stock_code?: string; region?: MarketReviewRegion; stock_codes?: string[] }; result_summary?: CompositeSummary | null; progress?: number; progress_message?: string | null; report_id?: string | null; error_code?: string | null; created_at?: string };
type Props = { client: SupabaseClient; accessToken: string; user: string; onReport: () => void; reportRevision?: number };

const terminal = (status: Task['status']) => status === 'succeeded' || status === 'failed';
const humanError: Record<string, string> = {
  RUNNER_OFFLINE: '本地分析服务离线，请先启动服务。', RUNNER_BUSY: '本地分析服务正在处理其他任务，请稍后再试。',
  FORBIDDEN: '当前账户没有提交分析任务的权限。', NOT_CONFIGURED: '本地分析服务尚未完成配置。',
  EMPTY_WATCHLIST: '云端自选股为空，请先配置自选股。', SNAPSHOT_TOO_LARGE: '云端自选股快照过大，请减少自选股后重试。',
};
const marketReviewRegions: Array<{ value: MarketReviewRegion; label: string }> = [
  { value: 'cn', label: 'A 股' }, { value: 'hk', label: '港股' }, { value: 'us', label: '美股' },
  { value: 'jp', label: '日股' }, { value: 'kr', label: '韩股' },
];

export function RunnerPanel({ client, accessToken, user, onReport, reportRevision = 0 }: Props) {
  const [runner, setRunner] = useState<RunnerState>();
  const [taskType, setTaskType] = useState<TaskType>('stock_analysis');
  const [market, setMarket] = useState<Market>('CN');
  const [reviewRegion, setReviewRegion] = useState<MarketReviewRegion>('cn');
  const [code, setCode] = useState('');
  const [task, setTask] = useState<Task>();
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [archivedReports, setArchivedReports] = useState<Set<string>>(new Set());
  const [archiveError, setArchiveError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const mountedRef = useRef(false);
  const taskRef = useRef<Task | undefined>(undefined);
  const submittingRef = useRef(false);
  const requestId = useRef<string | undefined>(undefined);
  const uncertain = useRef(false);
  const seenReports = useRef(new Set<string>());
  const historyLoaded = useRef(false);
  const historyRequest = useRef<Promise<Task[] | undefined> | undefined>(undefined);
  const archiveRequest = useRef(0);
  const submitController = useRef<AbortController | undefined>(undefined);
  const onReportRef = useRef(onReport); onReportRef.current = onReport;

  const request = useCallback(async (url: string, init: RequestInit = {}, signal?: AbortSignal) => {
    const timeout = AbortSignal.timeout(8000);
    const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(url, { ...init, signal: combinedSignal, headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { const e = new Error(body?.error_code || body?.error || body?.code || 'REQUEST_FAILED'); (e as Error & { status?: number }).status = response.status; throw e; }
    return body;
  }, [accessToken]);

  const refreshHistory = useCallback((): Promise<Task[] | undefined> => {
    if (historyRequest.current) return historyRequest.current;
    const pending = (async () => {
      try {
        const result = await client.from('execution_tasks').select('id,status,task_type,progress,progress_message,report_id,error_code,created_at,input_json,result_summary').eq('user_id', user).order('created_at', { ascending: false }).limit(20);
        if (result.error) throw result.error;
        const rows = (result.data ?? []) as Task[];
        if (mountedRef.current) setHistoryError('');
        return rows;
      } catch {
        if (mountedRef.current) setHistoryError('任务状态查询失败，稍后重试。');
        return undefined;
      }
    })();
    historyRequest.current = pending;
    void pending.then(() => { if (historyRequest.current === pending) historyRequest.current = undefined; });
    return pending;
  }, [client, user]);

  const refreshArchivedReports = useCallback(async (tasks: Task[]) => {
    const request = ++archiveRequest.current;
    const reportIds = tasks.flatMap((item) => item.report_id ? [item.report_id] : []);
    if (!reportIds.length) { if (mountedRef.current && request === archiveRequest.current) { setArchivedReports(new Set()); setArchiveError(''); } return; }
    try {
      const result = await client.from('analysis_tasks').select('id,deleted_at').eq('user_id', user).in('id', reportIds);
      if (result.error) throw result.error;
      const rows = (result.data ?? []) as Array<{ id: string; deleted_at: string | null }>;
      if (mountedRef.current && request === archiveRequest.current) { setArchivedReports(new Set(rows.filter((row) => row.deleted_at).map((row) => row.id))); setArchiveError(''); }
    } catch { if (mountedRef.current && request === archiveRequest.current) setArchiveError('回收站状态查询失败，报告可能已移入回收站。'); }
  }, [client, user]);

  useEffect(() => { void refreshArchivedReports(task ? [task] : []); }, [task, refreshArchivedReports, reportRevision]);

  useEffect(() => {
    mountedRef.current = true;
    let alive = true;
    let inFlight = false;
    let timer: number | undefined;
    const controller = new AbortController();
    const reconcileHistory = (rows: Task[]) => {
      const initial = !historyLoaded.current;
      historyLoaded.current = true;
      for (const item of rows) {
        if (item.status === 'succeeded' && item.report_id) {
          if (!initial && !seenReports.current.has(item.report_id)) onReportRef.current();
          seenReports.current.add(item.report_id);
        }
      }
      const active = taskRef.current;
      const next = active ? rows.find((item) => item.id === active.id) : rows.find((item) => !terminal(item.status));
      if (next && alive) { taskRef.current = next; setTask(next); }
    };
    const poll = async () => {
      if (!alive || document.visibilityState === 'hidden' || inFlight) return;
      inFlight = true;
      const shouldLoadHistory = !historyLoaded.current || (taskRef.current && !terminal(taskRef.current.status));
      const historyPromise = shouldLoadHistory ? refreshHistory() : undefined;
      try {
        const next = await request('/api/tasks', {}, controller.signal) as RunnerState;
        if (!alive) return;
        setRunner(next);
      } catch (caught) {
        if (alive && (caught as Error).name !== 'AbortError') setRunner(undefined);
      }
      try {
        const rows = await historyPromise;
        if (alive && rows) reconcileHistory(rows);
      } finally {
        inFlight = false;
        if (alive) timer = window.setTimeout(() => void poll(), 5000);
      }
    };
    const resume = () => {
      if (document.visibilityState !== 'visible') return;
      if (timer) { window.clearTimeout(timer); timer = undefined; }
      void poll();
    };
    document.addEventListener('visibilitychange', resume);
    void poll();
    return () => {
      alive = false;
      mountedRef.current = false;
      controller.abort();
      submitController.current?.abort();
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [request, refreshHistory]);

  const activeTask = task && !terminal(task.status);
  const canSubmit = runner?.online === true && (uncertain.current || (!runner.busy && !activeTask));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current || !canSubmit) return;
    setError('');
    let stockCode: string | undefined;
    if (taskType === 'stock_analysis') {
      try { stockCode = normalizeCloudCode(market, code); } catch (caught) { setError(caught instanceof Error ? caught.message : '股票代码格式不正确，请核对市场和代码。'); return; }
    }
    const id = requestId.current ?? crypto.randomUUID();
    requestId.current = id;
    submittingRef.current = true;
    setSubmitting(true);
    const controller = new AbortController();
    submitController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const input = taskType === 'market_review' || taskType === 'composite_analysis' ? { region: reviewRegion } : { stock_code: stockCode };
      const created = await request('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request_id: id, task_type: taskType, input }) }, controller.signal) as Task;
      uncertain.current = false;
      requestId.current = undefined;
      taskRef.current = created;
      if (!mountedRef.current) return;
      setTask(created); if (stockCode) setCode(stockCode);
      if (created.status === 'succeeded' && created.report_id && !seenReports.current.has(created.report_id)) { seenReports.current.add(created.report_id); onReportRef.current(); }
      void refreshHistory();
    } catch (caught) {
      const failed = caught as Error & { status?: number };
      const retryable = failed.message === 'RUNNER_BUSY' || failed.status === 503 || !failed.status;
      uncertain.current = retryable;
      if (!retryable) requestId.current = undefined;
      if (failed.message === 'RUNNER_OFFLINE') setRunner((current) => current ? { ...current, online: false, busy: false } : current);
      if (mountedRef.current) setError(humanError[failed.message] || '提交失败，请稍后重试。');
    } finally {
      window.clearTimeout(timeout);
      if (submitController.current === controller) submitController.current = undefined;
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  const stateLabel = runner === undefined ? '状态未知' : runner.online ? '在线' : '离线';
  const controlDisabled = submitting || uncertain.current;
  const taskLabel = (value?: TaskType) => value === 'market_review' ? '大盘复盘' : value === 'composite_analysis' ? '综合分析' : '个股分析';
  const compositeOutcome = (value?: Task) => value?.task_type === 'composite_analysis' ? value.result_summary?.outcome : undefined;
  const compositeDetail = (value?: Task) => {
    if (value?.task_type !== 'composite_analysis' || !value.result_summary) return null;
    const summary = value.result_summary;
    const failedCodes = summary.failed_stocks?.length ? `失败代码：${summary.failed_stocks.join('、')}` : '';
    const marketFailure = summary.market_review_status === 'failed' ? '大盘复盘失败' : '';
    const stockSuccess = typeof summary.stock_completed === 'number' ? `成功 ${summary.stock_completed} 支` : '';
    const stockFailure = typeof summary.stock_failed === 'number' ? `失败 ${summary.stock_failed} 支` : '';
    const snapshotCount = Array.isArray(value.input_json?.stock_codes) ? `自选股快照 ${value.input_json.stock_codes.length} 支` : '';
    return [snapshotCount, stockSuccess, stockFailure, failedCodes, marketFailure].filter(Boolean).join(' · ');
  };
  const compositeStatusLabel = (value?: Task) => {
    if (compositeOutcome(value) === 'partial') return '部分完成';
    if (compositeOutcome(value) === 'completed') return '已完成';
    return '结果待确认';
  };
  const lastSeen = () => {
    if (runner?.busy) return '服务忙碌中';
    if (!runner?.last_seen_at) return '等待服务心跳';
    try { return `最近连接：${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(runner.last_seen_at))}`; }
    catch { return '最近连接时间暂不可用'; }
  };
  const isArchived = (value: Task) => Boolean(value.report_id && archivedReports.has(value.report_id));
  const reportLink = (value: Task) => value.report_id ? <>{isArchived(value) ? <span className="cloud-muted">报告已移入回收站</span> : <Link to={`/reports/${value.report_id}`}>查看报告</Link>}</> : null;
  return <section className="cloud-panel">
    <div className="cloud-section-heading"><h2>发起分析</h2><span className={`cloud-runner-state is-${stateLabel === '在线' ? 'online' : stateLabel === '离线' ? 'offline' : 'unknown'}`}>{stateLabel}</span></div>
    <p className="cloud-muted cloud-runner-connection">{lastSeen()}</p>
    <form className="cloud-form" onSubmit={(event) => void submit(event)}>
      <div className="cloud-runner-tabs" role="tablist">
        {(['stock_analysis', 'market_review', 'composite_analysis'] as TaskType[]).map((value) => <button key={value} type="button" role="tab" aria-selected={taskType === value} disabled={controlDisabled} onClick={() => setTaskType(value)}>{taskLabel(value)}</button>)}
        <label className="cloud-visually-hidden" htmlFor="runner-task-type">任务类型<select id="runner-task-type" aria-label="任务类型" disabled={controlDisabled} value={taskType} onChange={(event) => setTaskType(event.target.value as TaskType)}><option value="stock_analysis">个股分析</option><option value="market_review">大盘复盘</option><option value="composite_analysis">综合分析</option></select></label>
      </div>
      <div className="cloud-runner-submit-row"><div className="cloud-fields cloud-runner-fields">
        {taskType === 'market_review' || taskType === 'composite_analysis' ? <label htmlFor="runner-review-region">复盘市场<select id="runner-review-region" aria-label="复盘市场" disabled={controlDisabled} value={reviewRegion} onChange={(event) => setReviewRegion(event.target.value as MarketReviewRegion)}>{marketReviewRegions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label> : <><label htmlFor="runner-market">市场<select id="runner-market" aria-label="市场" disabled={controlDisabled} value={market} onChange={(event) => setMarket(event.target.value as Market)}><option value="CN">A 股</option><option value="HK">港股</option><option value="US">美股</option></select></label><label htmlFor="runner-code">代码<input aria-label="代码" id="runner-code" required disabled={controlDisabled} value={code} onChange={(event) => setCode(event.target.value)} placeholder="000001 / hk00700 / AAPL" /></label></>}
      </div><button className="btn-primary" disabled={submitting || !canSubmit}>{submitting ? '提交中…' : uncertain.current ? '重试提交' : '开始分析'}</button></div>
    </form>
    {error && <p role="alert">{error}</p>}
    {historyError && <p role="alert">{historyError}</p>}
    {archiveError && <p role="alert">{archiveError}</p>}
    {task && <p role="status">{task.status === 'succeeded' ? <>{task.task_type === 'composite_analysis' ? compositeStatusLabel(task) : '已完成'}{compositeDetail(task) && <small> · {compositeDetail(task)}</small>} {reportLink(task) || '分析完成'}</> : task.status === 'failed' ? humanError[task.error_code || ''] || '分析失败，请重试。' : `${task.progress_message || '分析处理中…'}${typeof task.progress === 'number' ? ` ${task.progress}%` : ''}`}</p>}
  </section>;
}
