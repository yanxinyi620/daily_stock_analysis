import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { historyApi } from '../../../api/history';
import MobileReportPage from '../MobileReportPage';

vi.mock('../../../api/history', () => ({ historyApi: { getDetail: vi.fn(), getMarkdown: vi.fn() } }));

describe('MobileReportPage', () => {
  it('loads summary first and fetches markdown only after opening the full report', async () => {
    vi.mocked(historyApi.getDetail).mockResolvedValue({
      meta: { id: 42, queryId: 'q', stockCode: '600519', stockName: '贵州茅台', reportType: 'full', createdAt: '2026' },
      summary: { analysisSummary: '基本面稳健，但短线需注意波动。', operationAdvice: '持有', trendPrediction: '震荡上行', sentimentScore: 76 },
      strategy: { stopLoss: '1320', takeProfit: '1450' },
    });
    vi.mocked(historyApi.getMarkdown).mockResolvedValue('# 完整分析\n更多内容');
    render(<MemoryRouter initialEntries={['/m/reports/42']}><Routes><Route path="/m/reports/:historyId" element={<MobileReportPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('贵州茅台')).toBeInTheDocument();
    expect(screen.getByText('76')).toBeInTheDocument();
    expect(screen.getByText('基本面稳健，但短线需注意波动。')).toBeInTheDocument();
    expect(historyApi.getMarkdown).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '查看完整报告' }));
    await waitFor(() => expect(historyApi.getMarkdown).toHaveBeenCalledWith(42));
    expect(await screen.findByText('完整分析')).toBeInTheDocument();
  });
});
