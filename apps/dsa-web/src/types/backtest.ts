/**
 * Backtest API type definitions
 * Mirrors api/v1/schemas/backtest.py
 */
import type { DecisionAction, MarketPhaseSummary } from './analysis';

// ============ Request / Response ============

export type BacktestAnalysisPhase = 'premarket' | 'intraday' | 'postmarket' | 'unknown';
export type BacktestPhaseFilter = BacktestAnalysisPhase | 'all';

export interface BacktestRunRequest {
  code?: string;
  force?: boolean;
  evalWindowDays?: number;
  minAgeDays?: number;
  analysisDateFrom?: string;
  analysisDateTo?: string;
  limit?: number;
}

export interface BacktestRunResponse {
  processed: number;
  saved: number;
  completed: number;
  insufficient: number;
  errors: number;
  appliedEvalWindowDays?: number;
  message?: string | null;
  diagnostics?: Record<string, unknown>;
}

export interface BacktestTaskAccepted {
  taskId: string;
  status: string;
  message?: string | null;
  reused: boolean;
}

export interface BacktestTaskStatus {
  taskId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  message?: string | null;
  error?: string | null;
  result?: BacktestRunResponse | null;
}

export interface BacktestRunHistoryItem {
  runId: string;
  taskId?: string | null;
  source: string;
  status: string;
  code?: string | null;
  force: boolean;
  evalWindowDays?: number | null;
  minAgeDays?: number | null;
  analysisDateFrom?: string | null;
  analysisDateTo?: string | null;
  limit: number;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  processed?: number | null;
  saved?: number | null;
  completed?: number | null;
  insufficient?: number | null;
  errors?: number | null;
  message?: string | null;
  diagnostics: Record<string, unknown>;
  error?: string | null;
}

export interface BacktestRunHistoryResponse {
  total: number;
  page: number;
  limit: number;
  items: BacktestRunHistoryItem[];
}

// ============ Result Item ============

export interface BacktestResultItem {
  analysisHistoryId: number;
  code: string;
  stockName?: string;
  analysisDate?: string;
  evalWindowDays: number;
  engineVersion: string;
  evalStatus: string;
  evaluatedAt?: string;
  operationAdvice?: string;
  action?: DecisionAction | null;
  actionLabel?: string | null;
  trendPrediction?: string;
  marketPhase?: string | null;
  marketPhaseSummary?: MarketPhaseSummary | null;
  positionRecommendation?: string;
  startPrice?: number;
  endClose?: number;
  maxHigh?: number;
  minLow?: number;
  stockReturnPct?: number;
  actualReturnPct?: number;
  actualMovement?: string;
  directionExpected?: string;
  directionCorrect?: boolean;
  outcome?: string;
  stopLoss?: number;
  takeProfit?: number;
  hitStopLoss?: boolean;
  hitTakeProfit?: boolean;
  firstHit?: string;
  firstHitDate?: string;
  firstHitTradingDays?: number;
  simulatedEntryPrice?: number;
  simulatedExitPrice?: number;
  simulatedExitReason?: string;
  simulatedReturnPct?: number;
}

export interface BacktestResultsResponse {
  total: number;
  page: number;
  limit: number;
  items: BacktestResultItem[];
}

// ============ Performance Metrics ============

export interface PerformanceMetrics {
  scope: string;
  code?: string;
  evalWindowDays: number;
  engineVersion: string;
  computedAt?: string;

  totalEvaluations: number;
  completedCount: number;
  insufficientCount: number;
  longCount: number;
  cashCount: number;
  winCount: number;
  lossCount: number;
  neutralCount: number;

  directionAccuracyPct?: number;
  winRatePct?: number;
  neutralRatePct?: number;
  avgStockReturnPct?: number;
  avgSimulatedReturnPct?: number;

  stopLossTriggerRate?: number;
  takeProfitTriggerRate?: number;
  ambiguousRate?: number;
  avgDaysToFirstHit?: number;

  adviceBreakdown: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
}
