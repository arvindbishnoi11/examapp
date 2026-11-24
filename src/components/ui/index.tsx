// =============================================================================
// UI primitives shared by the student and admin apps.
// Kept dependency-free and small so the bundle stays light on budget phones.
// =============================================================================

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Info, Inbox, Loader2, X } from 'lucide-react';

// ---- Card -------------------------------------------------------------------
export function Card({ children, className = '', as: Tag = 'div', ...rest }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'article' } & Record<string, unknown>) {
  return (
    <Tag className={`rounded-xl2 border border-slate-200/80 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900 ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, subtitle, action, className = '' }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5 dark:border-slate-800 sm:px-5 ${className}`}>
      <div className="min-w-0">
        <h3 className="truncate text-[15px] font-semibold text-slate-900 dark:text-white">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// ---- Badge ------------------------------------------------------------------
export type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'neutral';
const TONES: Record<Tone, string> = {
  brand: 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300',
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  danger: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
  neutral: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

export function Badge({ tone = 'neutral', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

// ---- Empty / loading / error states -----------------------------------------
export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl2 border border-dashed border-slate-200 px-6 py-12 text-center dark:border-slate-800">
      <div className="rounded-full bg-slate-100 p-3 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
        {icon ?? <Inbox className="h-6 w-6" aria-hidden />}
      </div>
      <div>
        <p className="font-semibold text-slate-800 dark:text-slate-100">{title}</p>
        {description ? <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500 dark:text-slate-400" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span>{label ?? 'Loading…'}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl2 border border-rose-200 bg-rose-50/60 px-6 py-10 text-center dark:border-rose-900/60 dark:bg-rose-950/30">
      <AlertCircle className="h-6 w-6 text-rose-500" aria-hidden />
      <p className="max-w-sm text-sm text-rose-700 dark:text-rose-300">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="text-sm font-semibold text-rose-700 underline underline-offset-4 dark:text-rose-300">
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function CardSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="card overflow-hidden p-3">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="mt-3 h-4 w-4/5" />
          <Skeleton className="mt-2 h-3 w-2/5" />
        </div>
      ))}
    </div>
  );
}

// ---- Stat tile ---------------------------------------------------------------
export function StatTile({ label, value, hint, icon, tone = 'brand' }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-xl2 border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
        {icon ? <span className={`rounded-lg p-1.5 ${TONES[tone]}`}>{icon}</span> : null}
      </div>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p> : null}
    </div>
  );
}

// ---- Form field --------------------------------------------------------------
export function Field({ label, htmlFor, error, hint, required, children }: { label: string; htmlFor?: string; error?: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-slate-300">
        {label}
        {required ? <span className="ml-0.5 text-rose-500">*</span> : null}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p> : null}
      {!error && hint ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p> : null}
    </div>
  );
}

// ---- Modal -------------------------------------------------------------------
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus the first focusable element for keyboard users.
    const timer = window.setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>('input,select,textarea,button:not([data-close])');
      focusable?.focus();
    }, 60);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`flex max-h-[92vh] w-full ${widths[size]} animate-scale-in flex-col overflow-hidden rounded-t-2xl bg-white shadow-float dark:bg-slate-900 sm:rounded-2xl`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-slate-900 dark:text-white">
              {title}
            </h2>
            {description ? <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} data-close aria-label="Close dialog" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-3.5 dark:border-slate-800">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

// ---- Alert -------------------------------------------------------------------
export function Alert({ tone = 'info', title, children }: { tone?: 'info' | 'success' | 'warning' | 'error'; title?: string; children?: ReactNode }) {
  const styles = {
    info: 'border-brand-200 bg-brand-50/70 text-brand-900 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-200',
    success: 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
    warning: 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
    error: 'border-rose-200 bg-rose-50/70 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
  } as const;
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'error' ? AlertCircle : tone === 'warning' ? AlertCircle : Info;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${styles[tone]}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div> : null}
      </div>
    </div>
  );
}

// ---- Progress ----------------------------------------------------------------
export function ProgressBar({ value, className = '', tone = 'brand' }: { value: number; className?: string; tone?: 'brand' | 'success' | 'amber' | 'rose' }) {
  const clamped = Math.max(0, Math.min(100, value));
  const colours = { brand: 'bg-brand-500', success: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500' } as const;
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800 ${className}`} role="progressbar" aria-valuenow={Math.round(clamped)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-[width] duration-500 ease-out ${colours[tone]}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

// ---- Tabs --------------------------------------------------------------------
export function Tabs<T extends string>({ tabs, value, onChange, className = '' }: { tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (value: T) => void; className?: string }) {
  return (
    <div role="tablist" className={`no-scrollbar flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 dark:bg-slate-800/70 ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          aria-selected={value === tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-semibold transition ${
            value === tab.value ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          {tab.label}
          {tab.count !== undefined ? <span className="ml-1.5 text-[11px] font-medium opacity-60">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ---- Confirm dialog ----------------------------------------------------------
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading,
  onConfirm,
  onClose,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  onClose?: () => void;
  onCancel?: () => void;
  children?: ReactNode;
}) {
  const close = onClose ?? onCancel ?? (() => undefined);
  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" onClick={close} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-60 ${tone === 'danger' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-brand-600 hover:bg-brand-700'}`}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      {description ? <div className="text-sm text-slate-600 dark:text-slate-400">{description}</div> : null}
      {children}
    </Modal>
  );
}

// ---- Pagination --------------------------------------------------------------
export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 pt-3">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
      >
        Previous
      </button>
      <span className="text-xs text-slate-500 dark:text-slate-400">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
      >
        Next
      </button>
    </div>
  );
}
