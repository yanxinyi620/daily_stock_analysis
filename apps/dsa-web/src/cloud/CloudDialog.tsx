import { useEffect, useId, useRef, type ReactNode } from 'react';

export function CloudDialog({ title, onClose, children, busy = false }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean }) {
  const headingId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => { onCloseRef.current = onClose; busyRef.current = busy; }, [onClose, busy]);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const firstControl = dialogRef.current?.querySelector<HTMLElement>('input, select, button, textarea, [href]');
    firstControl?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); onCloseRef.current(); }
      if (event.key !== 'Tab') return;
      const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('input:not([disabled]), select:not([disabled]), button:not([disabled]), textarea:not([disabled]), [href]') ?? [])];
      if (!controls.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); opener?.focus(); };
  }, []);
  return <div className="cloud-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCloseRef.current(); }}>
    <div ref={dialogRef} className="cloud-dialog" role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1}>
      <div className="cloud-section-heading"><h2 id={headingId}>{title}</h2><button type="button" aria-label="关闭" disabled={busy} onClick={onClose}>关闭</button></div>
      {children}
    </div>
  </div>;
}
