import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Lock, Save, ShieldCheck, XCircle } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, Spinner } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { PageHeader, Panel } from '@/components/admin/AdminUI';
import { formatDateTime } from '@/lib/format';

type SettingRow = {
  key: string;
  value: string | null;
  value_type: 'string' | 'boolean' | 'number' | 'json';
  category: string;
  label: string | null;
  description: string | null;
  is_public: number;
  updated_at: string;
};

type SettingsResponse = {
  settings: SettingRow[];
  grouped: Record<string, SettingRow[]>;
  canManage: boolean;
  isSuperAdmin: boolean;
  health: { sheets: boolean; youtube: boolean; fcm: { configured?: boolean; [key: string]: unknown }; environment: string };
};

type Integrations = {
  googleSheets: { configured: boolean; requiredSecret: string; serviceAccount: string; instructions: string };
  youtube: { configured: boolean; requiredSecret: string };
  firebaseMessaging: { configured?: boolean; requiredSecret: string; [key: string]: unknown };
  cloudflare: { d1: boolean; r2: boolean; assets: boolean };
};

const SUPER_ADMIN_KEYS = new Set([
  'site.maintenance_mode',
  'features.registration_open',
  'features.push_notifications',
  'storage.test_paper_provider',
  'storage.max_pdf_mb',
  'sheets.spreadsheet_id',
  'sheets.sync_enabled',
  'sheets.sync_interval_minutes',
  'youtube.metadata_enabled',
  'cache.catalogue_ttl_seconds',
]);

const CATEGORY_META: Record<string, { title: string; description: string }> = {
  general: { title: 'General', description: 'Name, support contact and feature switches shown across the app.' },
  exams: { title: 'Examinations', description: 'Defaults applied to new questions, autosave cadence and the server grace window.' },
  sync: { title: 'Google Sheets', description: 'Spreadsheet source and the schedule for automatic content synchronisation.' },
  content: { title: 'Content', description: 'Behaviour for lectures and YouTube metadata.' },
  storage: { title: 'Storage', description: 'Where PDFs are stored and the maximum upload size.' },
  performance: { title: 'Performance', description: 'Edge caching for the public catalogue.' },
};

export default function AdminSettingsPage() {
  useDocumentTitle('Platform settings');
  const toast = useToast();
  const { isSuperAdmin } = useAuth();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const settings = useApiQuery<SettingsResponse>('/api/admin/settings');
  const integrations = useApiQuery<Integrations>('/api/admin/settings/integrations');

  useEffect(() => {
    if (!settings.data) return;
    setDraft(Object.fromEntries(settings.data.settings.map((row) => [row.key, row.value ?? ''])));
  }, [settings.data]);

  const dirtyKeys = useMemo(() => {
    if (!settings.data) return [] as string[];
    return settings.data.settings.filter((row) => (draft[row.key] ?? '') !== (row.value ?? '')).map((row) => row.key);
  }, [draft, settings.data]);

  const save = async () => {
    if (!dirtyKeys.length) return;
    setBusy(true);
    setError(null);
    try {
      await api.put('/api/admin/settings', { updates: dirtyKeys.map((key) => ({ key, value: draft[key] })) });
      setSavedAt(new Date().toISOString());
      toast.success(`${dirtyKeys.length} setting(s) saved`);
      settings.refetch();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo(() => {
    const grouped = settings.data?.grouped ?? {};
    return Object.keys(grouped)
      .sort((a, b) => (Object.keys(CATEGORY_META).indexOf(a) + 1 || 99) - (Object.keys(CATEGORY_META).indexOf(b) + 1 || 99))
      .map((category) => ({ category, rows: grouped[category] }));
  }, [settings.data]);

  if (settings.error) {
    return <Alert tone="error" title="Settings could not be loaded">{settings.error}</Alert>;
  }

  return (
    <div>
      <PageHeader
        title="Platform settings"
        description="Typed, validated and audited configuration. Changes take effect immediately."
        onRefresh={settings.refetch}
        refreshing={settings.loading}
        actions={
          settings.data?.canManage ? (
            <Button
              size="sm"
              icon={<Save className="h-3.5 w-3.5" aria-hidden />}
              loading={busy}
              disabled={!dirtyKeys.length}
              onClick={save}
            >
              Save {dirtyKeys.length ? `${dirtyKeys.length} change${dirtyKeys.length === 1 ? '' : 's'}` : 'changes'}
            </Button>
          ) : undefined
        }
      />

      {error ? <div className="mb-3"><Alert tone="error">{error}</Alert></div> : null}
      {savedAt ? (
        <div className="mb-3 flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Saved at {formatDateTime(savedAt)}. Audit log updated.
        </div>
      ) : null}

      {!isSuperAdmin && settings.data && !settings.data.isSuperAdmin ? (
        <Alert tone="info" title="Some settings are locked">
          Settings marked with a lock can only be changed by the Super Admin account. Everyone else sees them read-only.
        </Alert>
      ) : null}

      {settings.loading && !settings.data ? <div className="grid place-items-center py-16"><Spinner /></div> : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-3">
          {groups.map(({ category, rows }) => {
            const meta = CATEGORY_META[category] ?? { title: category, description: '' };
            return (
              <Panel key={category} title={meta.title}>
                {meta.description ? <p className="mb-2 text-[11.5px] text-slate-500">{meta.description}</p> : null}
                <div className="space-y-2.5">
                  {rows.map((row) => {
                    const locked = SUPER_ADMIN_KEYS.has(row.key) && !isSuperAdmin;
                    const value = draft[row.key] ?? '';
                    return (
                      <div key={row.key} className="grid gap-1.5 sm:grid-cols-[1fr_190px] sm:items-center sm:gap-3">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1 text-[12.5px] font-semibold">
                            {row.label ?? row.key}
                            {locked ? <Lock className="h-3 w-3 text-amber-500" aria-label="Super admin only" /> : null}
                            {row.is_public ? <Badge tone="neutral">public</Badge> : null}
                          </p>
                          <p className="text-[10.5px] text-slate-500">{row.description ?? <code>{row.key}</code>}</p>
                        </div>
                        {row.value_type === 'boolean' ? (
                          <label className="inline-flex items-center gap-2 text-[11.5px]">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300 text-brand-600"
                              checked={value === 'true'}
                              disabled={locked || !settings.data?.canManage}
                              onChange={(event) => setDraft((current) => ({ ...current, [row.key]: event.target.checked ? 'true' : 'false' }))}
                            />
                            {value === 'true' ? 'Enabled' : 'Disabled'}
                          </label>
                        ) : row.value_type === 'number' ? (
                          <input
                            type="number"
                            className="input h-8 py-0 text-[12.5px]"
                            value={value}
                            disabled={locked || !settings.data?.canManage}
                            onChange={(event) => setDraft((current) => ({ ...current, [row.key]: event.target.value }))}
                          />
                        ) : (
                          <input
                            type={row.key.includes('email') ? 'email' : 'text'}
                            className="input h-8 py-0 text-[12.5px]"
                            value={value}
                            disabled={locked || !settings.data?.canManage}
                            onChange={(event) => setDraft((current) => ({ ...current, [row.key]: event.target.value }))}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </Panel>
            );
          })}
        </div>

        <div className="space-y-3">
          <Panel title="Integration status">
            <ul className="space-y-2 text-[12px]">
              {[
                { label: 'Google Sheets', ok: integrations.data?.googleSheets.configured, secret: integrations.data?.googleSheets.requiredSecret },
                { label: 'YouTube Data API', ok: integrations.data?.youtube.configured, secret: integrations.data?.youtube.requiredSecret },
                { label: 'Firebase Cloud Messaging', ok: integrations.data?.firebaseMessaging.configured, secret: integrations.data?.firebaseMessaging.requiredSecret },
                { label: 'D1 database', ok: integrations.data?.cloudflare.d1, secret: 'wrangler.jsonc binding' },
                { label: 'R2 media bucket', ok: integrations.data?.cloudflare.r2, secret: 'MEDIA binding (optional)' },
              ].map((item) => (
                <li key={item.label} className="flex items-start gap-2">
                  {item.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden />}
                  <div>
                    <p className="font-medium">{item.label}</p>
                    {!item.ok ? <p className="text-[10.5px] text-slate-500">Add <code>{item.secret}</code></p> : null}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10.5px] text-slate-400">
              Environment <strong>{settings.data?.health.environment ?? 'development'}</strong>. Secrets are Worker secrets —
              never stored in the database or the bundle.
            </p>
          </Panel>

          <Panel title="Setup notes">
            <div className="space-y-2 text-[11.5px] leading-relaxed text-slate-600 dark:text-slate-400">
              <p><strong>Google Sheets.</strong> Share the spreadsheet with the service-account email as an Editor. Enable the Sheets API in the same cloud project.</p>
              <p><strong>YouTube.</strong> An API key only raises metadata quality; lectures can always be added by hand with a URL.</p>
              <p><strong>FCM.</strong> Requires an HTTP v1 service account JSON. Web push also needs a VAPID key in <code>public/env.js</code>.</p>
              <p><strong>Payments.</strong> PrepSetu has no payment gateway — freezing/marking courses as paid only controls visibility to free users.</p>
            </div>
          </Panel>

          <Panel title="Danger zone">
            <div className="space-y-2 text-[11.5px]">
              <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Maintenance mode hides the student app but keeps the admin console reachable. Turn it off before you leave.
              </p>
              <p className="flex items-center gap-1.5 text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Only a Super Admin can toggle maintenance mode and integration settings.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
