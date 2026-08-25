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
  limit: 10,
  items: [{ id: 9, queryId: 'q-9', stockCode: '600519', createdAt: '2026-08-13T10:00:00Z' }],
};
const compositeReports = {
  total: 1,
  page: 1,
  limit: 1,
  items: [{
    id: 40,
    queryId: 'q-40',
    stockCode: 'COMPOSITE',
    stockName: '今日综合分析',
    reportType: 'composite_analysis',
    createdAt: '2026-08-14T09:00:00Z',
    action: 'hold',
  }],
};
const marketReports = {
  total: 1,
  page: 1,
  limit: 1,
  items: [{
    id: 41,
    queryId: 'q-41',
    stockCode: 'MARKET',
    stockName: '大盘复盘',
    reportType: 'market_review',
    createdAt: '2026-08-14T08:00:00Z',
  }],
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
    vi.mocked(historyApi.getList).mockImplementation(params => {
      if (params?.reportType === 'composite_analysis') return Promise.resolve(compositeReports);
      if (params?.reportType === 'market_review') return Promise.resolve(marketReports);
      return Promise.resolve(reports);
    });
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
    expect(historyApi.getList).toHaveBeenCalledWith({ page: 1, limit: 10 });
    expect(historyApi.getList).toHaveBeenCalledWith({ page: 1, limit: 1, reportType: 'composite_analysis' });
    expect(historyApi.getList).toHaveBeenCalledWith({ page: 1, limit: 1, reportType: 'market_review' });
    expect(historyApi.getStockBarList).toHaveBeenCalledWith({ limit: 500 });
    expect(analysisApi.getTasks).toHaveBeenCalledWith({ limit: 50 });
    expect(result.current.stale).toBe(false);
  });

  it('builds a history summary with the latest composite, market review, and stock reports deduplicated by category', async () => {
    const { result } = renderHook(() => useMobileDashboard());

    await waitFor(() => expect(result.current.loading).toBe(false));

    const summary = result.current.historySummary;
    expect(summary.length).toBe(3);
    expect(summary[0].stockCode).toBe('600519');
    expect(summary[0].stockName).toBe('贵州茅台');
    expect(summary[0].queryId).toBe('31');
    expect(summary[1].stockCode).toBe('COMPOSITE');
    expect(summary[2].stockCode).toBe('MARKET');
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
    expect(result.current.historySummary.length).toBe(3);
    expect(result.current.stale).toBe(true);
    expect(result.current.error).toBe('部分移动端数据暂时无法刷新');
    expect(systemConfigApi.getWatchlist).toHaveBeenCalledTimes(2);
  });
});
