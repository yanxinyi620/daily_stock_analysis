import { useEffect, useState } from 'react';
import type { CloudData, AnalysisRecord } from './client';

/** Poll only unfinished publication tasks; back off failures and pause hidden tabs. */
export function useAnalysisRecords(api: CloudData, user: string, page: number, size: number, revision: number, trash = false) {
  const [rows, setRows] = useState<AnalysisRecord[]>([]);
  const [error, setError] = useState(false);
  const [count, setCount] = useState(0);
  const key = JSON.stringify([user, page, size, trash]);
  const [loadedKey, setLoadedKey] = useState<string>();
  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let shouldPoll = true;
    let delay = 5000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (stopped || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const result = await api.records(user, page, size, trash);
        if (stopped) return;
        setRows(result.rows); setCount(result.count); setError(false);
        shouldPoll = result.active; delay = 5000;
      } catch {
        if (stopped) return;
        setRows([]); setCount(0); setError(true); shouldPoll = true; delay = Math.min(delay * 2, 60000);
      } finally {
        inFlight = false;
        if (!stopped) setLoadedKey(key);
        if (!stopped && shouldPoll && !document.hidden) timer = setTimeout(run, delay);
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      // A fresh query on returning to the page also discovers new publications.
      if (!document.hidden) void run();
    };
    void run();
    document.addEventListener('visibilitychange', visibility);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [api, user, page, size, revision, key, trash]);
  return { rows: loadedKey === key ? rows : [], error: loadedKey === key && error, count: loadedKey === key ? count : 0, loading: loadedKey !== key };
}
