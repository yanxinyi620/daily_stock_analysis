import { useEffect, useState } from 'react';
import type { CloudData, PublishTask } from './client';

/** Poll only unfinished publication tasks; back off failures and pause hidden tabs. */
export function usePublishTasks(api: CloudData, user: string, revision: number) {
  const [rows, setRows] = useState<PublishTask[]>([]);
  const [error, setError] = useState(false);
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
        const result = await api.tasks(user);
        if (stopped) return;
        setRows(result.rows); setError(false);
        shouldPoll = result.active; delay = 5000;
      } catch {
        if (stopped) return;
        setError(true); delay = Math.min(delay * 2, 60000);
      } finally {
        inFlight = false;
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
  }, [api, user, revision]);
  return { rows, error };
}
