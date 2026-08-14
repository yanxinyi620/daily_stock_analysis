import { ArrowLeft, ShieldAlert, TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { historyApi } from '../../api/history';
import { ReportMarkdownBody } from '../../components/report/ReportMarkdownBody';
import type { AnalysisReport } from '../../types/analysis';

const MobileReportPage = () => {
  const { historyId } = useParams();
  const navigate = useNavigate();
  const recordId = Number(historyId);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMarkdown, setLoadingMarkdown] = useState(false);

  useEffect(() => {
    let active = true;
    void historyApi.getDetail(recordId).then(value => { if (active) setReport(value); }).catch(err => { if (active) setError(err instanceof Error ? err.message : '报告加载失败'); });
    return () => { active = false; };
  }, [recordId]);

  const showFullReport = async () => {
    if (markdown !== null || loadingMarkdown) return;
    setLoadingMarkdown(true);
    try { setMarkdown(await historyApi.getMarkdown(recordId)); }
    catch (err) { setError(err instanceof Error ? err.message : '完整报告加载失败'); }
    finally { setLoadingMarkdown(false); }
  };

  if (error && !report) return <div role="alert" className="rounded-2xl bg-danger/10 p-4 text-sm text-danger">{error}</div>;
  if (!report) return <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-text">正在加载报告…</div>;

  const { meta, summary, strategy } = report;
  return <article className="space-y-4">
    <header className="flex items-center gap-3"><button type="button" aria-label="返回" onClick={() => navigate(-1)} className="grid min-h-11 min-w-11 place-items-center rounded-2xl border border-border bg-card"><ArrowLeft className="h-4 w-4" /></button><div><h1 className="text-xl font-black">{meta.stockName || meta.stockCode}</h1><p className="font-mono text-xs text-muted-text">{meta.stockCode}</p></div></header>
    <section className="rounded-3xl border border-cyan/20 bg-card p-5 shadow-sm"><div className="flex items-end justify-between"><div><p className="text-xs font-semibold tracking-[0.14em] text-muted-text">综合评分</p><p className="mt-1 text-4xl font-black text-cyan">{summary.sentimentScore}</p></div><span className="rounded-full bg-cyan/10 px-3 py-1.5 text-sm font-bold text-cyan">{summary.operationAdvice}</span></div><p className="mt-4 text-sm leading-6 text-secondary-text">{summary.analysisSummary}</p></section>
    <div className="grid grid-cols-2 gap-2.5"><section className="rounded-2xl border border-border bg-card p-4"><TrendingUp className="h-4 w-4 text-cyan" /><p className="mt-3 text-xs text-muted-text">趋势判断</p><p className="mt-1 text-sm font-bold">{summary.trendPrediction}</p></section><section className="rounded-2xl border border-border bg-card p-4"><ShieldAlert className="h-4 w-4 text-warning" /><p className="mt-3 text-xs text-muted-text">风险边界</p><p className="mt-1 text-sm font-bold">止损 {strategy?.stopLoss || '未提供'}</p></section></div>
    {strategy ? <section className="rounded-2xl border border-border bg-card p-4"><h2 className="text-sm font-black">策略点位</h2><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-muted-text">止损</p><p className="mt-1 font-bold text-danger">{strategy.stopLoss || '—'}</p></div><div><p className="text-xs text-muted-text">止盈</p><p className="mt-1 font-bold text-success">{strategy.takeProfit || '—'}</p></div></div></section> : null}
    <button type="button" onClick={() => void showFullReport()} className="min-h-12 w-full rounded-2xl bg-cyan px-4 text-sm font-black text-primary-foreground">{loadingMarkdown ? '加载中…' : '查看完整报告'}</button>
    {markdown !== null ? <section className="overflow-hidden rounded-2xl border border-border bg-card p-4"><ReportMarkdownBody content={markdown} /></section> : null}
  </article>;
};
export default MobileReportPage;
