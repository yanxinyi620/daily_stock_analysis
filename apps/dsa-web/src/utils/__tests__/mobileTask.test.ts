import { describe, expect, it } from 'vitest';
import type { HistoryItem, TaskInfo } from '../../types/analysis';
import { getMobileTaskDestination, groupMobileTasks } from '../mobileTask';

const task = (overrides: Partial<TaskInfo>): TaskInfo => ({
  taskId: 'task-1',
  stockCode: '600519',
  status: 'pending',
  progress: 0,
  reportType: 'full',
  createdAt: '2026-08-13T10:00:00Z',
  ...overrides,
});

describe('mobile task helpers', () => {
  it('groups active, completed, and failed tasks without changing their order', () => {
    const tasks = [
      task({ taskId: 'processing', status: 'processing' }),
      task({ taskId: 'completed', status: 'completed' }),
      task({ taskId: 'partial', status: 'partial' }),
      task({ taskId: 'failed', status: 'failed' }),
      task({ taskId: 'cancelled', status: 'cancelled' }),
      task({ taskId: 'cancel-requested', status: 'cancel_requested' }),
    ];

    const grouped = groupMobileTasks(tasks);

    expect(grouped.active.map(item => item.taskId)).toEqual(['processing', 'cancel-requested']);
    expect(grouped.completed.map(item => item.taskId)).toEqual(['completed', 'partial']);
    expect(grouped.failed.map(item => item.taskId)).toEqual(['failed', 'cancelled']);
  });

  it('routes completed composite, screening, and stock tasks to their mobile results', () => {
    const reports: HistoryItem[] = [{
      id: 52,
      queryId: 'query-1',
      stockCode: '600519.SH',
      createdAt: '2026-08-13T10:05:00Z',
    }];

    expect(getMobileTaskDestination(task({
      status: 'completed',
      taskType: 'composite_analysis',
      composite: {
        phase: 'completed',
        stockCodes: ['600519'],
        stockSummary: { total: 1, completed: 1, failed: 0 },
        marketReview: { status: 'completed' },
        report: { status: 'completed', historyId: 88 },
        notification: { requested: false, status: 'skipped' },
      },
    }), reports)).toBe('/m/reports/88');
    expect(getMobileTaskDestination(task({ status: 'completed', taskType: 'screening' }), reports))
      .toBe('/m/screening');
    expect(getMobileTaskDestination(task({ status: 'completed' }), reports)).toBe('/m/reports/52');
    expect(getMobileTaskDestination(task({ status: 'processing' }), reports)).toBeNull();
  });
});
