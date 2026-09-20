import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import CloudApp from '../CloudApp';
import { cloudData, createCloudClient } from '../client';
vi.mock('../client', async (original) => ({ ...await original<typeof import('../client')>(), createCloudClient: vi.fn(), cloudData: vi.fn() }));
let listener: (event: string, session: unknown) => void;
let data: Record<string, ReturnType<typeof vi.fn>>;
let auth: Record<string, ReturnType<typeof vi.fn>>;
const session = { user: { id: 'user-a', email: 'a@example.test' }, access_token: 'token-a' };
beforeEach(() => {
  history.replaceState({}, '', '/');
  auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    onAuthStateChange: vi.fn().mockImplementation((fn) => { listener = fn; return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
    signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }), updateUser: vi.fn().mockResolvedValue({ error: null }),
  };
  data = {
    member: vi.fn().mockResolvedValue(true), watchlist: vi.fn().mockResolvedValue([]),
    reports: vi.fn().mockResolvedValue({ rows: [{ task_id: 'report-a', title: '私人报告 A', generated_at: '2026-09-14T00:00:00Z' }], count: 1 }),
    report: vi.fn().mockResolvedValue({ task_id: 'report-a', title: '私人报告 A', markdown: '# 正文\n<script>window.hacked=1</script>', object_path: 'a/report.md', bucket: 'analysis-reports', generated_at: '2026-09-14T00:00:00Z' }),
    tasks: vi.fn().mockResolvedValue({ rows: [], active: false }), saveWatch: vi.fn(), deleteWatch: vi.fn(), download: vi.fn(),
  };
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn().mockResolvedValue({ data: [], error: null }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ online: false, busy: false, last_seen_at: null, current_task_id: null })));
  vi.mocked(createCloudClient).mockReturnValue({ auth, from: vi.fn().mockReturnValue(query) } as never);
  vi.mocked(cloudData).mockReturnValue(data as never);
});
test('email login exists without signup or analysis dispatch', async () => {
  render(<CloudApp />);
  await screen.findByRole('button', { name: '登录' });
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'a@example.test' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'private-password' } });
  fireEvent.click(screen.getByRole('button', { name: '登录' }));
  await waitFor(() => expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@example.test', password: 'private-password' }));
  expect(screen.queryByRole('button', { name: /注册|立即分析/ })).not.toBeInTheDocument();
});
test('logout immediately removes private data', async () => {
  auth.getSession.mockResolvedValue({ data: { session }, error: null });
  render(<CloudApp />);
  await screen.findByText('私人报告 A');
  act(() => listener('SIGNED_OUT', null));
  await screen.findByRole('button', { name: '登录' });
  expect(screen.queryByText('私人报告 A')).not.toBeInTheDocument();
});
test('deep links render Markdown safely; inactive members cannot view it', async () => {
  history.replaceState({}, '', '/reports/report-a');
  auth.getSession.mockResolvedValue({ data: { session }, error: null });
  const view = render(<CloudApp />);
  await screen.findByText('正文');
  expect(view.container.querySelector('script')).toBeNull();
  expect(data.report).toHaveBeenCalledWith('user-a', 'report-a');
  view.unmount(); data.member.mockResolvedValue(false);
  render(<CloudApp />);
  await screen.findByText(/账户尚未获得访问权限/);
  expect(screen.queryByText('正文')).not.toBeInTheDocument();
});

test('a late previous-user response cannot leak into a new session', async () => {
  auth.getSession.mockResolvedValue({ data: { session }, error: null });
  let finishA: (value: unknown) => void = () => {};
  const delayed = new Promise((resolve) => { finishA = resolve; });
  data.reports.mockImplementation((user: string) => user === 'user-a' ? delayed : Promise.resolve({
    rows: [{ task_id: 'report-b', title: '私人报告 B', generated_at: '2026-09-14T00:00:00Z' }], count: 1,
  }));
  render(<CloudApp />);
  await waitFor(() => expect(data.reports).toHaveBeenCalledWith('user-a', 0, 20));
  act(() => listener('SIGNED_IN', { user: { id: 'user-b', email: 'b@example.test' }, access_token: 'token-b' }));
  await screen.findByText('私人报告 B');
  await act(async () => finishA({ rows: [{ task_id: 'report-a', title: '私人报告 A', generated_at: '2026-09-14T00:00:00Z' }], count: 1 }));
  expect(screen.queryByText('私人报告 A')).not.toBeInTheDocument();
  expect(screen.getByText('私人报告 B')).toBeInTheDocument();
});
