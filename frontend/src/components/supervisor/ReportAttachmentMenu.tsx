import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { FileSpreadsheet, Plus } from 'lucide-react';

export function ReportAttachmentMenu({ triggerRef, onImport, disabled }: {
  triggerRef: RefObject<HTMLButtonElement | null>;
  onImport: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const item = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    item.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  return <div ref={wrapper} className="absolute bottom-3 left-3"
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => {
      if (event.key === 'Escape' && open) {
        event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus();
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); setOpen(true); item.current?.focus();
      }
    }}>
    <button ref={triggerRef} type="button" disabled={disabled} aria-label="Add attachment"
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen(value => !value)}
      className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-[#123F77] transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40">
      <Plus size={21} aria-hidden="true" />
    </button>
    {open && <div id={menuId} role="menu" aria-label="Attachments"
      className="absolute bottom-full left-0 z-10 mb-2 w-64 max-w-[calc(100vw-4rem)] rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_12px_35px_-12px_rgba(15,38,76,0.25)]">
      <button ref={item} role="menuitem" type="button" tabIndex={-1} aria-label="Import Excel / CSV" aria-describedby={`${menuId}-description`}
        onClick={() => { setOpen(false); onImport(); }}
        className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[#123F77] hover:bg-blue-50 focus:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        <FileSpreadsheet size={19} className="shrink-0" aria-hidden="true" />
        <span><span className="block text-sm font-semibold">Import Excel / CSV</span>
          <span id={`${menuId}-description`} className="mt-0.5 block text-xs text-slate-500">Multiple field reports</span></span>
      </button>
    </div>}
  </div>;
}
