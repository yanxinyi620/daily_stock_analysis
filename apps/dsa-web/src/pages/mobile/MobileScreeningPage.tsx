import { ArrowLeft, Play, Trophy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { screeningApi } from '../../api/screening';
import type { ScreeningCandidate, ScreeningRunSummary, ScreeningStrategy } from '../../api/screening';

const MobileScreeningPage = () => {
  const navigate = useNavigate();
  const mountedRef = useRef(true);
  const [strategies, setStrategies] = useState<ScreeningStrategy[]>([]);
  const [history, setHistory] = useState<ScreeningRunSummary[]>([]);
  const [strategy, setStrategy] = useState('');
  const [candidates, setCandidates] = useState<ScreeningCandidate[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    mountedRef.current = true;
    void Promise.all([screeningApi.getStrategies(), screeningApi.getHistory({ limit: 10 })]).then(([strategyResult, historyResult]) => {
      if (!active) return;
      setStrategies(strategyResult.strategies); setStrategy(strategyResult.strategies[0]?.id || ''); setHistory(historyResult.runs);
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : '选股配置加载失败'); });
    return () => { active = false; mountedRef.current = false; };
  }, []);

  const waitForTask = async (taskId: string) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const task = await screeningApi.getScreenTask(taskId);
      if (!mountedRef.current) return;
      setProgress(task.progress ?? 0);
      if (task.status === 'completed' && task.result) { setCandidates(task.result.candidates); return; }
      if (task.status === 'failed') { setError(task.error || '选股任务失败'); return; }
      await new Promise(resolve => window.setTimeout(resolve, 1000));
    }
    if (mountedRef.current) setError('选股任务仍在运行，请稍后从历史记录查看');
  };

  const start = async () => {
    if (!strategy) return;
    setError(null); setCandidates([]); setProgress(0);
    try {
      const accepted = await screeningApi.startScreen({ market: 'cn', strategy, maxResults: 5 });
      await waitForTask(accepted.taskId);
    } catch (err) { setError(err instanceof Error ? err.message : '选股任务失败'); }
  };

  const openRun = async (runId: string) => {
    try { const run = await screeningApi.getRun(runId); setCandidates(run.result.candidates); }
    catch (err) { setError(err instanceof Error ? err.message : '历史结果加载失败'); }
  };

  return <section className="space-y-4" aria-labelledby="mobile-screening-title">
    <header className="flex items-center gap-3"><button type="button" aria-label="返回" onClick={() => navigate(-1)} className="grid min-h-11 min-w-11 place-items-center rounded-2xl border border-border bg-card"><ArrowLeft className="h-4 w-4" /></button><div><p className="text-xs font-semibold tracking-[0.16em] text-cyan">SCREENER</p><h1 id="mobile-screening-title" className="text-xl font-black">智能选股</h1></div></header>
    <section className="rounded-3xl border border-cyan/20 bg-card p-4"><label className="text-xs font-semibold text-muted-text">选股策略<select value={strategy} onChange={event => setStrategy(event.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground">{strategies.map(item => <option key={item.id} value={item.id}>{item.name || item.title}</option>)}</select></label>{strategies.find(item => item.id === strategy)?.description ? <p className="mt-3 text-xs leading-5 text-secondary-text">{strategies.find(item => item.id === strategy)?.description}</p> : null}<button type="button" aria-label="开始选股" onClick={() => void start()} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-cyan text-sm font-black text-primary-foreground"><Play className="h-4 w-4" />开始选股</button>{progress !== null && !candidates.length ? <p className="mt-3 text-center text-xs text-cyan">任务进度 {progress}%</p> : null}{error ? <p role="alert" className="mt-3 text-xs text-danger">{error}</p> : null}</section>
    {candidates.length ? <div className="space-y-2.5"><h2 className="text-sm font-black">候选结果</h2>{candidates.map(item => <article key={item.code} className="rounded-2xl border border-border bg-card p-4"><div className="flex items-center justify-between"><div><h3 className="font-bold">{item.name}</h3><p className="font-mono text-xs text-muted-text">{item.code}</p></div><span className="flex items-center gap-1 rounded-full bg-cyan/10 px-2.5 py-1 text-xs font-bold text-cyan"><Trophy className="h-3.5 w-3.5" />#{item.rank}</span></div><p className="mt-3 text-sm leading-6 text-secondary-text">{item.reason}</p></article>)}</div> : null}
    <div className="space-y-2"><div className="flex items-center justify-between"><h2 className="text-sm font-black">最近历史</h2><span className="text-xs text-muted-text">历史 {history.length} 次</span></div>{history.map(run => <button key={run.runId} type="button" onClick={() => void openRun(run.runId)} className="flex min-h-12 w-full items-center justify-between rounded-2xl border border-border bg-card px-4 text-left text-sm"><span>{run.strategy} · {run.market}</span><span className="text-xs text-muted-text">{run.candidateCount} 只</span></button>)}</div>
  </section>;
};
export default MobileScreeningPage;
