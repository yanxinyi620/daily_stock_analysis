import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { RunnerPanel } from '../RunnerPanel';

const owner = 'u1';
const task = { id: 'task-1', status: 'running', progress: 25, progress_message: '正在分析', report_id: null, error_code: null, created_at: '2026-01-01' };
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

function database(rows: unknown[] = [], error: unknown = null) {
  const limit = vi.fn().mockResolvedValue({ data: rows, error });
  const order = vi.fn().mockReturnValue({ limit });
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  return { client: { from: vi.fn(() => ({ select })) }, limit };
}

function databaseSequence(results: Array<{ rows: unknown[]; error?: unknown }>) {
  const limit = vi.fn().mockImplementation(async () => {
    const next = results.shift() ?? { rows: [] };
    return { data: next.rows, error: next.error ?? null };
  });
  const order = vi.fn().mockReturnValue({ limit });
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  return { client: { from: vi.fn(() => ({ select })) }, limit };
}

function renderPanel(client = database().client as never, onReport = vi.fn(), strict = false) {
  const panel = <MemoryRouter><RunnerPanel client={client} accessToken="token" user={owner} onReport={onReport} /></MemoryRouter>;
  return { ...render(strict ? <StrictMode>{panel}</StrictMode> : panel), onReport };
}

beforeEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => 'req-1' } });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => vi.useRealTimers());

test('StrictMode loads history and resumes its active task', async () => {
  const db = database([task]);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ online: true, busy: true, last_seen_at: '2026-01-01', current_task_id: task.id }));
  renderPanel(db.client as never, vi.fn(), true);
  await waitFor(() => expect(db.limit).toHaveBeenCalled());
  expect(await screen.findByRole('status')).toHaveTextContent('正在分析 25%');
});

test.each([
  ['offline', { online: false, busy: false, last_seen_at: null, current_task_id: null }],
  ['unknown', null],
])('a forged %s form submission never posts a task', async (_name, state) => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => state ? json(state) : Promise.reject(new Error('network')));
  renderPanel();
  if (state) await screen.findByText('离线'); else await screen.findByText('状态未知');
  fireEvent.change(screen.getByLabelText('代码'), { target: { value: '000001' } });
  fireEvent.submit(screen.getByRole('button').closest('form')!);
  await Promise.resolve();
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
});

test('successful terminal submission stops task database polling while heartbeat polling continues', async () => {
  const db = database([]);
  const fetchMock = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(json({ online: true, busy: false, last_seen_at: '2026-01-01', current_task_id: null }))
    .mockResolvedValueOnce(json({ ...task, status: 'succeeded', report_id: 'report-1', progress_message: '完成' }))
    .mockResolvedValue(json({ online: true, busy: false, last_seen_at: '2026-01-01', current_task_id: null }));
  const { onReport } = renderPanel(db.client as never);
  await screen.findByText('在线');
  fireEvent.change(screen.getByLabelText('代码'), { target: { value: '000001' } });
  fireEvent.click(screen.getByRole('button', { name: '开始分析' }));
  expect(await screen.findByRole('link', { name: '查看报告' })).toHaveAttribute('href', '/reports/report-1');
  expect(onReport).toHaveBeenCalledOnce();
  const queriesAfterSubmit = db.limit.mock.calls.length;
  fireEvent(document, new Event('visibilitychange'));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => !init?.method || init.method === 'GET')).toHaveLength(2));
  expect(db.limit).toHaveBeenCalledTimes(queriesAfterSubmit);
});

test('a busy retry reuses its UUID while the runner remains online', async () => {
  const db = database();
  const fetchMock = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(json({ online: true, busy: false, last_seen_at: null, current_task_id: null }))
    .mockResolvedValueOnce(json({ error: 'RUNNER_BUSY' }, { status: 409 }));
  renderPanel(db.client as never);
  await screen.findByText('在线');
  fireEvent.change(screen.getByLabelText('代码'), { target: { value: '000001' } });
  fireEvent.click(screen.getByRole('button', { name: '开始分析' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: '重试提交' })).toBeEnabled();
  fetchMock.mockResolvedValueOnce(json({ ...task, status: 'pending' }));
  fireEvent.click(screen.getByRole('button', { name: '重试提交' }));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2));
  const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(JSON.parse(String(posts[0][1]?.body)).request_id).toBe(JSON.parse(String(posts[1][1]?.body)).request_id);
});

test('submits a market review with its canonical region payload', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(json({ online: true, busy: false, last_seen_at: null, current_task_id: null }))
    .mockResolvedValueOnce(json({ ...task, status: 'pending', task_type: 'market_review' }));
  renderPanel();
  await screen.findByText('在线');
  fireEvent.change(screen.getByLabelText('任务类型'), { target: { value: 'market_review' } });
  fireEvent.change(screen.getByLabelText('复盘市场'), { target: { value: 'jp' } });
  fireEvent.click(screen.getByRole('button', { name: '开始分析' }));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1));
  const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
    request_id: 'req-1', task_type: 'market_review', input: { region: 'jp' },
  });
});

test('disables market review submission while the runner is offline', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ online: false, busy: false, last_seen_at: null, current_task_id: null }));
  renderPanel();
  await screen.findByText('离线');
  fireEvent.change(screen.getByLabelText('任务类型'), { target: { value: 'market_review' } });
  expect(screen.getByRole('button', { name: '开始分析' })).toBeDisabled();
});

test('an uncertain market review retry keeps its type and region controls frozen', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(json({ online: true, busy: false, last_seen_at: null, current_task_id: null }))
    .mockResolvedValueOnce(json({ error: 'temporary' }, { status: 503 }));
  renderPanel();
  await screen.findByText('在线');
  fireEvent.change(screen.getByLabelText('任务类型'), { target: { value: 'market_review' } });
  fireEvent.change(screen.getByLabelText('复盘市场'), { target: { value: 'kr' } });
  fireEvent.click(screen.getByRole('button', { name: '开始分析' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('任务类型')).toBeDisabled();
  expect(screen.getByLabelText('复盘市场')).toBeDisabled();
  fetchMock.mockResolvedValueOnce(json({ ...task, status: 'pending', task_type: 'market_review' }));
  fireEvent.click(screen.getByRole('button', { name: '重试提交' }));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2));
  const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(JSON.parse(String(posts[1][1]?.body))).toMatchObject({
    request_id: 'req-1', task_type: 'market_review', input: { region: 'kr' },
  });
});

test('a server offline rejection disables another submission immediately', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(json({ online: true, busy: false, last_seen_at: null, current_task_id: null }))
    .mockResolvedValueOnce(json({ error: 'RUNNER_OFFLINE' }, { status: 409 }));
  renderPanel();
  await screen.findByText('在线');
  fireEvent.change(screen.getByLabelText('代码'), { target: { value: '000001' } });
  fireEvent.click(screen.getByRole('button', { name: '开始分析' }));
  await screen.findByRole('alert');
  expect(screen.getByText('离线')).toBeInTheDocument();
  fireEvent.submit(screen.getByRole('button').closest('form')!);
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

test('a lost submission response retries with the original UUID after a fresh online status', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(json({ online: true, busy: false, last_seen_at: null, current_task_id: null }))
    .mockResolvedValueOnce(json({ error: 'temporary' }, { status: 503 }))
    .mockResolvedValueOnce(json({ ...task, status: 'pending' }));
  renderPanel();
  await screen.findByText('在线');
  fireEvent.change(screen.getByLabelText('代码'), { target: { value: '000001' } });
  fireEvent.click(screen.getByRole('button', { name: '开始分析' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '重试提交' }));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2));
  const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(JSON.parse(String(posts[0][1]?.body)).request_id).toBe(JSON.parse(String(posts[1][1]?.body)).request_id);
});

test('an ambiguous submission remains retryable when the next status says the runner is busy', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(json({ online: true, busy: false, last_seen_at: null, current_task_id: null }))
    .mockResolvedValueOnce(json({ error: 'temporary' }, { status: 503 }))
    .mockResolvedValueOnce(json({ online: true, busy: true, last_seen_at: null, current_task_id: 'other-task' }))
    .mockResolvedValueOnce(json({ ...task, status: 'pending' }));
  renderPanel();
  await screen.findByText('在线');
  fireEvent.change(screen.getByLabelText('代码'), { target: { value: '000001' } });
  fireEvent.click(screen.getByRole('button', { name: '开始分析' }));
  await screen.findByRole('alert');
  fireEvent(document, new Event('visibilitychange'));
  await screen.findByText('服务忙碌中');
  expect(screen.getByRole('button', { name: '重试提交' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '重试提交' }));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2));
});

test('a status API failure still renders existing history', async () => {
  const db = database([{ ...task, status: 'succeeded', report_id: 'existing-report' }]);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ error: 'unavailable' }, { status: 503 }));
  renderPanel(db.client as never);
  expect(await screen.findByText('已完成')).toBeInTheDocument();
  expect(screen.queryByText('正在分析')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '查看报告' })).toHaveAttribute('href', '/reports/existing-report');
});

test('a failed history request retries and recovers on the next status poll', async () => {
  const db = databaseSequence([{ rows: [], error: new Error('offline') }, { rows: [task] }]);
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ online: true, busy: false, last_seen_at: null, current_task_id: null }));
  renderPanel(db.client as never);
  await screen.findByText('任务状态查询失败，稍后重试。');
  fireEvent(document, new Event('visibilitychange'));
  expect(await screen.findByRole('status')).toHaveTextContent('正在分析 25%');
  expect(db.limit).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('a history failure stays visible and late responses after unmount cannot update the component', async () => {
  let resolve!: (value: Response) => void;
  const pending = new Promise<Response>((done) => { resolve = done; });
  const db = database([], new Error('history failed'));
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ online: true, busy: false, last_seen_at: null, current_task_id: null })).mockReturnValue(pending);
  const view = renderPanel(db.client as never);
  await screen.findByRole('alert');
  view.unmount();
  resolve(json({ online: true, busy: false, last_seen_at: null, current_task_id: null }));
  await Promise.resolve();
  expect(screen.queryByText('在线')).not.toBeInTheDocument();
});

test('submits a composite analysis with only the selected market region', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(json({ online: true, busy: false, last_seen_at: null, current_task_id: null }))
    .mockResolvedValueOnce(json({ ...task, status: 'pending', task_type: 'composite_analysis' }));
  renderPanel();
  await screen.findByText('在线');
  fireEvent.change(screen.getByLabelText('任务类型'), { target: { value: 'composite_analysis' } });
  fireEvent.change(screen.getByLabelText('复盘市场'), { target: { value: 'hk' } });
  fireEvent.click(screen.getByRole('button', { name: '开始分析' }));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1));
  const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
  const payload = JSON.parse(String(post?.[1]?.body));
  expect(payload).toMatchObject({ request_id: 'req-1', task_type: 'composite_analysis', input: { region: 'hk' } });
  expect(payload.input).not.toHaveProperty('stock_codes');
  expect(screen.getByText('提交后将使用云端自选股快照进行综合分析。')).toBeInTheDocument();
});

test.each([
  ['EMPTY_WATCHLIST', '云端自选股为空，请先配置自选股。'],
  ['SNAPSHOT_TOO_LARGE', '云端自选股快照过大，请减少自选股后重试。'],
])('shows a human message for composite %s rejection', async (code, message) => {
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(json({ online: true, busy: false, last_seen_at: null, current_task_id: null }))
    .mockResolvedValueOnce(json({ error: code }, { status: 422 }));
  renderPanel();
  await screen.findByText('在线');
  fireEvent.change(screen.getByLabelText('任务类型'), { target: { value: 'composite_analysis' } });
  fireEvent.click(screen.getByRole('button', { name: '开始分析' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
});

test('renders a published partial composite as partial with failure counts and report link', async () => {
  const composite = {
    ...task, status: 'succeeded', task_type: 'composite_analysis', report_id: 'report-composite',
    input_json: { region: 'cn', stock_codes: ['600519', '000858', 'AAPL'] },
    result_summary: { outcome: 'partial', stock_completed: 2, stock_failed: 1, market_review_status: 'failed', failed_stocks: ['000858'] },
  };
  const db = database([composite]);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ online: true, busy: false, last_seen_at: null, current_task_id: null }));
  renderPanel(db.client as never);
  expect(await screen.findByText('部分完成')).toBeInTheDocument();
  expect(screen.getByText(/失败 1 支/)).toBeInTheDocument();
  expect(screen.getByText(/成功 2 支/)).toBeInTheDocument();
  expect(screen.getByText(/大盘复盘失败/)).toBeInTheDocument();
  expect(screen.getByText(/自选股快照 3 支/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '查看报告' })).toHaveAttribute('href', '/reports/report-composite');
  expect(screen.queryByText('已完成')).not.toBeInTheDocument();
});

test('renders a partial composite returned by submission with its published report', async () => {
  const composite = {
    ...task, status: 'succeeded', task_type: 'composite_analysis', report_id: 'report-current',
    input_json: { region: 'cn', stock_codes: ['600519'] },
    result_summary: { outcome: 'partial', stock_completed: 1, stock_failed: 0, market_review_status: 'failed', failed_stocks: [] },
  };
  const fetchMock = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(json({ online: true, busy: false, last_seen_at: null, current_task_id: null }))
    .mockResolvedValueOnce(json(composite));
  renderPanel();
  await screen.findByText('在线');
  fireEvent.change(screen.getByLabelText('任务类型'), { target: { value: 'composite_analysis' } });
  fireEvent.click(screen.getByRole('button', { name: '开始分析' }));
  expect(await screen.findByRole('status')).toHaveTextContent('部分完成');
  expect(screen.getByRole('status')).toHaveTextContent('大盘复盘失败');
  expect(screen.getByRole('link', { name: '查看报告' })).toHaveAttribute('href', '/reports/report-current');
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

test('renders a completed composite history as fully completed', async () => {
  const composite = {
    ...task, status: 'succeeded', task_type: 'composite_analysis', report_id: 'report-composite',
    input_json: { region: 'us', stock_codes: ['AAPL'] },
    result_summary: { outcome: 'completed', stock_completed: 1, stock_failed: 0, market_review_status: 'completed', failed_stocks: [] },
  };
  const db = database([composite]);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ online: true, busy: false, last_seen_at: null, current_task_id: null }));
  renderPanel(db.client as never);
  expect(await screen.findByText('已完成')).toBeInTheDocument();
  expect(screen.queryByText('部分完成')).not.toBeInTheDocument();
  expect(screen.getByText(/失败 0 支/)).toBeInTheDocument();
  expect(screen.getByText(/自选股快照 1 支/)).toBeInTheDocument();
});

test('does not claim completion when a succeeded composite has no trustworthy summary', async () => {
  const composite = {
    ...task, status: 'succeeded', task_type: 'composite_analysis', report_id: 'report-unknown',
    input_json: { region: 'cn', stock_codes: ['600519'] }, result_summary: null,
  };
  const db = database([composite]);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ online: true, busy: false, last_seen_at: null, current_task_id: null }));
  renderPanel(db.client as never);
  expect(await screen.findByText('结果待确认')).toBeInTheDocument();
  expect(screen.queryByText('已完成')).not.toBeInTheDocument();
  expect(screen.queryByText('部分完成')).not.toBeInTheDocument();
});
