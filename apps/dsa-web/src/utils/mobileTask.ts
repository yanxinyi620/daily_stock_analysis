import type { HistoryItem, TaskInfo } from '../types/analysis';
import { includesStockCode } from './stockCode';

export interface MobileTaskGroups {
  active: TaskInfo[];
  completed: TaskInfo[];
  failed: TaskInfo[];
}

const ACTIVE_STATUSES = new Set<TaskInfo['status']>([
  'pending',
  'processing',
  'cancel_requested',
]);
const COMPLETED_STATUSES = new Set<TaskInfo['status']>(['completed', 'partial']);

export function groupMobileTasks(tasks: readonly TaskInfo[]): MobileTaskGroups {
  return tasks.reduce<MobileTaskGroups>((groups, task) => {
    if (ACTIVE_STATUSES.has(task.status)) {
      groups.active.push(task);
    } else if (COMPLETED_STATUSES.has(task.status)) {
      groups.completed.push(task);
    } else {
      groups.failed.push(task);
    }
    return groups;
  }, { active: [], completed: [], failed: [] });
}

export function getMobileTaskDestination(
  task: TaskInfo,
  recentReports: readonly HistoryItem[] = [],
): string | null {
  if (!COMPLETED_STATUSES.has(task.status)) return null;

  if (task.taskType === 'screening') return '/m/screening';

  const compositeHistoryId = task.composite?.report.historyId;
  if (compositeHistoryId) return `/m/reports/${compositeHistoryId}`;

  const report = recentReports.find(item => includesStockCode([item.stockCode], task.stockCode));
  return report ? `/m/reports/${report.id}` : null;
}
