import type React from 'react';
import { Home, ListChecks, MessageSquareQuote, Star, UserRound } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { cn } from '../../utils/cn';

const MOBILE_NAV_ITEMS = [
  { to: '/m', labelKey: 'mobile.nav.home', icon: Home, end: true },
  { to: '/m/watchlist', labelKey: 'mobile.nav.watchlist', icon: Star, end: false },
  { to: '/m/chat', labelKey: 'mobile.nav.chat', icon: MessageSquareQuote, end: false },
  { to: '/m/tasks', labelKey: 'mobile.nav.tasks', icon: ListChecks, end: false },
  { to: '/m/me', labelKey: 'mobile.nav.me', icon: UserRound, end: false },
] as const;

export const MobileBottomNav: React.FC = () => {
  const { t } = useUiLanguage();
  return (
  <nav
    aria-label={t('mobile.nav.label')}
    className="fixed inset-x-0 bottom-0 z-50 border-t border-border/70 bg-background/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    data-testid="mobile-bottom-nav"
  >
    <div className="mx-auto grid h-16 max-w-lg grid-cols-5 px-1">
      {MOBILE_NAV_ITEMS.map(({ to, labelKey, icon: Icon, end }) => {
        const label = t(labelKey);
        return (
        <NavLink
          key={to}
          to={to}
          end={end}
          aria-label={label}
          className={({ isActive }) => cn(
            'relative flex min-h-11 min-w-11 flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-medium transition-colors',
            isActive ? 'text-cyan' : 'text-secondary-text active:bg-hover',
          )}
        >
          {({ isActive }) => (
            <>
              <span className={cn(
                'grid h-7 w-10 place-items-center rounded-full transition-colors',
                isActive ? 'bg-cyan/12' : '',
              )}>
                <Icon className="h-[19px] w-[19px]" aria-hidden="true" />
              </span>
              <span>{label}</span>
              {isActive ? <span className="absolute top-0 h-0.5 w-5 rounded-full bg-cyan" /> : null}
            </>
          )}
        </NavLink>
        );
      })}
    </div>
  </nav>
  );
};
