import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AnalysisRecord, CloudData } from './client';
import { useAnalysisRecords } from './useAnalysisRecords';
import { CloudDialog } from './CloudDialog';

function title(row: AnalysisRecord) {
  const code = row.codes.length === 1 ? row.codes[0] : row.report?.stock_code;
  if (code === 'COMPOSITE') return '综合分析';
  if (code === 'MARKET') return '大盘复盘';
  if (row.codes.length <= 1 && code) return row.report?.stock_name?.trim() || code;
  const value = row.report?.title || (row.codes.length ? row.codes.join('、') : '分析结果（尚无报告）');
  return value.replace(/\bCOMPOSITE\b/g, '综合分析').replace(/\bMARKET\b/g, '大盘复盘');
}
function recordState(row: AnalysisRecord): { label: string; tone: string } {
  if (row.purge_started_at) return { label: '待完成删除', tone: 'publish_failed' };
  if (row.status === 'publishing') return { label: '保存中', tone: 'publishing' };
  if (row.status === 'publish_failed') return { label: '保存失败', tone: 'publish_failed' };
  if (row.status === 'cancelled') return { label: '已取消', tone: 'cancelled' };
  if (!row.report) return { label: '报告缺失', tone: 'publish_failed' };
  const task = row.execution;
  if (!task) return { label: '已保存', tone: 'cancelled' };
  if (task.status !== 'succeeded') return { label: '结果待确认', tone: 'publishing' };
  if (task.task_type !== 'composite_analysis' || task.result_summary?.outcome === 'completed') return { label: '已完成', tone: 'succeeded' };
  if (task.result_summary?.outcome === 'partial') return { label: '部分完成', tone: 'publishing' };
  return { label: '已保存', tone: 'cancelled' };
}
function source(row: AnalysisRecord) {
  return row.execution?.runner_id === 'github-actions-daily' ? '每日定时'
    : row.execution?.runner_id === 'local-primary' ? '网页分析' : '未记录';
}

export function AnalysisRecords({ api, user, revision, pageSize, formatDate, onChanged }: {
  api: CloudData; user: string; revision: number; pageSize: number; formatDate: (value: string) => string; onChanged?: () => void;
}) {
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [trash, setTrash] = useState(false);
  const { rows, count, loading, error } = useAnalysisRecords(api, user, page, pageSize, revision + retry, trash);
  const [downloading, setDownloading] = useState<string>();
  const [downloadError, setDownloadError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<AnalysisRecord>();
  const [permanent, setPermanent] = useState(false);
  const [changing, setChanging] = useState(false);
  const [changeError, setChangeError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!loading && !error && page > 0 && page * pageSize >= count) setPage(Math.max(0, Math.ceil(count / pageSize) - 1));
  }, [count, page, pageSize, loading, error]);
  const changeDeleted = async (id: string, deleted: boolean) => {
    setChanging(true); setChangeError(''); setMessage('');
    try {
      await api.setRecordDeleted(id, deleted);
      setPendingDelete(undefined);
      setMessage(deleted ? '已移入回收站，可随时恢复。' : '已恢复到分析记录。');
      setRetry((n) => n + 1); onChanged?.();
    } catch { setChangeError('操作失败，请确认任务已结束，并检查网络及账户权限后重试。'); }
    finally { setChanging(false); }
  };
  const purge = async (id: string) => {
    setChanging(true); setChangeError(''); setMessage('');
    try {
      await api.permanentlyDeleteReport(id);
      setPendingDelete(undefined); setMessage('报告及附件已永久删除。');
      setRetry((n) => n + 1); onChanged?.();
    } catch {
      // The server may have locked deletion or removed the attachment already.
      // Re-query so the UI cannot offer restore after partial completion.
      setChangeError('删除未完成，请重试永久删除；已开始删除的记录不能恢复。');
      setRetry((n) => n + 1); onChanged?.();
    } finally { setChanging(false); }
  };
  const download = async (id: string) => {
    setDownloading(id); setDownloadError('');
    try {
      const report = await api.report(user, id);
      const blob = await api.download(report);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `report-${id}.md`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setDownloadError('下载失败，请检查网络、登录状态及权限后重试。'); }
    finally { setDownloading(undefined); }
  };
  return <section className="cloud-panel cloud-records">
    <div className="cloud-section-heading"><div className="cloud-records-heading"><h2>{trash ? '回收站' : '分析记录'}</h2><span className="cloud-muted">{count} 条</span></div>
      <button disabled={changing} onClick={() => { setTrash(!trash); setPage(0); setMessage(''); setChangeError(''); setDownloadError(''); }}>{trash ? '返回分析记录' : '回收站'}</button></div>
    {trash && <p className="cloud-muted cloud-records-caption">可恢复尚未开始永久删除的记录，也可永久删除报告及附件。</p>}
    {error && <p role="alert">记录加载失败，请稍后重试。<button onClick={() => setRetry((n) => n + 1)}>重试</button></p>}
    {downloadError && <p role="alert">{downloadError}</p>}
    {changeError && !pendingDelete && <p role="alert">{changeError}</p>}
    {message && <p role="status">{message}</p>}
    {loading ? <p role="status">加载记录中…</p> : <div className="cloud-table-scroll" role="region" aria-label="分析记录表格" tabIndex={0}>
      <table className="cloud-records-table" aria-label={trash ? '回收站记录' : '分析记录'}>
        <thead><tr><th scope="col">报告名称</th><th scope="col">来源</th><th scope="col">状态</th><th scope="col">时间</th><th scope="col">操作</th></tr></thead>
        <tbody>{rows.map((row) => {
          const state = recordState(row);
          const active = row.status === 'publishing' || row.execution?.status === 'pending' || row.execution?.status === 'running';
          return <tr key={row.id}>
            <td className="cloud-record-title">{row.report ? <Link to={`/reports/${row.id}`}>{title(row)}</Link> : <strong>{title(row)}</strong>}</td>
            <td>{source(row)}</td>
            <td><span className={`cloud-save-state is-${state.tone}`}>{state.label}</span></td>
            <td><time dateTime={row.report?.generated_at || row.updated_at}>{formatDate(row.report?.generated_at || row.updated_at)}</time></td>
            <td><div className="cloud-record-actions">{row.report ? <><Link to={`/reports/${row.id}`}>查看</Link><button disabled={downloading !== undefined} aria-label={`下载 ${title(row)}`} onClick={() => void download(row.id)}>{downloading === row.id ? '下载中…' : '下载'}</button></> : <span className="cloud-muted">暂无报告</span>}
              {trash ? <><button disabled={changing || Boolean(row.purge_started_at)} aria-label={`恢复 ${title(row)}`} onClick={() => void changeDeleted(row.id, false)}>恢复</button><button className="cloud-delete-action" disabled={changing || active} aria-label={`永久删除 ${title(row)}`} onClick={() => { setPermanent(true); setChangeError(''); setPendingDelete(row); }}>{row.purge_started_at ? '重试删除' : '永久删除'}</button></>
                : <button className="cloud-delete-action" disabled={changing || active} aria-label={`删除 ${title(row)}`} onClick={() => { setPermanent(false); setChangeError(''); setPendingDelete(row); }}>删除</button>}
            </div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
    {!loading && !rows.length && !error && <p className="cloud-muted">{trash ? '回收站为空。' : '暂无分析记录。分析结果开始保存后会出现在这里。'}</p>}
    <div className="cloud-records-footer"><details className="cloud-records-note cloud-muted"><summary>状态说明</summary><p>“已完成”和“部分完成”均已保存报告。“已保存”用于缺少完整分析结果信息的历史记录。任务结束后才可删除。</p></details>
      <div className="cloud-pagination"><button disabled={page === 0 || changing} onClick={() => setPage((n) => n - 1)}>上一页</button><span>第 {page + 1} 页</span><button disabled={(page + 1) * pageSize >= count || changing} onClick={() => setPage((n) => n + 1)}>下一页</button></div></div>
    {pendingDelete && <CloudDialog title={permanent ? '永久删除报告？' : '移入回收站？'} onClose={() => { setPendingDelete(undefined); setChangeError(''); }} busy={changing}>
      <p>{permanent ? `永久删除“${title(pendingDelete)}”的报告正文和附件，无法恢复。已有分析任务记录将保留。` : `“${title(pendingDelete)}”将从分析列表移除，可在回收站恢复。报告与附件不会永久删除。`}</p>
      {changeError && <p role="alert">{changeError}</p>}
      <div className="cloud-actions"><button disabled={changing} onClick={() => setPendingDelete(undefined)}>取消</button><button className="btn-primary" disabled={changing} onClick={() => void (permanent ? purge(pendingDelete.id) : changeDeleted(pendingDelete.id, true))}>{changing ? '处理中…' : permanent ? '永久删除' : '移入回收站'}</button></div>
    </CloudDialog>}
  </section>;
}
