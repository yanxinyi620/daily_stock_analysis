import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { MobileShell } from '../MobileShell';

describe('MobileShell', () => {
  it('renders the five daily entry points and marks the current route', () => {
    render(
      <MemoryRouter initialEntries={['/m/tasks']}>
        <MobileShell>
          <div>任务内容</div>
        </MobileShell>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('mobile-shell')).toHaveClass('min-h-[100dvh]');
    expect(screen.getByRole('navigation', { name: '移动端主导航' })).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(5);
    expect(screen.getByRole('link', { name: '首页' })).toHaveAttribute('href', '/m');
    expect(screen.getByRole('link', { name: '自选' })).toHaveAttribute('href', '/m/watchlist');
    expect(screen.getByRole('link', { name: '问股' })).toHaveAttribute('href', '/m/chat');
    expect(screen.getByRole('link', { name: '任务' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '我的' })).toHaveAttribute('href', '/m/me');
    expect(screen.getByText('任务内容')).toBeInTheDocument();
  });

  it('reserves safe-area space below the only content scroller', () => {
    render(
      <MemoryRouter initialEntries={['/m']}>
        <MobileShell>
          <div>首页内容</div>
        </MobileShell>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('mobile-content-scroll')).toHaveClass('overflow-y-auto');
    expect(screen.getByTestId('mobile-bottom-nav')).toHaveClass('pb-[env(safe-area-inset-bottom)]');
  });
});
