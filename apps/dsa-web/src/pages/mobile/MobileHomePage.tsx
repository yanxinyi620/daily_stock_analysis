import { BarChart3, Layers3, Radar, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { analysisApi } from '../../api/analysis';
import { useMobileDashboard } from '../../hooks/useMobileDashboard';
import { useStockPoolStore } from '../../stores/stockPoolStore';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { groupMobileTasks } from '../../utils/mobileTask';
import { MobileHistoryCard } from '../../components/mobile/MobileHistoryCard';
import { MobileTaskCard } from '../../components/mobile/MobileTaskCard';

const MobileHomePage = () => {
  const dashboard = useMobileDashboard();
  const { t } = useUiLanguage();
  const notify = useStockPoolStore(state => state.notify);
  const navigate = useNavigate();
  const [stockCode, setStockCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const active = groupMobileTasks(dashboard.tasks).active;

  const run = async (kind: string, action: () => Promise<unknown>) => {
    setBusy(kind); setMessage(null);
    try { await action(); navigate('/m/tasks'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '任务提交失败'); }
    finally { setBusy(null); }
  };

  const actions = [
    { label: t('mobile.home.stockAnalysis'), icon: Search, action: () => stockCode.trim() ? run('stock', () => analysisApi.analyzeAsync({ stockCode: stockCode.trim(), reportType: 'full', notify })) : setMessage('请输入股票代码') },
    { label: t('mobile.home.screening'), icon: Radar, action: () => navigate('/m/screening') },
    { label: t('mobile.home.marketReview'), icon: BarChart3, action: () => run('market', () => analysisApi.triggerMarketReview({ sendNotification: notify })) },
    { label: t('mobile.home.compositeAnalysis'), icon: Layers3, action: () => dashboard.watchlistCodes.length ? run('composite', () => analysisApi.triggerCompositeAnalysis({ stockCodes: dashboard.watchlistCodes, notify, reportType: 'full' })) : setMessage('请先添加自选股') },
  ];

  return <section className="space-y-4" aria-labelledby="mobile-home-title">
    <div className="overflow-hidden rounded-3xl border border-cyan/20 bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between"><p className="text-xs font-semibold tracking-[0.16em] text-cyan">{t('mobile.home.eyebrow')}</p><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${dashboard.stale ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}>{dashboard.stale ? t('mobile.home.serviceStale') : t('mobile.home.serviceOk')}</span></div>
      <h1 id="mobile-home-title" className="mt-2 text-2xl font-black text-foreground">{t('mobile.home.title')}</h1>
      <label className="mt-4 block"><span className="sr-only">{t('mobile.home.stockCode')}</span><input aria-label={t('mobile.home.stockCode')} value={stockCode} onChange={event => setStockCode(event.target.value)} placeholder={t('mobile.home.stockPlaceholder')} className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none focus:border-cyan" /></label>
      {message ? <p role="alert" className="mt-3 text-xs text-danger">{message}</p> : null}
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        {actions.map(({ label, icon: Icon, action }) => <button key={label} type="button" disabled={busy !== null} onClick={action} className="flex min-h-14 items-center gap-2.5 rounded-2xl border border-border/70 bg-background px-3.5 text-sm font-bold text-foreground active:border-cyan active:bg-cyan/5 disabled:opacity-50"><Icon className="h-4 w-4 text-cyan" />{label}</button>)}
      </div>
    </div>
    <div className="flex items-center justify-between"><h2 className="text-base font-black">{t('mobile.home.active')}</h2><span className="text-xs text-muted-text">{t('mobile.home.activeCount', { count: active.length })}</span></div>
    {active.length ? active.slice(0, 2).map(task => <MobileTaskCard key={task.taskId} task={task} reports={dashboard.recentReports} />) : <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-text">{t('mobile.home.noActive')}</p>}
    <div className="flex items-center justify-between"><h2 className="text-base font-black">{t('mobile.home.history')}</h2><span className="text-xs text-muted-text">{t('mobile.home.historyCount', { count: dashboard.historySummary.length })}</span></div>
    {dashboard.historySummary.length ? dashboard.historySummary.slice(0, 10).map(item => <MobileHistoryCard key={`${item.stockCode}-${item.id}`} item={item} />) : <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-text">{t('mobile.home.noHistory')}</p>}
  </section>;
};
export default MobileHomePage;
