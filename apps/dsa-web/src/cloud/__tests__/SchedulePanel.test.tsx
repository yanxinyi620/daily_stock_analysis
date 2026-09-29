import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { SchedulePanel } from '../SchedulePanel';
afterEach(() => vi.restoreAllMocks());
const json = (enabled: boolean) => Response.json({ enabled });
test('active workflow can be paused then enabled using explicit state', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(true)).mockResolvedValueOnce(json(false)).mockResolvedValueOnce(json(true));
  render(<SchedulePanel accessToken="token" />);
  fireEvent.click(await screen.findByRole('button', { name: '暂停定时任务' }));
  fireEvent.click(await screen.findByRole('button', { name: '启用定时任务' }));
  await screen.findByRole('button', { name: '暂停定时任务' });
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT').map(([, init]) => JSON.parse(String(init?.body)))).toEqual([{ enabled: false }, { enabled: true }]);
  expect(fetcher.mock.calls.every(([url]) => url === '/api/schedule')).toBe(true);
});
test('failed mutation removes stale state and requires readback before another toggle', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(true)).mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(json(false));
  render(<SchedulePanel accessToken="token" />);
  fireEvent.click(await screen.findByRole('button', { name: '暂停定时任务' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('未能确认');
  expect(screen.queryByRole('button', { name: '启用定时任务' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
  await screen.findByRole('button', { name: '启用定时任务' });
});
test('unknown, malformed and unavailable status never become paused', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(Response.json({ error: 'NOT_CONFIGURED' }, { status: 503 }));
  render(<SchedulePanel accessToken="token" />);
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: '启用定时任务' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await screen.findByText('定时任务控制尚未配置，请联系管理员。');
});
test('non-owner has no mutation control', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'FORBIDDEN' }, { status: 403 }));
  render(<SchedulePanel accessToken="token" />);
  await screen.findByText('仅主账号可以管理定时任务。');
  expect(screen.queryByRole('button', { name: /启用定时任务|暂停定时任务/ })).not.toBeInTheDocument();
});
test('pending mutation prevents duplicate submissions', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(true)).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(<SchedulePanel accessToken="token" />);
  const button = await screen.findByRole('button', { name: '暂停定时任务' });
  fireEvent.click(button); fireEvent.click(button);
  expect(fetcher).toHaveBeenCalledTimes(2); expect(button).toBeDisabled();
  finish(json(false)); await screen.findByRole('button', { name: '启用定时任务' });
});
test('token change discards an old in-flight response', async () => {
  let finish!: (response: Response) => void;
  vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce(json(false));
  const view = render(<SchedulePanel accessToken="old-token" />);
  view.rerender(<SchedulePanel accessToken="new-token" />);
  await screen.findByRole('button', { name: '启用定时任务' });
  finish(json(true));
  await waitFor(() => expect(screen.getByRole('button', { name: '启用定时任务' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: '暂停定时任务' })).not.toBeInTheDocument();
});
