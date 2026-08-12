import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analysisApi } from '../analysis';

const post = vi.hoisted(() => vi.fn());

vi.mock('../index', () => ({
  default: {
    get: vi.fn(),
    post,
  },
}));

describe('analysisApi.triggerMarketReview', () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({
      status: 202,
      data: {
        status: 'accepted',
        message: 'accepted',
        send_notification: true,
        region: 'cn,us',
        task_id: 'market-task-1',
      },
    });
  });

  it('serializes selected markets to a comma-separated request string', async () => {
    const result = await analysisApi.triggerMarketReview({
      sendNotification: false,
      regions: ['cn', 'us'],
    });

    expect(post).toHaveBeenCalledWith(
      '/api/v1/analysis/market-review',
      {
        send_notification: false,
        report_language: undefined,
        region: 'cn,us',
      },
      expect.any(Object),
    );
    expect(result.region).toBe('cn,us');
  });

  it('omits region when the caller inherits the server default', async () => {
    await analysisApi.triggerMarketReview({ sendNotification: true });

    expect(post).toHaveBeenCalledWith(
      '/api/v1/analysis/market-review',
      {
        send_notification: true,
        report_language: undefined,
      },
      expect.any(Object),
    );
  });
});

describe('analysisApi.triggerCompositeAnalysis', () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({
      status: 202,
      data: {
        task_id: 'composite-1',
        status: 'pending',
        message: 'accepted',
        stock_codes: ['600519', '000858'],
        notify: false,
        region: 'cn',
      },
    });
  });

  it('freezes the watchlist, notification and strategy options', async () => {
    const result = await analysisApi.triggerCompositeAnalysis({
      stockCodes: ['600519', '000858'],
      notify: false,
      reportLanguage: 'zh',
      skills: ['bull'],
      regions: ['cn'],
    });

    expect(post).toHaveBeenCalledWith(
      '/api/v1/analysis/composite',
      {
        stock_codes: ['600519', '000858'],
        notify: false,
        report_type: 'full',
        report_language: 'zh',
        skills: ['bull'],
        region: 'cn',
      },
      expect.any(Object),
    );
    expect(result.taskId).toBe('composite-1');
  });
});
