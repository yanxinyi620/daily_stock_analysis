import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AnalysisRecord, CloudData } from './client';
import { useAnalysisRecords } from './useAnalysisRecords';

const saveLabels = { publishing: '保存中', publish_failed: '保存失败', succeeded: '已保存', cancelled: '已取消' };
function title(row: AnalysisRecord) {
  const value = row.report?.title || (row.codes.length ? row.codes.join('、') : '分析结果（尚无报告）');
  return value.replace(/\bCOMPOSITE\b/g, '综合分析').replace(/\bMARKET\b/g, '大盘复盘');
}
function outcome(row: AnalysisRecord) {
  const task = row.execution;
  if (!task) return '未记录';
  if (task.status === 'failed') return '失败';
  if (task.status !== 'succeeded') return '分析中';
  if (task.task_type !== 'composite_analysis') return '已完成';
  return task.result_summary?.outcome === 'completed' ? '全部完成'
    : task.result_summary?.outcome === 'partial' ? '部分完成' : '未记录';
}
function source(row: AnalysisRecord) {
  return row.execution?.runner_id === 'github-actions-daily' ? '每日定时'
    : row.execution?.runner_id === 'local-primary' ? '网页分析' : '未记录';
}

export function AnalysisRecords({ api, user, revision, pageSize, formatDate }: {
  api: CloudData; user: string; revision: number; pageSize: number; formatDate: (value: string) => string;
}) {
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const { rows, count, loading, error } = useAnalysisRecords(api, user, page, pageSize, revision + retry);
  const [downloading, setDownloading] = useState<string>();
  const [downloadError, setDownloadError] = useState('');
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
    <div className="cloud-section-heading"><div><h2>分析记录</h2><p className="cloud-muted cloud-records-caption">报告与保存进度，一处查看。</p></div><span>{count} 条记录</span></div>
    {error && <p role="alert">记录加载失败，请稍后重试。<button onClick={() => setRetry((n) => n + 1)}>重试</button></p>}
    {downloadError && <p role="alert">{downloadError}</p>}
    {loading ? <p role="status">加载记录中…</p> : <div className="cloud-table-scroll" role="region" aria-label="分析记录表格" tabIndex={0}>
      <table className="cloud-records-table" aria-label="分析记录">
        <thead><tr><th scope="col">报告名称</th><th scope="col">来源</th><th scope="col">分析结果</th><th scope="col">保存状态</th><th scope="col">时间</th><th scope="col">操作</th></tr></thead>
        <tbody>{rows.map((row) => {
          const result = outcome(row);
          return <tr key={row.id}>
            <td className="cloud-record-title">{row.report ? <Link to={`/reports/${row.id}`}>{title(row)}</Link> : <strong>{title(row)}</strong>}</td>
            <td>{source(row)}</td>
            <td><span className={`cloud-record-outcome${result === '部分完成' || result === '失败' ? ' is-warning' : ''}`}>{result}</span></td>
            <td><span className={`cloud-save-state is-${row.status}`}>{saveLabels[row.status]}</span></td>
            <td><time dateTime={row.report?.generated_at || row.updated_at}>{formatDate(row.report?.generated_at || row.updated_at)}</time><small className="cloud-muted">{row.report ? '报告生成' : '状态更新'}</small></td>
            <td>{row.report ? <div className="cloud-record-actions"><Link to={`/reports/${row.id}`}>查看</Link><button disabled={downloading !== undefined} aria-label={`下载 ${title(row)}`} onClick={() => void download(row.id)}>{downloading === row.id ? '下载中…' : '下载'}</button></div>
              : <span className="cloud-muted">暂无报告</span>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
    {!loading && !rows.length && !error && <p className="cloud-muted">暂无分析记录。分析结果开始保存后会出现在这里。</p>}
    <p className="cloud-records-note cloud-muted">“已保存”表示报告已存入你的账号，不代表分析全部成功。旧记录缺少的信息显示为“未记录”。</p>
    <div className="cloud-pagination"><button disabled={page === 0} onClick={() => setPage((n) => n - 1)}>上一页</button><span>第 {page + 1} 页</span><button disabled={(page + 1) * pageSize >= count} onClick={() => setPage((n) => n + 1)}>下一页</button></div>
  </section>;
}
