import { beforeEach, describe, expect, it, vi } from 'vitest';
import { backtestApi } from '../backtest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../index', () => ({ default: { get, post } }));

describe('backtestApi async run', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('submits a task and returns its completed result without one long request', async () => {
    post.mockResolvedValueOnce({ data: { task_id: 'bt-1', status: 'pending', reused: false } });
    get.mockResolvedValueOnce({
      data: {
        task_id: 'bt-1', status: 'completed', progress: 100,
        result: { processed: 2, saved: 2, completed: 1, insufficient: 1, errors: 0, applied_eval_window_days: 1, diagnostics: {} },
      },
    });

    const result = await backtestApi.run({ evalWindowDays: 1, force: true, minAgeDays: 0 });

    expect(post).toHaveBeenCalledWith('/api/v1/backtest/tasks', {
      eval_window_days: 1,
      force: true,
      min_age_days: 0,
    });
    expect(get).toHaveBeenCalledWith('/api/v1/backtest/tasks/bt-1');
    expect(result.appliedEvalWindowDays).toBe(1);
  });

  it('gets the current active task for page refresh recovery', async () => {
    get.mockResolvedValueOnce({
      data: { task_id: 'bt-active', status: 'processing', progress: 45, message: '正在回测' },
    });

    const task = await backtestApi.getCurrentTask();

    expect(get).toHaveBeenCalledWith('/api/v1/backtest/tasks/current');
    expect(task).toMatchObject({ taskId: 'bt-active', status: 'processing', progress: 45 });
  });

  it('waits for an existing task without submitting another one', async () => {
    get.mockResolvedValueOnce({
      data: {
        task_id: 'bt-active', status: 'completed', progress: 100,
        result: { processed: 1, saved: 1, completed: 1, insufficient: 0, errors: 0, diagnostics: {} },
      },
    });

    const result = await backtestApi.waitForTask('bt-active');

    expect(post).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith('/api/v1/backtest/tasks/bt-active');
    expect(result.completed).toBe(1);
  });

  it('loads persisted backtest run history', async () => {
    get.mockResolvedValueOnce({
      data: {
        total: 1, page: 1, limit: 20,
        items: [{ run_id: 'run-1', source: 'web', status: 'completed', force: true, limit: 200, created_at: '2026-08-17T20:00:00', processed: 3 }],
      },
    });

    const history = await backtestApi.getRuns({ page: 1, limit: 20 });

    expect(get).toHaveBeenCalledWith('/api/v1/backtest/runs', { params: { page: 1, limit: 20 } });
    expect(history.items[0]).toMatchObject({ runId: 'run-1', status: 'completed', processed: 3 });
  });
});
