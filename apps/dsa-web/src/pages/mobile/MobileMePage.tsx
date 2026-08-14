import { Bell, BriefcaseBusiness, ChevronRight, Gauge, Lightbulb, MonitorCog } from 'lucide-react';
import { Link } from 'react-router-dom';
import { UiLanguageToggle } from '../../components/i18n/UiLanguageToggle';
import { ThemeToggle } from '../../components/theme/ThemeToggle';
import { useUiLanguage } from '../../contexts/UiLanguageContext';

const MobileMePage = () => {
  const { t } = useUiLanguage();
  const items = [
    { label: '持仓', description: '查看组合与盈亏', to: '/portfolio', icon: BriefcaseBusiness },
    { label: 'AI 建议', description: '跟踪决策信号', to: '/decision-signals', icon: Lightbulb },
    { label: '告警', description: '价格与风险提醒', to: '/alerts', icon: Bell },
    { label: '用量', description: '模型调用统计', to: '/usage', icon: Gauge },
  ];
  return <section className="space-y-4" aria-labelledby="mobile-me-title">
    <header><p className="text-xs font-semibold tracking-[0.16em] text-cyan">ACCOUNT</p><h1 id="mobile-me-title" className="mt-1 text-2xl font-black">{t('mobile.me.title')}</h1></header>
    <div className="grid grid-cols-2 gap-2.5">{items.map(({ label, description, to, icon: Icon }) => <Link key={to} aria-label={label} to={to} className="rounded-2xl border border-border bg-card p-4 shadow-sm"><Icon className="h-5 w-5 text-cyan" /><h2 className="mt-4 text-sm font-black">{label}</h2><p className="mt-1 text-xs leading-5 text-muted-text">{description}</p></Link>)}</div>
    <section className="rounded-2xl border border-border bg-card p-4"><h2 className="text-sm font-black">显示偏好</h2><div className="mt-3 flex items-center justify-between"><span className="text-sm text-secondary-text">主题与语言</span><div className="flex items-center gap-2"><ThemeToggle /><UiLanguageToggle /></div></div></section>
    <section className="rounded-2xl border border-warning/20 bg-warning/5 p-4"><div className="flex gap-3"><MonitorCog className="mt-0.5 h-5 w-5 shrink-0 text-warning" /><div><h2 className="text-sm font-black">{t('mobile.me.desktopTitle')}</h2><p className="mt-1 text-xs leading-5 text-secondary-text">{t('mobile.me.desktopDescription')}</p><Link to="/settings" className="mt-3 flex min-h-11 items-center justify-between text-sm font-semibold text-cyan">打开桌面设置 <ChevronRight className="h-4 w-4" /></Link></div></div></section>
  </section>;
};
export default MobileMePage;
