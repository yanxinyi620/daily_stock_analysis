import { useCallback, useEffect, useRef, useState } from 'react';
import { analysisApi } from '../api/analysis';
import { historyApi } from '../api/history';
import { systemConfigApi } from '../api/systemConfig';
import type { HistoryItem, StockBarItem, TaskInfo } from '../types/analysis';

export interface MobileDashboardState {
  watchlistCodes: string[];
  recentReports: HistoryItem[];
  stockReports: StockBarItem[];
  tasks: TaskInfo[];
  loading: boolean;
  stale: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useMobileDashboard(): MobileDashboardState {
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const [watchlistCodes, setWatchlistCodes] = useState<string[]>([]);
  const [recentReports, setRecentReports] = useState<HistoryItem[]>([]);
  const [stockReports, setStockReports] = useState<StockBarItem[]>([]);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current;
    const [watchlistResult, reportsResult, stockReportsResult, tasksResult] = await Promise.allSettled([
      systemConfigApi.getWatchlist(),
      historyApi.getList({ page: 1, limit: 6 }),
      historyApi.getStockBarList({ limit: 500 }),
      analysisApi.getTasks({ limit: 50 }),
    ]);

    if (!mountedRef.current || requestId !== requestRef.current) return;

    if (watchlistResult.status === 'fulfilled') setWatchlistCodes(watchlistResult.value);
    if (reportsResult.status === 'fulfilled') setRecentReports(reportsResult.value.items);
    if (stockReportsResult.status === 'fulfilled') setStockReports(stockReportsResult.value.items);
    if (tasksResult.status === 'fulfilled') setTasks(tasksResult.value.tasks);

    const hasFailure = [watchlistResult, reportsResult, stockReportsResult, tasksResult]
      .some(result => result.status === 'rejected');
    setStale(hasFailure);
    setError(hasFailure ? '部分移动端数据暂时无法刷新' : null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void Promise.resolve()
      .then(refresh)
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, [refresh]);

  return {
    watchlistCodes,
    recentReports,
    stockReports,
    tasks,
    loading,
    stale,
    error,
    refresh,
  };
}
