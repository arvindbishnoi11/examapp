import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { apiBlob, errorMessage } from '@/lib/api';

/** Page header used by every admin screen. */
export function PageHeader({
  title,
  description,
  actions,
  onRefresh,
  refreshing,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h1 className="font-display text-lg font-bold sm:text-xl">{title}</h1>
        {description ? <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-slate-400">{description}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {onRefresh ? (
          <Button variant="secondary" size="sm" icon={<RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />} onClick={onRefresh}>
            Refresh
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Search input that debounces before calling `onChange`. */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [local, setLocal] = useState(value);
  const debounced = useDebouncedValue(local, 350);
  const lastPushed = useRef(value);
  // Keep a ref to the latest callback so the debounce effect does not re-run
  // when the parent re-renders with an inline arrow function.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Push debounced values from an effect — never during render, which would
  // warn about updating a component while rendering another one.
  useEffect(() => {
    if (debounced === lastPushed.current) return;
    lastPushed.current = debounced;
    onChangeRef.current(debounced);
  }, [debounced]);

  // Adopt external resets (e.g. a "clear filters" button) without fighting typing.
  useEffect(() => {
    if (value === lastPushed.current) return;
    lastPushed.current = value;
    setLocal(value);
  }, [value]);

  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
      <input
        type="search"
        value={local}
        onChange={(event) => setLocal(event.target.value)}
        placeholder={placeholder}
        className="input h-9 py-0 pl-8 text-[13px]"
        aria-label={placeholder}
      />
    </div>
  );
}

export function FilterSelect({
  value,
  onChange,
  options,
  label,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`input h-9 w-auto py-0 text-[13px] ${className}`}
      aria-label={label}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

/** Downloads a server CSV export using the authenticated API client. */
export async function downloadExport(path: string, filename: string) {
  const blob = await apiBlob(path);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function ExportButton({ onClick, label = 'Export CSV' }: { onClick: () => Promise<void> | void; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={busy}
      icon={<Download className="h-3.5 w-3.5" aria-hidden />}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </Button>
  );
}

/** Inline empty-state helper for panels. */
export function Panel({ title, action, children, className = '' }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl2 border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      {title || action ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title ? <h2 className="text-[14px] font-semibold">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function friendlyError(error: unknown): string {
  return errorMessage(error);
}
