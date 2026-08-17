import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { analysisApi } from '../../../api/analysis';
import { useMobileDashboard } from '../../../hooks/useMobileDashboard';
import { useWatchlist } from '../../../hooks/useWatchlist';
import MobileWatchlistPage from '../MobileWatchlistPage';

vi.mock('../../../api/analysis', () => ({ analysisApi: { analyzeAsync: vi.fn() } }));
vi.mock('../../../hooks/useMobileDashboard', () => ({ useMobileDashboard: vi.fn() }));
vi.mock('../../../hooks/useWatchlist', () => ({ useWatchlist: vi.fn() }));
vi.mock('../../../stores/stockPoolStore', () => ({
  useStockPoolStore: (selector: (state: { notify: boolean }) => unknown) => selector({ notify: false }),
}));

describe('MobileWatchlistPage', () => {
  it('adds, removes, analyzes stocks and links available reports', async () => {
    const addToWatchlist = vi.fn();
    const removeFromWatchlist = vi.fn();
    vi.mocked(useWatchlist).mockReturnValue({
      watchlistCodes: ['600519'], isLoading: false, isActioning: false, actionMessage: null,
      isInWatchlist: vi.fn(), addToWatchlist, removeFromWatchlist, toggleWatchlist: vi.fn(), refresh: vi.fn(),
    });
    vi.mocked(useMobileDashboard).mockReturnValue({
      watchlistCodes: ['600519'], tasks: [], historySummary: [], loading: false, stale: false, error: null, refresh: vi.fn(),
      recentReports: [{ id: 12, queryId: 'q', stockCode: '600519.SH', stockName: '贵州茅台', analysisSummary: '基本面稳健，短期震荡', createdAt: '2026' }],
      stockReports: [{ id: 12, stockCode: '600519.SH', stockName: '贵州茅台', operationAdvice: '持有观察', analysisCount: 1 }],
    });
    vi.mocked(analysisApi.analyzeAsync).mockResolvedValue({ taskId: 't', status: 'pending' });
    render(<MemoryRouter><MobileWatchlistPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('添加自选代码'), { target: { value: '000858' } });
    fireEvent.click(screen.getByRole('button', { name: '添加自选' }));
    await waitFor(() => expect(addToWatchlist).toHaveBeenCalledWith('000858'));
    fireEvent.click(screen.getByRole('button', { name: '移除 600519' }));
    expect(removeFromWatchlist).toHaveBeenCalledWith('600519');
    fireEvent.click(screen.getByRole('button', { name: '分析 600519' }));
    await waitFor(() => expect(analysisApi.analyzeAsync).toHaveBeenCalledWith(expect.objectContaining({ stockCode: '600519', notify: false })));
    expect(screen.getByRole('link', { name: '查看 600519 报告' })).toHaveAttribute('href', '/m/reports/12');
    expect(screen.getByText('持有观察')).toBeInTheDocument();
    expect(screen.queryByText('基本面稳健，短期震荡')).not.toBeInTheDocument();
  });

  it('submits all watchlist stocks or only stocks without a report', async () => {
    vi.mocked(useWatchlist).mockReturnValue({
      watchlistCodes: ['600519', '000858'], isLoading: false, isActioning: false, actionMessage: null,
      isInWatchlist: vi.fn(), addToWatchlist: vi.fn(), removeFromWatchlist: vi.fn(), toggleWatchlist: vi.fn(), refresh: vi.fn(),
    });
    vi.mocked(useMobileDashboard).mockReturnValue({
      watchlistCodes: ['600519', '000858'], tasks: [], historySummary: [], loading: false, stale: false, error: null, refresh: vi.fn(),
      recentReports: [],
      stockReports: [{ id: 12, stockCode: '600519', analysisCount: 1 }],
    });
    vi.mocked(analysisApi.analyzeAsync).mockResolvedValue({ accepted: [], duplicates: [], message: '' });
    render(<MemoryRouter><MobileWatchlistPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '分析全部' }));
    await waitFor(() => expect(analysisApi.analyzeAsync).toHaveBeenCalledWith(expect.objectContaining({ stockCodes: ['600519', '000858'] })));
    fireEvent.click(screen.getByRole('button', { name: '仅分析未完成' }));
    await waitFor(() => expect(analysisApi.analyzeAsync).toHaveBeenLastCalledWith(expect.objectContaining({ stockCodes: ['000858'] })));
  });
});
