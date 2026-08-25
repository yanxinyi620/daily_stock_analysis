import apiClient from './index';
import { toCamelCase } from './utils';
import type {
  BacktestRunRequest,
  BacktestRunResponse,
  BacktestResultsResponse,
  BacktestResultItem,
  PerformanceMetrics,
  BacktestPhaseFilter,
  BacktestTaskAccepted,
  BacktestTaskStatus,
  BacktestRunHistoryResponse,
} from '../types/backtest';

const BACKTEST_POLL_INTERVAL_MS = 750;

function buildRunPayload(params: BacktestRunRequest): Record<string, unknown> {
  const requestData: Record<string, unknown> = {};
  if (params.code?.trim()) requestData.code = params.code.trim();
  if (params.force) requestData.force = params.force;
  if (params.evalWindowDays != null) requestData.eval_window_days = params.evalWindowDays;
  if (params.minAgeDays != null) requestData.min_age_days = params.minAgeDays;
  if (params.analysisDateFrom) requestData.analysis_date_from = params.analysisDateFrom;
  if (params.analysisDateTo) requestData.analysis_date_to = params.analysisDateTo;
  if (params.limit != null) requestData.limit = params.limit;
  return requestData;
}

const waitForNextPoll = () => new Promise<void>((resolve) => {
  window.setTimeout(resolve, BACKTEST_POLL_INTERVAL_MS);
});

async function waitForBacktestTask(taskId: string): Promise<BacktestRunResponse> {
  while (true) {
    const statusResponse = await apiClient.get<Record<string, unknown>>(
      `/api/v1/backtest/tasks/${encodeURIComponent(taskId)}`,
    );
    const status = toCamelCase<BacktestTaskStatus>(statusResponse.data);
    if (status.status === 'completed' && status.result) return status.result;
    if (status.status === 'completed') throw new Error('回测任务已完成，但未返回结果');
    if (status.status === 'failed') throw new Error(status.error || status.message || '回测任务执行失败');
    await waitForNextPoll();
  }
}

// ============ API ============

export const backtestApi = {
  getRuns: async (params: { page?: number; limit?: number } = {}): Promise<BacktestRunHistoryResponse> => {
    const queryParams = { page: params.page ?? 1, limit: params.limit ?? 20 };
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/backtest/runs', {
      params: queryParams,
    });
    return toCamelCase<BacktestRunHistoryResponse>(response.data);
  },

  getCurrentTask: async (): Promise<BacktestTaskStatus | null> => {
    const response = await apiClient.get<Record<string, unknown> | null>(
      '/api/v1/backtest/tasks/current',
    );
    return toCamelCase<BacktestTaskStatus | null>(response.data);
  },

  waitForTask: waitForBacktestTask,

  /**
   * Trigger backtest evaluation
   */
  run: async (params: BacktestRunRequest = {}): Promise<BacktestRunResponse> => {
    const acceptedResponse = await apiClient.post<Record<string, unknown>>(
      '/api/v1/backtest/tasks',
      buildRunPayload(params),
    );
    const accepted = toCamelCase<BacktestTaskAccepted>(acceptedResponse.data);

    return waitForBacktestTask(accepted.taskId);
  },

  /**
   * Get paginated backtest results
   */
  getResults: async (params: {
    code?: string;
    evalWindowDays?: number;
    analysisDateFrom?: string;
    analysisDateTo?: string;
    analysisPhase?: BacktestPhaseFilter;
    page?: number;
    limit?: number;
  } = {}): Promise<BacktestResultsResponse> => {
    const { code, evalWindowDays, analysisDateFrom, analysisDateTo, analysisPhase, page = 1, limit = 20 } = params;

    const queryParams: Record<string, string | number> = { page, limit };
    if (code) queryParams.code = code;
    if (evalWindowDays) queryParams.eval_window_days = evalWindowDays;
    if (analysisDateFrom) queryParams.analysis_date_from = analysisDateFrom;
    if (analysisDateTo) queryParams.analysis_date_to = analysisDateTo;
    if (analysisPhase && analysisPhase !== 'all') queryParams.analysis_phase = analysisPhase;

    const response = await apiClient.get<Record<string, unknown>>(
      '/api/v1/backtest/results',
      { params: queryParams },
    );

    const data = toCamelCase<BacktestResultsResponse>(response.data);
    return {
      total: data.total,
      page: data.page,
      limit: data.limit,
      items: (data.items || []).map(item => toCamelCase<BacktestResultItem>(item)),
    };
  },

  /**
   * Get overall performance metrics
   */
  getOverallPerformance: async (params: {
    evalWindowDays?: number;
    analysisDateFrom?: string;
    analysisDateTo?: string;
    analysisPhase?: BacktestPhaseFilter;
  } = {}): Promise<PerformanceMetrics | null> => {
    try {
      const queryParams: Record<string, string | number> = {};
      if (params.evalWindowDays) queryParams.eval_window_days = params.evalWindowDays;
      if (params.analysisDateFrom) queryParams.analysis_date_from = params.analysisDateFrom;
      if (params.analysisDateTo) queryParams.analysis_date_to = params.analysisDateTo;
      if (params.analysisPhase && params.analysisPhase !== 'all') queryParams.analysis_phase = params.analysisPhase;
      const response = await apiClient.get<Record<string, unknown>>(
        '/api/v1/backtest/performance',
        { params: queryParams },
      );
      return toCamelCase<PerformanceMetrics>(response.data);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { status?: number } };
        if (axiosErr.response?.status === 404) return null;
      }
      throw err;
    }
  },

  /**
   * Get per-stock performance metrics
   */
  getStockPerformance: async (code: string, params: {
    evalWindowDays?: number;
    analysisDateFrom?: string;
    analysisDateTo?: string;
    analysisPhase?: BacktestPhaseFilter;
  } = {}): Promise<PerformanceMetrics | null> => {
    try {
      const queryParams: Record<string, string | number> = {};
      if (params.evalWindowDays) queryParams.eval_window_days = params.evalWindowDays;
      if (params.analysisDateFrom) queryParams.analysis_date_from = params.analysisDateFrom;
      if (params.analysisDateTo) queryParams.analysis_date_to = params.analysisDateTo;
      if (params.analysisPhase && params.analysisPhase !== 'all') queryParams.analysis_phase = params.analysisPhase;
      const response = await apiClient.get<Record<string, unknown>>(
        `/api/v1/backtest/performance/${encodeURIComponent(code)}`,
        { params: queryParams },
      );
      return toCamelCase<PerformanceMetrics>(response.data);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { status?: number } };
        if (axiosErr.response?.status === 404) return null;
      }
      throw err;
    }
  },
};
