import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analysisApi } from '../../api/analysis';
import { historyApi } from '../../api/history';
import { systemConfigApi } from '../../api/systemConfig';
import { useMobileDashboard } from '../useMobileDashboard';

vi.mock('../../api/analysis', () => ({ analysisApi: { getTasks: vi.fn() } }));
vi.mock('../../api/history', () => ({ historyApi: { getList: vi.fn(), getStockBarList: vi.fn() } }));
vi.mock('../../api/systemConfig', () => ({ systemConfigApi: { getWatchlist: vi.fn() } }));

const reports = {
  total: 1,
  page: 1,
  limit: 6,
  items: [{ id: 9, queryId: 'q-9', stockCode: '600519', createdAt: '2026-08-13T10:00:00Z' }],
};
const stockReports = {
  total: 1,
  items: [{
    id: 31,
    stockCode: '600519',
    stockName: '贵州茅台',
    operationAdvice: '趋势稳健',
    analysisCount: 3,
    lastAnalysisTime: '2026-08-14T12:48:55Z',
  }],
};
const tasks = {
  total: 1,
  pending: 0,
  processing: 1,
  tasks: [{
    taskId: 'task-9', stockCode: '600519', status: 'processing' as const, progress: 35,
    reportType: 'full', createdAt: '2026-08-13T10:01:00Z',
  }],
};

describe('useMobileDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(systemConfigApi.getWatchlist).mockResolvedValue(['600519']);
    vi.mocked(historyApi.getList).mockResolvedValue(reports);
    vi.mocked(historyApi.getStockBarList).mockResolvedValue(stockReports);
    vi.mocked(analysisApi.getTasks).mockResolvedValue(tasks);
  });

  it('loads watchlist, recent reports, per-stock reports, and tasks in parallel', async () => {
    const { result } = renderHook(() => useMobileDashboard());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.watchlistCodes).toEqual(['600519']);
    expect(result.current.recentReports).toEqual(reports.items);
    expect(result.current.stockReports).toEqual(stockReports.items);
    expect(result.current.tasks).toEqual(tasks.tasks);
    expect(historyApi.getList).toHaveBeenCalledWith({ page: 1, limit: 6 });
    expect(historyApi.getStockBarList).toHaveBeenCalledWith({ limit: 500 });
    expect(analysisApi.getTasks).toHaveBeenCalledWith({ limit: 50 });
    expect(result.current.stale).toBe(false);
  });

  it('keeps existing data and marks it stale when an explicit refresh fails', async () => {
    const { result } = renderHook(() => useMobileDashboard());
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.mocked(historyApi.getList).mockRejectedValueOnce(new Error('offline'));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.recentReports).toEqual(reports.items);
    expect(result.current.watchlistCodes).toEqual(['600519']);
    expect(result.current.stale).toBe(true);
    expect(result.current.error).toBe('部分移动端数据暂时无法刷新');
    expect(systemConfigApi.getWatchlist).toHaveBeenCalledTimes(2);
  });
});
