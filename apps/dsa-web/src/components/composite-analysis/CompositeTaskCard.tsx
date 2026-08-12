import type React from 'react';
import { CheckCircle2, CircleDashed, Mail, Newspaper, Sparkles, TrendingUp } from 'lucide-react';
import type { TaskInfo } from '../../types/analysis';

type Props = {
  task: TaskInfo;
  onViewReport?: (historyId: number) => void;
};

const stageLabel = (status?: string) => {
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'disabled') return '未启用';
  if (status === 'processing') return '进行中';
  return '等待中';
};

export const CompositeTaskCard: React.FC<Props> = ({ task, onViewReport }) => {
  const state = task.composite;
  if (!state) return null;
  const terminal = ['completed', 'partial', 'failed', 'cancelled'].includes(task.status);
  const historyId = state.report.historyId;
  const stages = [
    { icon: TrendingUp, label: '个股分析', value: `${state.stockSummary.completed}/${state.stockSummary.total}`, status: state.phase === 'stocks' ? 'processing' : (state.stockSummary.completed + state.stockSummary.failed >= state.stockSummary.total ? 'completed' : 'pending') },
    { icon: Newspaper, label: '大盘复盘', value: stageLabel(state.marketReview.status), status: state.marketReview.status },
    { icon: Sparkles, label: '综合报告', value: stageLabel(state.report.status), status: state.report.status },
    { icon: Mail, label: '邮件通知', value: stageLabel(state.notification.status), status: state.notification.status },
  ];

  return (
    <section className="mb-3 rounded-2xl border border-primary/25 bg-primary/[0.045] p-4 shadow-sm" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            综合分析
          </div>
          <p className="mt-1 text-xs text-secondary-text">{task.message ?? '正在执行组合任务'}</p>
        </div>
        {terminal && historyId && onViewReport ? (
          <button type="button" className="btn-primary h-9 px-4 text-xs" onClick={() => onViewReport(historyId)}>
            查看综合报告
          </button>
        ) : null}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted/60" role="progressbar" aria-valuenow={task.progress} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${task.progress}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {stages.map(({ icon: Icon, label, value, status }) => (
          <div key={label} className="flex items-center gap-2 rounded-xl border border-subtle bg-surface/65 px-3 py-2">
            {status === 'completed' ? <CheckCircle2 className="h-4 w-4 text-success" /> : <CircleDashed className={`h-4 w-4 ${status === 'processing' ? 'animate-spin text-primary' : 'text-muted-text'}`} />}
            <Icon className="hidden h-4 w-4 text-secondary-text sm:block" aria-hidden="true" />
            <span className="min-w-0"><span className="block truncate text-xs text-secondary-text">{label}</span><span className="block text-xs font-medium text-foreground">{value}</span></span>
          </div>
        ))}
      </div>
    </section>
  );
};
