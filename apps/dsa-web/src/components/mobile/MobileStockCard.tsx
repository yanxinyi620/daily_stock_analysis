import { ChevronRight, Play, Trash2 } from 'lucide-react';
import type React from 'react';
import { Link } from 'react-router-dom';

interface MobileStockCardProps {
  stockCode: string;
  stockName?: string;
  summary?: string;
  reportId?: number;
  onAnalyze?: () => void;
  onRemove?: () => void;
}

export const MobileStockCard: React.FC<MobileStockCardProps> = ({
  stockCode, stockName, summary, reportId, onAnalyze, onRemove,
}) => (
  <article className="rounded-2xl border border-border/70 bg-card px-4 py-3.5 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="truncate text-[15px] font-bold text-foreground">{stockName || stockCode}</h3>
        <p className="mt-0.5 font-mono text-xs text-muted-text">{stockCode}</p>
      </div>
      <div className="flex gap-1">
        {onAnalyze ? (
          <button type="button" aria-label={`分析 ${stockCode}`} onClick={onAnalyze} className="grid min-h-11 min-w-11 place-items-center rounded-xl text-cyan active:bg-cyan/10">
            <Play className="h-4 w-4" />
          </button>
        ) : null}
        {onRemove ? (
          <button type="button" aria-label={`移除 ${stockCode}`} onClick={onRemove} className="grid min-h-11 min-w-11 place-items-center rounded-xl text-danger active:bg-danger/10">
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
    {summary ? <p className="mt-3 line-clamp-2 text-sm leading-6 text-secondary-text">{summary}</p> : null}
    {reportId ? (
      <Link aria-label={`查看 ${stockCode} 报告`} to={`/m/reports/${reportId}`} className="mt-3 flex min-h-11 items-center justify-between border-t border-border/60 pt-3 text-sm font-semibold text-cyan">
        查看报告 <ChevronRight className="h-4 w-4" />
      </Link>
    ) : null}
  </article>
);
