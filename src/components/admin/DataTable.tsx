import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { Spinner } from '@/components/ui';

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  hideOnMobile?: boolean;
};

export function DataTable<T>({
  rows,
  columns,
  loading,
  error,
  emptyMessage = 'Nothing here yet.',
  emptyAction,
  page,
  totalPages,
  total,
  onPage,
  onRowClick,
  rowKey,
}: {
  rows: T[];
  columns: Column<T>[];
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  emptyAction?: ReactNode;
  page?: number;
  totalPages?: number;
  total?: number;
  onPage?: (page: number) => void;
  onRowClick?: (row: T) => void;
  rowKey: (row: T) => string;
}) {
  if (loading) {
    return (
      <div className="grid place-items-center rounded-xl2 border border-slate-200 bg-white py-16 dark:border-slate-800 dark:bg-slate-900">
        <Spinner label="Loading…" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl2 border border-rose-200 bg-rose-50 p-4 text-[13px] text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
        {error}
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl2 border border-dashed border-slate-300 bg-white px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-900">
        <Inbox className="h-7 w-7 text-slate-300 dark:text-slate-600" aria-hidden />
        <p className="text-[13.5px] font-medium text-slate-600 dark:text-slate-300">{emptyMessage}</p>
        {emptyAction}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl2 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={`${column.className ?? ''} ${column.hideOnMobile ? 'hidden md:table-cell' : ''}`}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? 'cursor-pointer' : undefined}
              >
                {columns.map((column) => (
                  <td key={column.key} className={`${column.className ?? ''} ${column.hideOnMobile ? 'hidden md:table-cell' : ''}`}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onPage && totalPages && totalPages > 1 ? (
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 dark:border-slate-800">
          <span className="text-[11.5px] text-slate-500 dark:text-slate-400">
            Page {page} of {totalPages}{typeof total === 'number' ? ` · ${total} total` : ''}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onPage((page ?? 1) - 1)}
              disabled={(page ?? 1) <= 1}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => onPage((page ?? 1) + 1)}
              disabled={(page ?? 1) >= totalPages}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
