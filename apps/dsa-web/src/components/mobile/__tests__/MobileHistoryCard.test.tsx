import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { HistoryItem } from '../../../types/analysis';
import { MobileHistoryCard } from '../MobileHistoryCard';

const stockItem: HistoryItem = {
  id: 42,
  queryId: 'q-42',
  stockCode: '600519',
  stockName: '贵州茅台',
  action: 'buy',
  sentimentScore: 82,
  operationAdvice: '买入',
  createdAt: '2026-08-13T10:00:00Z',
};

const marketItem: HistoryItem = {
  id: 43,
  queryId: 'q-43',
  stockCode: 'MARKET',
  stockName: '大盘复盘',
  reportType: 'market_review',
  createdAt: '2026-08-13T09:00:00Z',
};

const compositeItem: HistoryItem = {
  id: 44,
  queryId: 'q-44',
  stockCode: 'COMPOSITE',
  stockName: '今日综合分析',
  reportType: 'composite_analysis',
  sentimentScore: 70,
  createdAt: '2026-08-13T08:00:00Z',
};

describe('MobileHistoryCard', () => {
  it('renders stock history with code, score and advice, and links to the mobile report', () => {
    render(<MemoryRouter><MobileHistoryCard item={stockItem} /></MemoryRouter>);
    expect(screen.getByText('贵州茅台')).toBeInTheDocument();
    expect(screen.getByText('600519')).toBeInTheDocument();
    expect(screen.getByText('买入 82')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/m/reports/42');
  });

  it('marks market review records with the market badge and hides the stock code', () => {
    render(<MemoryRouter><MobileHistoryCard item={marketItem} /></MemoryRouter>);
    expect(screen.getByText('大盘复盘')).toBeInTheDocument();
    expect(screen.getByText('大盘')).toBeInTheDocument();
    expect(screen.queryByText('MARKET')).not.toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/m/reports/43');
  });

  it('renders composite records without a stock code', () => {
    render(<MemoryRouter><MobileHistoryCard item={compositeItem} /></MemoryRouter>);
    expect(screen.getByText('今日综合分析')).toBeInTheDocument();
    expect(screen.queryByText('COMPOSITE')).not.toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/m/reports/44');
  });
});