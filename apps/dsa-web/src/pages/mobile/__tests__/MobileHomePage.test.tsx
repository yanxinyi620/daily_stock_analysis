import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analysisApi } from '../../../api/analysis';
import { useMobileDashboard } from '../../../hooks/useMobileDashboard';
import MobileHomePage from '../MobileHomePage';

const navigate = vi.fn();
vi.mock('react-router-dom', async importOriginal => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useNavigate: () => navigate,
}));
vi.mock('../../../api/analysis', () => ({ analysisApi: {
  analyzeAsync: vi.fn(), triggerCompositeAnalysis: vi.fn(), triggerMarketReview: vi.fn(),
} }));
vi.mock('../../../hooks/useMobileDashboard', () => ({ useMobileDashboard: vi.fn() }));
vi.mock('../../../stores/stockPoolStore', () => ({
  useStockPoolStore: (selector: (state: { notify: boolean }) => unknown) => selector({ notify: true }),
}));

describe('MobileHomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useMobileDashboard).mockReturnValue({
      watchlistCodes: ['600519', '000858'],
      recentReports: [{ id: 7, queryId: 'q7', stockCode: '600519', stockName: '贵州茅台', analysisSummary: '趋势稳健', createdAt: '2026-08-13' }],
      stockReports: [],
      tasks: [{ taskId: 't1', stockCode: '000858', stockName: '五粮液', status: 'processing', progress: 45, reportType: 'full', createdAt: '2026-08-13' }],
      loading: false, stale: false, error: null, refresh: vi.fn(),
    });
    vi.mocked(analysisApi.analyzeAsync).mockResolvedValue({ taskId: 'new', status: 'pending' });
    vi.mocked(analysisApi.triggerCompositeAnalysis).mockResolvedValue({ taskId: 'c1', status: 'pending', message: '', stockCodes: [], notify: true, region: 'cn' });
    vi.mocked(analysisApi.triggerMarketReview).mockResolvedValue({ status: 'accepted', message: '', sendNotification: true, region: 'cn', taskId: 'm1' });
  });

  it('shows active work, watchlist, reports, and the four primary actions', () => {
    render(<MemoryRouter><MobileHomePage /></MemoryRouter>);
    expect(screen.getByText('服务正常')).toBeInTheDocument();
    expect(screen.getByText('五粮液')).toBeInTheDocument();
    expect(screen.getByText('贵州茅台')).toBeInTheDocument();
    expect(screen.getByText('1 项')).toBeInTheDocument();
    expect(screen.getByText('自选 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '个股分析' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '综合分析' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '大盘复盘' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '智能选股' })).toBeInTheDocument();
  });

  it('submits stock, composite, and market jobs with the shared notification choice', async () => {
    render(<MemoryRouter><MobileHomePage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('股票代码'), { target: { value: '600410' } });
    fireEvent.click(screen.getByRole('button', { name: '个股分析' }));
    await waitFor(() => expect(analysisApi.analyzeAsync).toHaveBeenCalledWith(expect.objectContaining({ stockCode: '600410', notify: true })));
    fireEvent.click(screen.getByRole('button', { name: '综合分析' }));
    await waitFor(() => expect(analysisApi.triggerCompositeAnalysis).toHaveBeenCalledWith(expect.objectContaining({ stockCodes: ['600519', '000858'], notify: true })));
    fireEvent.click(screen.getByRole('button', { name: '大盘复盘' }));
    await waitFor(() => expect(analysisApi.triggerMarketReview).toHaveBeenCalledWith({ sendNotification: true }));
    expect(navigate).toHaveBeenCalledWith('/m/tasks');
  });
});
