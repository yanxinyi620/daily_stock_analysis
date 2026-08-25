import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompositeTaskCard } from '../CompositeTaskCard';
import type { TaskInfo } from '../../../types/analysis';

const task: TaskInfo = {
  taskId: 'composite-1',
  stockCode: 'COMPOSITE',
  status: 'partial',
  progress: 100,
  reportType: 'composite_analysis',
  taskType: 'composite_analysis',
  createdAt: '2026-08-12T10:00:00',
  composite: {
    phase: 'completed',
    stockCodes: ['600519', '000858'],
    stockSummary: { total: 2, completed: 1, failed: 1 },
    marketReview: { status: 'completed' },
    report: { status: 'completed', historyId: 42 },
    notification: { requested: false, status: 'disabled' },
  },
};

describe('CompositeTaskCard', () => {
  it('shows stage outcomes and opens the persisted report', () => {
    const onViewReport = vi.fn();
    render(<CompositeTaskCard task={task} onViewReport={onViewReport} />);

    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByText('未启用')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看综合报告' }));
    expect(onViewReport).toHaveBeenCalledWith(42);
  });
});
