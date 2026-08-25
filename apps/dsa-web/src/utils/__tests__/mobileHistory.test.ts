import { describe, expect, it } from 'vitest';
import type { HistoryItem, StockBarItem } from '../../types/analysis';
import {
  buildLatestHistorySummary,
  historyCategoryKey,
  stockBarToHistoryItem,
} from '../mobileHistory';

const makeStockBar = (overrides: Partial<StockBarItem> = {}): StockBarItem => ({
  id: 1,
  stockCode: '600519',
  stockName: '贵州茅台',
  analysisCount: 3,
  lastAnalysisTime: '2026-08-13T09:00:00Z',
  ...overrides,
});

const makeReport = (overrides: Partial<HistoryItem> = {}): HistoryItem => ({
  id: 99,
  queryId: 'q-99',
  stockCode: '600519',
  stockName: '贵州茅台',
  createdAt: '2026-08-14T09:00:00Z',
  ...overrides,
});

describe('historyCategoryKey', () => {
  it('treats composite analysis as its own category', () => {
    expect(historyCategoryKey({ stockCode: 'COMPOSITE', reportType: undefined })).toBe('COMPOSITE');
    expect(historyCategoryKey({ stockCode: '600519', reportType: 'composite_analysis' })).toBe('COMPOSITE');
  });

  it('treats market review as its own category', () => {
    expect(historyCategoryKey({ stockCode: 'MARKET', reportType: undefined })).toBe('MARKET');
    expect(historyCategoryKey({ stockCode: '000001', reportType: 'market_review' })).toBe('MARKET');
  });

  it('normalizes individual stock codes', () => {
    expect(historyCategoryKey({ stockCode: '600519', reportType: 'full' })).toBe('600519');
    expect(historyCategoryKey({ stockCode: 'sz000858', reportType: 'full' })).toBe('000858');
    expect(historyCategoryKey({ stockCode: 'HK00700', reportType: 'full' })).toBe('HK00700');
    expect(historyCategoryKey({ stockCode: 'AAPL', reportType: 'full' })).toBe('AAPL');
  });
});

describe('stockBarToHistoryItem', () => {
  it('converts a stock bar item into a history item using the latest analysis time', () => {
    const item = stockBarToHistoryItem(
      makeStockBar({ id: 31, operationAdvice: '趋势稳健', sentimentScore: 73, reportType: 'full', action: 'buy', actionLabel: '买入' }),
    );
    expect(item.id).toBe(31);
    expect(item.queryId).toBe('31');
    expect(item.stockCode).toBe('600519');
    expect(item.stockName).toBe('贵州茅台');
    expect(item.operationAdvice).toBe('趋势稳健');
    expect(item.sentimentScore).toBe(73);
    expect(item.createdAt).toBe('2026-08-13T09:00:00Z');
  });
});

describe('buildLatestHistorySummary', () => {
  const composite = makeReport({ id: 1, stockCode: 'COMPOSITE', stockName: '今日综合分析', reportType: 'composite_analysis', createdAt: '2026-08-14T10:00:00Z' });
  const market = makeReport({ id: 2, stockCode: 'MARKET', stockName: '大盘复盘', reportType: 'market_review', createdAt: '2026-08-14T09:00:00Z' });

  it('keeps the latest record per category and sorts by time', () => {
    const stockBar = [
      makeStockBar({ id: 11, stockCode: '600519', lastAnalysisTime: '2026-08-14T12:00:00Z' }),
      makeStockBar({ id: 12, stockCode: '000858', lastAnalysisTime: '2026-08-14T11:00:00Z' }),
    ];
    const summary = buildLatestHistorySummary(composite, market, stockBar);

    expect(summary.map(item => item.stockCode)).toEqual(['600519', '000858', 'COMPOSITE', 'MARKET']);
  });

  it('deduplicates the composite entry present in the stock bar against the explicit composite report', () => {
    const stockBarWithComposite: StockBarItem[] = [
      ...[
        makeStockBar({ id: 11, stockCode: '600519', lastAnalysisTime: '2026-08-14T12:00:00Z' }),
      ],
      {
        id: 99,
        stockCode: 'COMPOSITE',
        stockName: '综合',
        reportType: 'composite_analysis',
        analysisCount: 1,
        lastAnalysisTime: '2026-08-14T08:00:00Z',
      },
    ];
    const summary = buildLatestHistorySummary(composite, market, stockBarWithComposite);

    const compositeEntries = summary.filter(item => item.stockCode === 'COMPOSITE');
    expect(compositeEntries.length).toBe(1);
    expect(compositeEntries[0].createdAt).toBe('2026-08-14T10:00:00Z');
  });

  it('respects the max limit and drops empty records', () => {
    const stockBar = Array.from({ length: 12 }, (_, index) =>
      makeStockBar({ id: index + 1, stockCode: `600${String(index).padStart(3, '0')}`, lastAnalysisTime: `2026-08-14T0${index % 10}:00:00Z` }),
    );
    const summary = buildLatestHistorySummary(undefined, undefined, stockBar, 10);
    expect(summary.length).toBe(10);
  });
});