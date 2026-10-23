import { useEffect, useRef, type ReactNode } from 'react';

export function AgendaDialog({ title, onClose, pending = false, children }: { title: string; onClose: () => void; pending?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    return () => { if (typeof dialog.close === 'function') dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="agenda-dialog" aria-label={title} onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}>
    <header><h2>{title}</h2><button type="button" className="text-button" onClick={onClose} disabled={pending}>Fechar</button></header>
    {children}
  </dialog>;
}
