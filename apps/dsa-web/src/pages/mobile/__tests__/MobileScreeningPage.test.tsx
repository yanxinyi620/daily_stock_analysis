import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screeningApi } from '../../../api/screening';
import MobileScreeningPage from '../MobileScreeningPage';

vi.mock('../../../api/screening', () => ({ screeningApi: {
  getStrategies: vi.fn(), startScreen: vi.fn(), getScreenTask: vi.fn(), getHistory: vi.fn(), getRun: vi.fn(),
} }));

describe('MobileScreeningPage', () => {
  beforeEach(() => {
    vi.mocked(screeningApi.getStrategies).mockResolvedValue({ enabled: true, strategyCount: 1, strategies: [{ id: 'value', name: '价值低估', description: '寻找估值与质量平衡的股票' }] });
    vi.mocked(screeningApi.getHistory).mockResolvedValue({ enabled: true, runCount: 1, runs: [{ runId: 'old', strategy: 'value', market: 'cn', candidateCount: 2, createdAt: '2026' }] });
    vi.mocked(screeningApi.startScreen).mockResolvedValue({ taskId: 'screen-1', status: 'pending', message: '', strategy: 'value', market: 'cn', maxResults: 5 });
    vi.mocked(screeningApi.getScreenTask)
      .mockResolvedValueOnce({ taskId: 'screen-1', status: 'processing', progress: 35 })
      .mockResolvedValueOnce({ taskId: 'screen-1', status: 'completed', progress: 100, result: { enabled: true, candidateCount: 1, candidates: [{ rank: 1, code: '600519', name: '贵州茅台', reason: '质量稳定', raw: {} }] } });
  });
  it('loads strategies and history, then renders async screening candidates', async () => {
    render(<MemoryRouter><MobileScreeningPage /></MemoryRouter>);
    expect(await screen.findByText('价值低估')).toBeInTheDocument();
    expect(screen.getByText('历史 1 次')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '开始选股' }));
    await waitFor(() => expect(screeningApi.startScreen).toHaveBeenCalledWith({ market: 'cn', strategy: 'value', maxResults: 5 }));
    expect(await screen.findByText('贵州茅台', {}, { timeout: 2500 })).toBeInTheDocument();
    expect(screen.getByText('质量稳定')).toBeInTheDocument();
  });
});
