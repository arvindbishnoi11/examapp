import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApi';
import { useToast } from '@/context/ToastContext';
import { Alert, ConfirmDialog, Modal } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/admin/DataTable';
import { PageHeader, SearchInput } from '@/components/admin/AdminUI';
import type { Paginated } from '@shared/types';

export type FieldDef = {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'tags' | 'url' | 'date' | 'datetime';
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  hint?: string;
  span?: 1 | 2;
  min?: number;
  max?: number;
  step?: number;
};

export type ResourceConfig<T> = {
  title: string;
  description?: string;
  listPath: string;
  /** Base path for POST; defaults to `listPath`. */
  createPath?: string;
  updatePath: (row: T) => string;
  deletePath: (row: T) => string;
  rowKey: (row: T) => string;
  columns: Column<T>[];
  fields: FieldDef[];
  /** Map an API row into form values (defaults to reading the same keys). */
  toForm?: (row: T | null) => Record<string, unknown>;
  defaults?: Record<string, unknown>;
  filters?: { key: string; label: string; options: { value: string; label: string }[] }[];
  searchPlaceholder?: string;
  query?: Record<string, string | number | undefined>;
  extraQuery?: Record<string, string | number | undefined>;
  emptyMessage?: string;
  headerActions?: ReactNode;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  rowActions?: (row: T, helpers: { refresh: () => void }) => ReactNode;
  /** Optional transform before sending to the API. */
  prepare?: (values: Record<string, unknown>) => Record<string, unknown>;
  pageSize?: number;
  createLabel?: string;
};

/**
 * Generic admin CRUD screen: list + search + filters + create/edit modal +
 * delete confirmation. Every operation hits the real, permission-checked API.
 */
export function ResourceManager<T>({
  title,
  description,
  listPath,
  createPath,
  updatePath,
  deletePath,
  rowKey,
  columns,
  fields,
  toForm,
  defaults = {},
  filters = [],
  searchPlaceholder = 'Search…',
  query = {},
  emptyMessage = 'Nothing here yet.',
  headerActions,
  canCreate = true,
  canEdit = true,
  canDelete = true,
  rowActions,
  prepare,
  pageSize = 30,
  createLabel = 'New',
}: ResourceConfig<T>) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<T | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);

  const queryParams = useMemo(
    () => ({ ...query, ...filterValues, q: search || undefined, page, pageSize }),
    [query, filterValues, search, page, pageSize],
  );

  const list = useApiQuery<Paginated<T> & { items: T[] }>(listPath, queryParams, { deps: [JSON.stringify(queryParams)] });

  const rows = list.data?.items ?? [];
  const allColumns: Column<T>[] = useMemo(() => {
    if (!rowActions && !canEdit && !canDelete) return columns;
    return [
      ...columns,
      {
        key: '__actions',
        header: '',
        className: 'text-right whitespace-nowrap',
        render: (row) => (
          <div className="flex flex-wrap items-center justify-end gap-1">
            {rowActions?.(row, { refresh: () => list.refetch() })}
            {canEdit ? (
              <button
                type="button"
                onClick={() => setEditing(row)}
                className="rounded border border-slate-200 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Edit
              </button>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                onClick={() => setDeleting(row)}
                className="rounded border border-rose-200 px-2 py-0.5 text-[10.5px] font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950/40"
              >
                Delete
              </button>
            ) : null}
          </div>
        ),
      },
    ];
  }, [columns, rowActions, canEdit, canDelete, list]);

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        onRefresh={list.refetch}
        refreshing={list.loading}
        actions={
          <>
            {headerActions}
            {canCreate ? (
              <Button size="sm" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={() => setCreating(true)}>
                {createLabel}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={(value) => { setSearch(value); setPage(1); }}
          placeholder={searchPlaceholder}
          className="min-w-[180px] flex-1 sm:max-w-xs"
        />
        {filters.map((filter) => (
          <select
            key={filter.key}
            aria-label={filter.label}
            value={filterValues[filter.key] ?? ''}
            onChange={(event) => {
              setFilterValues((current) => ({ ...current, [filter.key]: event.target.value }));
              setPage(1);
            }}
            className="input h-9 w-auto py-0 text-[13px]"
          >
            {filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        ))}
      </div>

      <DataTable
        rows={rows}
        columns={allColumns}
        loading={list.loading && !list.data}
        error={list.error}
        rowKey={rowKey}
        page={list.data?.page}
        totalPages={list.data?.totalPages}
        total={list.data?.total}
        onPage={setPage}
        emptyMessage={search ? `No results for “${search}”.` : emptyMessage}
      />

      <ResourceForm
        open={creating || Boolean(editing)}
        onClose={() => { setCreating(false); setEditing(null); }}
        title={editing ? `Edit ${title.toLowerCase().replace(/s$/, '')}` : `New ${title.toLowerCase().replace(/s$/, '')}`}
        fields={fields}
        initial={editing ? (toForm ? toForm(editing) : (editing as unknown as Record<string, unknown>)) : { ...defaults, ...(toForm ? toForm(null) : {}) }}
        onSaved={() => { setCreating(false); setEditing(null); list.refetch(); }}
        submit={async (values) => {
          const payload = prepare ? prepare(values) : values;
          if (editing) {
            await api.put(updatePath(editing), payload);
            toast.success('Changes saved');
          } else {
            await api.post(createPath ?? listPath, payload);
            toast.success('Created');
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this item?"
        description="This cannot be undone. Items still referenced by other content may be archived instead of deleted by the server."
        confirmLabel="Delete"
        loading={busy}
        onCancel={() => setDeleting(null)}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          try {
            await api.delete(deletePath(deleting), { confirm: 'DELETE' });
            toast.success('Deleted');
            setDeleting(null);
            list.refetch();
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

/** Form modal driven by the field descriptors. */
export function ResourceForm({
  open,
  onClose,
  title,
  fields,
  initial,
  submit,
  onSaved,
  submitLabel = 'Save',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  fields: FieldDef[];
  initial: Record<string, unknown>;
  submit: (values: Record<string, unknown>) => Promise<void>;
  onSaved: () => void;
  submitLabel?: string;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setValues(initial);
      setError(null);
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, JSON.stringify(initial)]);

  const set = (name: string, value: unknown) => setValues((current) => ({ ...current, [name]: value }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              setErrors({});
              try {
                await submit(cleanValues(values, fields));
                onSaved();
              } catch (err) {
                setErrors(fieldErrors(err));
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {error ? <div className="sm:col-span-2"><Alert tone="error">{error}</Alert></div> : null}
        {fields.map((field) => (
          <div key={field.name} className={field.span === 2 ? 'sm:col-span-2' : ''}>
            {field.type === 'checkbox' ? (
              <label className="mt-5 flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={Boolean(values[field.name])}
                  onChange={(event) => set(field.name, event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="font-medium">{field.label}</span>
              </label>
            ) : (
              <>
                <label className="label" htmlFor={`field-${field.name}`}>
                  {field.label}{field.required ? <span className="text-rose-500"> *</span> : null}
                </label>
                {field.type === 'textarea' ? (
                  <textarea
                    id={`field-${field.name}`}
                    className="input min-h-[84px]"
                    value={String(values[field.name] ?? '')}
                    placeholder={field.placeholder}
                    onChange={(event) => set(field.name, event.target.value)}
                  />
                ) : field.type === 'select' ? (
                  <select
                    id={`field-${field.name}`}
                    className="input"
                    value={String(values[field.name] ?? '')}
                    onChange={(event) => set(field.name, event.target.value)}
                  >
                    <option value="">—</option>
                    {(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                ) : field.type === 'tags' ? (
                  <input
                    id={`field-${field.name}`}
                    className="input"
                    value={Array.isArray(values[field.name]) ? (values[field.name] as unknown[]).join(', ') : String(values[field.name] ?? '')}
                    placeholder={field.placeholder ?? 'comma, separated, tags'}
                    onChange={(event) => set(field.name, event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean))}
                  />
                ) : (
                  <input
                    id={`field-${field.name}`}
                    type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : field.type === 'url' ? 'url' : 'text'}
                    className="input"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={String(values[field.name] ?? '')}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      field.type === 'number'
                        ? set(field.name, event.target.value === '' ? '' : Number(event.target.value))
                        : set(field.name, event.target.value)
                    }
                  />
                )}
                {field.hint ? <p className="mt-0.5 text-[10.5px] text-slate-400">{field.hint}</p> : null}
                {errors[field.name] ? <p className="mt-0.5 text-[10.5px] text-rose-600">{errors[field.name]}</p> : null}
              </>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** Drops empty strings and undefined so PATCH-style updates never clear fields accidentally. */
function cleanValues(values: Record<string, unknown>, fields: FieldDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (value === undefined) continue;
    if (field.type === 'number' && value === '') continue;
    if (typeof value === 'string' && value.trim() === '' && !field.required) {
      // Send null for optional strings so the server can decide.
      out[field.name] = null;
      continue;
    }
    out[field.name] = value;
  }
  return out;
}
