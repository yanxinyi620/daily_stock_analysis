import type { HistoryItem, StockBarItem } from '../types/analysis';
import { normalizeStockCode } from './stockCode';

const COMPOSITE_KEY = 'COMPOSITE';
const MARKET_KEY = 'MARKET';

export const HISTORY_SUMMARY_LIMIT = 10;

export function historyCategoryKey(item: Pick<HistoryItem, 'stockCode' | 'reportType'>): string {
  if (item.stockCode === COMPOSITE_KEY || item.reportType === 'composite_analysis') return COMPOSITE_KEY;
  if (item.stockCode === MARKET_KEY || item.reportType === 'market_review') return MARKET_KEY;
  const normalized = normalizeStockCode(item.stockCode || '').toUpperCase();
  return normalized || item.stockCode || 'UNKNOWN';
}

export function stockBarToHistoryItem(item: StockBarItem): HistoryItem {
  return {
    id: item.id,
    queryId: String(item.id),
    stockCode: item.stockCode,
    stockName: item.stockName,
    reportType: item.reportType as HistoryItem['reportType'] | undefined,
    sentimentScore: item.sentimentScore,
    operationAdvice: item.operationAdvice,
    action: item.action,
    actionLabel: item.actionLabel,
    marketPhaseSummary: item.marketPhaseSummary,
    createdAt: item.lastAnalysisTime ?? '',
  };
}

/**
 * Builds the mobile home history summary: for each category (composite analysis,
 * market review, and each individual stock) only the latest record is kept,
 * then the combined result is sorted by time and truncated.
 */
export function buildLatestHistorySummary(
  latestComposite: HistoryItem | undefined,
  latestMarketReview: HistoryItem | undefined,
  stockBar: readonly StockBarItem[],
  max: number = HISTORY_SUMMARY_LIMIT,
): HistoryItem[] {
  const latestByKey = new Map<string, HistoryItem>();
  const upsert = (item: HistoryItem) => {
    if (!item?.id) return;
    const key = historyCategoryKey(item);
    const existing = latestByKey.get(key);
    if (!existing || Date.parse(item.createdAt || '') >= Date.parse(existing.createdAt || '')) {
      latestByKey.set(key, item);
    }
  };

  if (latestComposite) upsert(latestComposite);
  if (latestMarketReview) upsert(latestMarketReview);
  for (const stock of stockBar) upsert(stockBarToHistoryItem(stock));

  return [...latestByKey.values()]
    .sort((left, right) => Date.parse(right.createdAt || '') - Date.parse(left.createdAt || ''))
    .slice(0, max);
}