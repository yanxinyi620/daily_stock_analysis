import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useAnalysisRecords } from '../useAnalysisRecords';
import type { CloudData } from '../client';
beforeEach(() => { vi.useFakeTimers(); Object.defineProperty(document, 'hidden', { configurable: true, value: false }); });
afterEach(() => { vi.useRealTimers(); });
test('does not poll terminal records, active records stop after completion', async () => {
  const records = vi.fn().mockResolvedValueOnce({ rows: [], count: 0, active: true }).mockResolvedValue({ rows: [], count: 0, active: false });
  const api = { records } as unknown as CloudData;
  const view = renderHook(() => useAnalysisRecords(api, 'a', 0, 20, 0));
  await act(async () => { await Promise.resolve(); });
  expect(records).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(records).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(records).toHaveBeenCalledTimes(2); view.unmount();
});
test('polling backs off failure, pauses in background and stops on unmount', async () => {
  const records = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ rows: [], count: 0, active: true });
  const api = { records } as unknown as CloudData;
  const view = renderHook(() => useAnalysisRecords(api, 'a', 0, 20, 0));
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); expect(records).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); expect(records).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, 'hidden', { value: true });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); }); expect(records).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, 'hidden', { value: false });
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); }); expect(records).toHaveBeenCalledTimes(3);
  view.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); }); expect(records).toHaveBeenCalledTimes(3);
});

test('returning to a completed list resumes retry after a transient error', async () => {
  const records = vi.fn().mockResolvedValueOnce({ rows: [], count: 0, active: false })
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ rows: [], count: 0, active: false });
  const api = { records } as unknown as CloudData;
  const view = renderHook(() => useAnalysisRecords(api, 'a', 0, 20, 0));
  await act(async () => { await Promise.resolve(); });
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(records).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(records).toHaveBeenCalledTimes(3); view.unmount();
});
