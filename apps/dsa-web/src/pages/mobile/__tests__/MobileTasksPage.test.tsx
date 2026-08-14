import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useMobileDashboard } from '../../../hooks/useMobileDashboard';
import MobileTasksPage from '../MobileTasksPage';

vi.mock('../../../hooks/useMobileDashboard', () => ({ useMobileDashboard: vi.fn() }));

describe('MobileTasksPage', () => {
  it('groups task states, displays progress and errors, and refreshes', () => {
    const refresh = vi.fn();
    vi.mocked(useMobileDashboard).mockReturnValue({
      watchlistCodes: [], recentReports: [], stockReports: [], loading: false, stale: false, error: null, refresh,
      tasks: [
        { taskId: 'a', stockCode: '600519', status: 'processing', progress: 42, reportType: 'full', createdAt: '2026' },
        { taskId: 'b', stockCode: '000858', status: 'completed', progress: 100, reportType: 'full', createdAt: '2026' },
        { taskId: 'c', stockCode: '600410', status: 'failed', progress: 20, error: '模型超时', reportType: 'full', createdAt: '2026' },
      ],
    });
    render(<MemoryRouter><MobileTasksPage /></MemoryRouter>);
    expect(screen.getByText('进行中')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.getByText('模型超时')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新任务' }));
    expect(refresh).toHaveBeenCalled();
  });
});
