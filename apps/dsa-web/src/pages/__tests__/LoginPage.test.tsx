import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '../LoginPage';

const { navigate, useSearchParamsMock, useAuthMock } = vi.hoisted(() => ({
  navigate: vi.fn(),
  useSearchParamsMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock('../../hooks', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useSearchParams: () => useSearchParamsMock(),
  };
});

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.className = 'light';
    useSearchParamsMock.mockReturnValue([new URLSearchParams('redirect=%2Fsettings')]);
  });

  it('blocks first-time setup when confirmation does not match', async () => {
    const login = vi.fn();
    useAuthMock.mockReturnValue({
      login,
      passwordSet: false,
      setupState: 'no_password',
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('管理员密码'), { target: { value: 'passwd6' } });
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'passwd7' } });
    fireEvent.click(screen.getByRole('button', { name: '完成设置并登录' }));

    expect(await screen.findByText('两次输入的密码不一致')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
    expect(screen.getByLabelText('管理员密码')).toHaveAttribute('data-appearance', 'login');
    expect(screen.getByLabelText('确认密码')).toHaveAttribute('data-appearance', 'login');
  });

  it.each([
    ['missing redirect', '', '/'],
    ['empty redirect', 'redirect=', '/'],
    ['absolute URL', 'redirect=https%3A%2F%2Fexample.invalid', '/'],
    ['protocol-relative URL', 'redirect=%2F%2Fexample.invalid', '/'],
    ['backslash URL', 'redirect=%2F%5Cexample.invalid', '/'],
    ['line feed URL', 'redirect=%2F%0A%2Fexample.invalid', '/'],
    ['carriage return URL', 'redirect=%2F%0D%2Fexample.invalid', '/'],
    ['tab URL', 'redirect=%2F%09%2Fexample.invalid', '/'],
    ['control character', 'redirect=%2Fsettings%00', '/'],
    ['delete character', 'redirect=%2Fsettings%7F', '/'],
    ['internal path', 'redirect=%2Fsettings', '/settings'],
    ['query and fragment', 'redirect=%2Fsettings%3Ftab%3Dgeneral%23security', '/settings?tab=general#security'],
  ])('handles %s after a successful login', async (_name, query, expectedRedirect) => {
    useSearchParamsMock.mockReturnValue([new URLSearchParams(query)]);
    useAuthMock.mockReturnValue({
      login: vi.fn().mockResolvedValue({ success: true }),
      passwordSet: true,
      setupState: 'enabled',
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('登录密码'), { target: { value: 'passwd6' } });
    fireEvent.click(screen.getByRole('button', { name: '授权进入工作台' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(expectedRedirect, { replace: true }));
    expect(screen.getByLabelText('登录密码')).toHaveAttribute('data-appearance', 'login');
  });

  it('does not override login theme tokens inline so light mode can take effect', () => {
    useAuthMock.mockReturnValue({
      login: vi.fn(),
      passwordSet: true,
      setupState: 'enabled',
    });

    const { container } = render(<LoginPage />);
    const pageRoot = container.firstElementChild as HTMLElement | null;

    expect(pageRoot).not.toBeNull();
    expect(pageRoot?.getAttribute('style') ?? '').not.toContain('--login-bg-main');
  });
});
