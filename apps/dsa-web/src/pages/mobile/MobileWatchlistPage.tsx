import { Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { analysisApi } from '../../api/analysis';
import { MobileStockCard } from '../../components/mobile/MobileStockCard';
import { useMobileDashboard } from '../../hooks/useMobileDashboard';
import { useWatchlist } from '../../hooks/useWatchlist';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { useStockPoolStore } from '../../stores/stockPoolStore';
import { findMatchingStockCode } from '../../utils/stockCode';

const MobileWatchlistPage = () => {
  const watchlist = useWatchlist();
  const { t } = useUiLanguage();
  const dashboard = useMobileDashboard();
  const notify = useStockPoolStore(state => state.notify);
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (stockCode: string) => {
    setMessage(null);
    try {
      await analysisApi.analyzeAsync({ stockCode, reportType: 'full', notify });
      navigate('/m/tasks');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '分析提交失败');
    }
  };
  const submitBatch = async (stockCodes: string[]) => {
    if (!stockCodes.length) { setMessage('没有需要分析的股票'); return; }
    setMessage(null);
    try {
      await analysisApi.analyzeAsync({ stockCodes, reportType: 'full', notify });
      navigate('/m/tasks');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '批量分析提交失败');
    }
  };
  const add = async () => {
    if (!code.trim()) return;
    await watchlist.addToWatchlist(code.trim());
    setCode('');
  };

  return <section className="space-y-4" aria-labelledby="mobile-watchlist-title">
    <header className="flex items-end justify-between"><div><p className="text-xs font-semibold tracking-[0.16em] text-cyan">WATCHLIST</p><h1 id="mobile-watchlist-title" className="mt-1 text-2xl font-black">{t('mobile.watchlist.title')}</h1></div><button type="button" aria-label={t('mobile.watchlist.title')} onClick={() => void Promise.all([watchlist.refresh(), dashboard.refresh()])} className="grid min-h-11 min-w-11 place-items-center rounded-2xl border border-border bg-card"><RefreshCw className="h-4 w-4" /></button></header>
    <div className="flex gap-2 rounded-2xl border border-border bg-card p-2">
      <label className="min-w-0 flex-1"><span className="sr-only">{t('mobile.watchlist.addCode')}</span><input aria-label={t('mobile.watchlist.addCode')} value={code} onChange={event => setCode(event.target.value)} placeholder={t('mobile.home.stockPlaceholder')} className="h-11 w-full bg-transparent px-2 text-sm outline-none" /></label>
      <button type="button" aria-label={t('mobile.watchlist.add')} onClick={() => void add()} className="grid min-h-11 min-w-11 place-items-center rounded-xl bg-cyan text-primary-foreground"><Plus className="h-5 w-5" /></button>
    </div>
    <div className="grid grid-cols-2 gap-2"><button type="button" aria-label={t('mobile.watchlist.analyzeAll')} onClick={() => void submitBatch(watchlist.watchlistCodes)} className="min-h-11 rounded-2xl border border-cyan/30 bg-cyan/5 px-3 text-sm font-bold text-cyan">{t('mobile.watchlist.analyzeAll')}</button><button type="button" aria-label={t('mobile.watchlist.analyzePending')} onClick={() => void submitBatch(watchlist.watchlistCodes.filter(stockCode => !dashboard.stockReports.some(item => findMatchingStockCode([item.stockCode], stockCode))))} className="min-h-11 rounded-2xl border border-border bg-card px-3 text-sm font-bold text-foreground">{t('mobile.watchlist.analyzePending')}</button></div>
    {watchlist.actionMessage || message ? <p role="status" className="text-xs text-secondary-text">{message || watchlist.actionMessage}</p> : null}
    <div className="space-y-2.5">
      {watchlist.watchlistCodes.map(stockCode => {
        const recentReport = dashboard.recentReports.find(item => findMatchingStockCode([item.stockCode], stockCode));
        const stockReport = dashboard.stockReports.find(item => findMatchingStockCode([item.stockCode], stockCode));
        return <MobileStockCard key={stockCode} stockCode={stockCode} stockName={recentReport?.stockName ?? stockReport?.stockName} summary={stockReport?.operationAdvice ?? recentReport?.analysisSummary} reportId={recentReport?.id ?? stockReport?.id} onAnalyze={() => void submit(stockCode)} onRemove={() => void watchlist.removeFromWatchlist(stockCode)} />;
      })}
      {!watchlist.isLoading && !watchlist.watchlistCodes.length ? <p className="rounded-2xl border border-dashed border-border p-5 text-center text-sm text-muted-text">{t('mobile.watchlist.empty')}</p> : null}
    </div>
  </section>;
};
export default MobileWatchlistPage;
