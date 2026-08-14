import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import MobileMePage from '../MobileMePage';

describe('MobileMePage', () => {
  it('offers daily-use summaries and keeps secrets in desktop advanced settings', () => {
    render(<MemoryRouter><MobileMePage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: '持仓' })).toHaveAttribute('href', '/portfolio');
    expect(screen.getByRole('link', { name: 'AI 建议' })).toHaveAttribute('href', '/decision-signals');
    expect(screen.getByRole('link', { name: '告警' })).toHaveAttribute('href', '/alerts');
    expect(screen.getByRole('link', { name: '用量' })).toHaveAttribute('href', '/usage');
    expect(screen.getByText('高级配置请使用桌面端')).toBeInTheDocument();
    expect(screen.queryByText(/API Key/i)).not.toBeInTheDocument();
  });
});
