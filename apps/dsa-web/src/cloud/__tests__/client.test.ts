import { expect, test, vi } from 'vitest';
import { cloudData, createCloudClient, normalizeCloudCode } from '../client';
test('configuration fails closed and public env rejects server keys', () => {
  expect(() => createCloudClient({})).toThrow(/配置/);
  expect(() => createCloudClient({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_test' })).toThrow(/公开/);
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`;
  expect(() => createCloudClient({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: jwt })).toThrow(/公开/);
});
test('stock identifiers retain zeroes', () => {
  expect(normalizeCloudCode('CN', '000001')).toBe('000001');
  expect(normalizeCloudCode('HK', '00700')).toBe('hk00700');
  expect(normalizeCloudCode('US', 'brk.b')).toBe('BRK.B');
  expect(() => normalizeCloudCode('CN', '1')).toThrow();
});
test('list is paginated, owner-filtered and does not fetch report bodies', async () => {
  const range = vi.fn().mockResolvedValue({ data: [], count: 0, error: null });
  const order = vi.fn().mockReturnThis(); const eq = vi.fn().mockReturnThis();
  const select = vi.fn().mockReturnValue({ order, eq, range });
  await cloudData({ from: vi.fn().mockReturnValue({ select }) } as never).reports('user-a', 2, 20);
  expect(select.mock.calls[0][0]).not.toMatch(/markdown|results|\*/);
  expect(eq).toHaveBeenCalledWith('user_id', 'user-a');
  expect(range).toHaveBeenCalledWith(40, 59);
});
test('one client owns the session across repeated component renders', async () => {
  const env = { VITE_SUPABASE_URL: 'https://singleton.example.test', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
  const first = createCloudClient(env);
  const second = createCloudClient(env);
  expect(second).toBe(first);
  await first.auth.stopAutoRefresh();
});
