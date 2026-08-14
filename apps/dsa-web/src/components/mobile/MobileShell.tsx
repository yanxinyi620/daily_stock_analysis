import type React from 'react';
import { Outlet } from 'react-router-dom';
import { ThemeToggle } from '../theme/ThemeToggle';
import { MobileBottomNav } from './MobileBottomNav';

type MobileShellProps = {
  children?: React.ReactNode;
};

export const MobileShell: React.FC<MobileShellProps> = ({ children }) => (
  <div
    className="relative min-h-[100dvh] overflow-hidden bg-background text-foreground md:hidden"
    data-testid="mobile-shell"
  >
    <header className="absolute inset-x-0 top-0 z-40 border-b border-border/60 bg-background/88 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary-gradient text-xs font-black text-primary-foreground shadow-glow-cyan">
            D
          </span>
          <div>
            <p className="text-sm font-bold leading-none text-foreground">DSA</p>
            <p className="mt-1 text-[10px] tracking-[0.12em] text-muted-text">MOBILE DESK</p>
          </div>
        </div>
        <ThemeToggle />
      </div>
    </header>

    <main
      className="h-[100dvh] overflow-y-auto overscroll-y-contain px-3 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-[calc(3.5rem+env(safe-area-inset-top))] touch-pan-y"
      data-testid="mobile-content-scroll"
    >
      <div className="mx-auto min-h-full max-w-lg py-3">
        {children ?? <Outlet />}
      </div>
    </main>

    <MobileBottomNav />
  </div>
);
