import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompositeHistoryView } from '../CompositeHistoryView';

const items = [
  {
    id: 42,
    queryId: 'composite-q-1',
    stockCode: 'COMPOSITE',
    stockName: '今日综合分析',
    reportType: 'composite_analysis' as const,
    sentimentScore: 62,
    analysisSummary: '2 支股票完成，1 支失败；大盘复盘 completed',
    modelUsed: 'codex_cli',
    createdAt: '2026-08-12T10:00:00+08:00',
    compositeSummary: {
      stockCodes: ['600410', '600519', '000858'],
      failedStocks: ['600410'],
      marketReviewStatus: 'completed',
      notificationRequested: true,
    },
  },
];

describe('CompositeHistoryView', () => {
  it('renders composite run metadata and opens a selected report', () => {
    const onSelectRecord = vi.fn();
    render(
      <CompositeHistoryView
        currentRecordId={42}
        items={items}
        total={1}
        hasMore={false}
        isLoading={false}
        isLoadingMore={false}
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
        onRetry={vi.fn()}
        onSelectRecord={onSelectRecord}
      />,
    );

    expect(screen.getByRole('heading', { name: '综合分析历史' })).toBeInTheDocument();
    expect(screen.getByText('成功 2 支')).toBeInTheDocument();
    expect(screen.getByText('失败 1 支')).toBeInTheDocument();
    expect(screen.getByText('大盘已完成')).toBeInTheDocument();
    expect(screen.getByText('已请求通知')).toBeInTheDocument();
    expect(screen.getByText('62 / 100')).toBeInTheDocument();
    expect(screen.getByText('codex_cli')).toBeInTheDocument();
    expect(screen.getByText('600410、600519、000858')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看报告' }));
    expect(onSelectRecord).toHaveBeenCalledWith(42);
  });

  it('renders loading and failure states', () => {
    const { rerender } = render(
      <CompositeHistoryView
        items={[]}
        total={0}
        hasMore={false}
        isLoading
        isLoadingMore={false}
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
        onRetry={vi.fn()}
        onSelectRecord={vi.fn()}
      />,
    );
    expect(screen.getByText('正在加载综合分析历史')).toBeInTheDocument();

    rerender(
      <CompositeHistoryView
        items={[]}
        total={0}
        hasMore={false}
        isLoading={false}
        isLoadingMore={false}
        error={new Error('offline')}
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
        onRetry={vi.fn()}
        onSelectRecord={vi.fn()}
      />,
    );
    expect(screen.getByText('综合分析历史加载失败')).toBeInTheDocument();
  });
});
