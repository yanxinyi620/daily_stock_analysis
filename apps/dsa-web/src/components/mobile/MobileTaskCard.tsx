import { ChevronRight } from 'lucide-react';
import type React from 'react';
import { Link } from 'react-router-dom';
import type { HistoryItem, TaskInfo } from '../../types/analysis';
import { getMobileTaskDestination } from '../../utils/mobileTask';

export const MobileTaskCard: React.FC<{ task: TaskInfo; reports?: HistoryItem[] }> = ({ task, reports = [] }) => {
  const destination = getMobileTaskDestination(task, reports);
  return (
    <article className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-foreground">{task.stockName || task.stockCode || '综合分析'}</h3>
          <p className="mt-1 text-xs text-muted-text">{task.taskType === 'composite_analysis' ? '综合分析' : task.reportType}</p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-secondary-text">{task.progress}%</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-cyan transition-[width]" style={{ width: `${Math.max(0, Math.min(100, task.progress))}%` }} />
      </div>
      {task.error ? <p className="mt-3 rounded-xl bg-danger/8 px-3 py-2 text-xs leading-5 text-danger">{task.error}</p> : null}
      {destination ? <Link to={destination} className="mt-3 flex min-h-11 items-center justify-between border-t border-border/60 pt-3 text-sm font-semibold text-cyan">查看结果 <ChevronRight className="h-4 w-4" /></Link> : null}
    </article>
  );
};
