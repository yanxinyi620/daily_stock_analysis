import { useCallback, useEffect, useRef, useState } from 'react';

const errors: Record<string, string> = {
  FORBIDDEN: '仅主账号可以管理定时任务。',
  UNAUTHENTICATED: '登录已失效，请重新登录。',
  NOT_CONFIGURED: '定时任务控制尚未配置，请联系管理员。',
};

export function SchedulePanel({ accessToken }: { accessToken: string }) {
  const [enabled, setEnabled] = useState<boolean>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const currentRequest = useRef<AbortController | null>(null);
  const load = useCallback(async (desired?: boolean) => {
    if (currentRequest.current) return;
    const controller = new AbortController();
    currentRequest.current = controller;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/schedule', {
        method: desired === undefined ? 'GET' : 'PUT',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]),
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: desired === undefined ? undefined : JSON.stringify({ enabled: desired }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'REQUEST_FAILED');
      if (typeof body?.enabled !== 'boolean' || (desired !== undefined && body.enabled !== desired)) throw new Error('STATE_UNCONFIRMED');
      if (!controller.signal.aborted) setEnabled(body.enabled);
    } catch (caught) {
      if (!controller.signal.aborted) {
        setEnabled(undefined);
        const code = caught instanceof Error ? caught.message : '';
        setError(errors[code] ?? (desired === undefined ? '定时任务状态查询失败，请刷新重试。' : '未能确认操作结果，请刷新状态后再操作。'));
      }
    } finally {
      if (currentRequest.current === controller) { currentRequest.current = null; setBusy(false); }
    }
  }, [accessToken]);

  useEffect(() => {
    setEnabled(undefined);
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      currentRequest.current?.abort(); currentRequest.current = null;
      window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

  const state = enabled === undefined ? 'unknown' : enabled ? 'online' : 'offline';
  return <section className="cloud-panel cloud-schedule-panel" aria-labelledby="cloud-schedule-title">
    <div className="cloud-section-heading">
      <h2 id="cloud-schedule-title">GitHub Actions 定时分析</h2>
      <span className={`cloud-runner-state is-${state}`} aria-live="polite">{busy ? '正在同步…' : enabled === undefined ? '状态未知' : enabled ? '已启用' : '已暂停'}</span>
    </div>
    <div className="cloud-schedule-controls">
      <div><p className="cloud-schedule-time">周一至周五 · 北京时间 18:00</p><p className="cloud-muted">云端独立运行，无需本地服务在线；实际执行可能延迟。</p></div>
      <div className="cloud-schedule-buttons">
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void load()}>刷新状态</button>
        {enabled !== undefined && <button type="button" className={enabled ? 'btn-secondary' : 'btn-primary'} disabled={busy} onClick={() => void load(!enabled)}>{enabled ? '暂停定时任务' : '启用定时任务'}</button>}
      </div>
    </div>
    <p className="cloud-muted cloud-schedule-note">暂停不会中断正在执行的分析；暂停期间，GitHub 手动运行也会停用。启用后恢复后续定时安排，不会立即分析。</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
