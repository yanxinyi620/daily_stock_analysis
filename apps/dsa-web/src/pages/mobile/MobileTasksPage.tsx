import { RefreshCw } from 'lucide-react';
import { useMobileDashboard } from '../../hooks/useMobileDashboard';
import { groupMobileTasks } from '../../utils/mobileTask';
import { MobileTaskCard } from '../../components/mobile/MobileTaskCard';
import { useUiLanguage } from '../../contexts/UiLanguageContext';

const MobileTasksPage = () => {
  const dashboard = useMobileDashboard();
  const { t } = useUiLanguage();
  const groups = groupMobileTasks(dashboard.tasks);
  const sections = [{ title: t('mobile.tasks.active'), items: groups.active }, { title: t('mobile.tasks.completed'), items: groups.completed }, { title: t('mobile.tasks.failed'), items: groups.failed }];
  return <section className="space-y-4" aria-labelledby="mobile-tasks-title">
    <header className="flex items-center justify-between"><div><p className="text-xs font-semibold tracking-[0.16em] text-cyan">TASK CENTER</p><h1 id="mobile-tasks-title" className="mt-1 text-2xl font-black">{t('mobile.tasks.title')}</h1></div><button type="button" aria-label={t('mobile.tasks.refresh')} onClick={() => void dashboard.refresh()} className="grid min-h-11 min-w-11 place-items-center rounded-2xl border border-border bg-card"><RefreshCw className="h-4 w-4" /></button></header>
    {sections.map(section => <div key={section.title} className="space-y-2.5"><div className="flex items-center justify-between"><h2 className="text-sm font-black">{section.title}</h2><span className="text-xs text-muted-text">{section.items.length}</span></div>{section.items.length ? section.items.map(task => <MobileTaskCard key={task.taskId} task={task} reports={dashboard.recentReports} />) : <p className="rounded-2xl border border-dashed border-border p-3 text-xs text-muted-text">{t('mobile.tasks.empty')}</p>}</div>)}
  </section>;
};
export default MobileTasksPage;
