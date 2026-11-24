import { useMemo, useState } from 'react';
import { KeyRound, ShieldCheck, ShieldOff, UserPlus, Users } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, ConfirmDialog, Modal, Spinner, Tabs } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/admin/DataTable';
import { PageHeader, Panel, SearchInput } from '@/components/admin/AdminUI';
import { formatDate } from '@/lib/format';

type AdminRow = {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  roles: string[];
  roleNames: string;
  maxLevel: number;
};

type AdminList = { items: AdminRow[]; canManage: boolean; superAdminEmail: string | null };

type Role = { id: string; key: string; name: string; description: string; level: number; memberCount: number };

type PermissionMeta = {
  key: string;
  group: string;
  label: string;
  dangerous?: boolean;
};

type RolesPayload = { roles: Role[]; rolePermissions: { roleId: string; permissionKey: string }[]; permissionKeys: string[] };

type Candidate = { id: string; email: string; displayName: string | null; createdAt: string; lastLoginAt: string | null };

export default function AdminAdminsPage() {
  useDocumentTitle('Admin management');
  const { user, isSuperAdmin } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<'admins' | 'roles' | 'promote'>('admins');
  const [q, setQ] = useState('');
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [permTarget, setPermTarget] = useState<AdminRow | null>(null);
  const [roleTarget, setRoleTarget] = useState<AdminRow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AdminRow | null>(null);
  const [busy, setBusy] = useState(false);

  const admins = useApiQuery<AdminList>('/api/admin/admins');
  const roles = useApiQuery<RolesPayload>('/api/admin/admins/roles');
  const meta = useApiQuery<{ permissions: PermissionMeta[]; roles: Role[] }>('/api/admin/meta/permissions');
  const candidates = useApiQuery<{ items: Candidate[] }>('/api/admin/admins/candidates', { q: q || undefined }, {
    enabled: isSuperAdmin && tab === 'promote',
  });

  const filtered = useMemo(
    () => (admins.data?.items ?? []).filter((row) => !q || `${row.email} ${row.displayName ?? ''} ${row.roleNames}`.toLowerCase().includes(q.toLowerCase())),
    [admins.data, q],
  );

  const columns: Column<AdminRow>[] = [
    {
      key: 'person',
      header: 'Administrator',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{row.displayName ?? row.email.split('@')[0]}</p>
          <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{row.email}</p>
        </div>
      ),
    },
    { key: 'roles', header: 'Role', render: (row) => <div className="flex flex-wrap gap-1">{row.roles.map((role) => <Badge key={role} tone={role === 'super_admin' ? 'brand' : 'neutral'}>{role.replace(/_/g, ' ')}</Badge>)}</div> },
    { key: 'status', header: 'Status', render: (row) => <Badge tone={row.status === 'active' ? 'success' : 'danger'}>{row.status}</Badge> },
    { key: 'last', header: 'Last sign-in', hideOnMobile: true, render: (row) => <span className="text-[11.5px] text-slate-500">{row.lastLoginAt ? formatDate(row.lastLoginAt) : 'Never'}</span> },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (row) => {
        const self = row.id === user?.id;
        const isSuper = row.roles.includes('super_admin');
        if (!isSuperAdmin || self || isSuper) {
          return <span className="text-[10.5px] text-slate-400">{self ? 'You' : isSuper ? 'Protected' : ''}</span>;
        }
        return (
          <div className="flex flex-wrap justify-end gap-1">
            <button type="button" onClick={() => setRoleTarget(row)} className="rounded border border-slate-200 px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">Role</button>
            <button type="button" onClick={() => setPermTarget(row)} className="rounded border border-slate-200 px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">Permissions</button>
            <button type="button" onClick={() => setRevokeTarget(row)} className="rounded border border-rose-200 px-1.5 py-0.5 text-[10.5px] font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-900">Remove</button>
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Admin management"
        description="Grant and revoke administrative roles. Only the Super Admin can change access."
        onRefresh={() => { admins.refetch(); roles.refetch(); }}
        refreshing={admins.loading}
        actions={
          isSuperAdmin ? (
            <Button size="sm" icon={<UserPlus className="h-3.5 w-3.5" aria-hidden />} onClick={() => setPromoteOpen(true)}>
              Promote user
            </Button>
          ) : undefined
        }
      />

      {!isSuperAdmin ? (
        <div className="mb-3"><Alert tone="info" title="Read-only view">Only the Super Admin can create, modify or remove administrators.</Alert></div>
      ) : null}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'admins', label: 'Administrators', count: admins.data?.items.length },
          { value: 'roles', label: 'Roles', count: roles.data?.roles.length },
          ...(isSuperAdmin ? [{ value: 'promote' as const, label: 'Promote user' }] : []),
        ]}
        className="mb-3 max-w-md"
      />

      {tab === 'admins' ? (
        <>
          <div className="mb-3"><SearchInput value={q} onChange={setQ} placeholder="Filter by name, email or role" className="max-w-sm" /></div>
          <DataTable
            rows={filtered}
            columns={columns}
            loading={admins.loading && !admins.data}
            error={admins.error}
            rowKey={(row) => row.id}
            emptyMessage="No administrators besides the Super Admin."
          />
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            Super Admin is bound to <code>{admins.data?.superAdminEmail ?? 'SUPER_ADMIN_EMAIL'}</code> server-side and can never be granted or revoked through the API.
          </p>
        </>
      ) : null}

      {tab === 'roles' ? (
        <div className="space-y-3">
          {roles.loading ? <Spinner /> : (
            <div className="grid gap-3 md:grid-cols-2">
              {(roles.data?.roles ?? []).map((role) => {
                const perms = (roles.data?.rolePermissions ?? []).filter((mapping) => mapping.roleId === role.id).map((mapping) => mapping.permissionKey);
                return (
                  <Panel key={role.id} title={role.name} action={<Badge tone={role.key === 'super_admin' ? 'brand' : 'neutral'}>level {role.level}</Badge>}>
                    <p className="text-[12px] text-slate-500 dark:text-slate-400">{role.description}</p>
                    <p className="mt-1.5 text-[11px] text-slate-500">{role.memberCount} member(s) · {role.key === 'super_admin' ? 'fixed' : `${perms.length} permissions`}</p>
                    {role.key !== 'super_admin' ? (
                      <RolePermissionsEditor
                        role={role}
                        current={perms}
                        permissions={meta.data?.permissions ?? []}
                        editable={isSuperAdmin}
                        onSaved={() => roles.refetch()}
                      />
                    ) : null}
                  </Panel>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {tab === 'promote' ? (
        <Panel title="Recent users without staff access" action={<SearchInput value={q} onChange={setQ} placeholder="Search users" className="w-48" />}>
          {candidates.loading ? <Spinner /> : candidates.error ? <p className="text-[12.5px] text-rose-600">{candidates.error}</p> : !candidates.data?.items.length ? (
            <p className="text-[12.5px] text-slate-500">No candidates found. A user must sign in once before being promoted.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {candidates.data.items.map((candidate) => (
                <li key={candidate.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium">{candidate.displayName ?? candidate.email}</p>
                    <p className="truncate text-[11px] text-slate-500">{candidate.email}{candidate.lastLoginAt ? ` · active ${formatDate(candidate.lastLoginAt)}` : ''}</p>
                  </div>
                  <PromoteButton email={candidate.email} onDone={() => { admins.refetch(); candidates.refetch(); }} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      <PromoteModal open={promoteOpen} onClose={() => setPromoteOpen(false)} onDone={() => admins.refetch()} roles={roles.data?.roles ?? []} />

      <RoleChangeModal
        target={roleTarget}
        roles={(roles.data?.roles ?? []).filter((role) => role.key !== 'super_admin' && role.key !== 'student')}
        onClose={() => setRoleTarget(null)}
        onDone={() => admins.refetch()}
      />

      <PermissionOverridesModal target={permTarget} permissions={meta.data?.permissions ?? []} onClose={() => setPermTarget(null)} />

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        title="Remove administrator access?"
        description={`${revokeTarget?.email ?? ''} will lose all staff roles and any individual permission overrides, becoming a normal student account.`}
        confirmLabel="Remove access"
        loading={busy}
        onCancel={() => setRevokeTarget(null)}
        onClose={() => setRevokeTarget(null)}
        onConfirm={async () => {
          if (!revokeTarget) return;
          setBusy(true);
          try {
            await api.delete(`/api/admin/users/${revokeTarget.id}/role`);
            toast.success('Administrator access removed');
            setRevokeTarget(null);
            admins.refetch();
          } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
        }}
      />
    </div>
  );
}

function PromoteButton({ email, onDone }: { email: string; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [roleKey, setRoleKey] = useState('content_manager');
  const roles = useApiQuery<RolesPayload>('/api/admin/admins/roles');
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Promote</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Promote ${email}`}
        footer={
          <>
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={async () => {
                try {
                  await api.post('/api/admin/users', { email, roleKey });
                  toast.success('Role granted');
                  setOpen(false);
                  onDone();
                } catch (err) { toast.error(errorMessage(err)); }
              }}
            >
              Grant role
            </Button>
          </>
        }
      >
        <label className="label" htmlFor={`role-${email}`}>Role</label>
        <select id={`role-${email}`} className="input" value={roleKey} onChange={(event) => setRoleKey(event.target.value)}>
          {(roles.data?.roles ?? []).filter((role) => role.key !== 'super_admin' && role.key !== 'student').map((role) => (
            <option key={role.key} value={role.key}>{role.name} — {role.description}</option>
          ))}
        </select>
      </Modal>
    </>
  );
}

function PromoteModal({ open, onClose, onDone, roles }: { open: boolean; onClose: () => void; onDone: () => void; roles: Role[] }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [roleKey, setRoleKey] = useState('content_manager');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const assignable = roles.filter((role) => role.key !== 'super_admin' && role.key !== 'student');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Promote a user to administrator"
      description="The person must already have a PrepSetu account (they sign in once first)."
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            loading={busy}
            icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api.post('/api/admin/users', { email: email.trim(), roleKey });
                toast.success('User promoted');
                setEmail('');
                onClose();
                onDone();
              } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
            }}
          >
            Grant role
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div>
          <label className="label" htmlFor="promote-email">User email</label>
          <input id="promote-email" type="email" className="input" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teacher@example.com" />
        </div>
        <div>
          <label className="label" htmlFor="promote-role">Role</label>
          <select id="promote-role" className="input" value={roleKey} onChange={(event) => setRoleKey(event.target.value)}>
            {assignable.map((role) => <option key={role.key} value={role.key}>{role.name}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-slate-500">{assignable.find((role) => role.key === roleKey)?.description}</p>
        </div>
        <Alert tone="warning">Every promotion is written to the audit log with your identity and timestamp.</Alert>
      </div>
    </Modal>
  );
}

function RoleChangeModal({ target, roles, onClose, onDone }: { target: AdminRow | null; roles: Role[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [roleKey, setRoleKey] = useState(target?.roles[0] ?? 'content_manager');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      title={`Change role — ${target?.email ?? ''}`}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            loading={busy}
            onClick={async () => {
              if (!target) return;
              setBusy(true);
              try {
                await api.put(`/api/admin/users/${target.id}/role`, { roleKey });
                toast.success('Role updated');
                onClose();
                onDone();
              } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
            }}
          >
            Save role
          </Button>
        </>
      }
    >
      <label className="label" htmlFor="change-role">New role</label>
      <select id="change-role" className="input" value={roleKey} onChange={(event) => setRoleKey(event.target.value)}>
        {roles.map((role) => <option key={role.key} value={role.key}>{role.name}</option>)}
      </select>
      <p className="mt-2 text-[11px] text-slate-500">Existing staff roles are replaced. Use "Permissions" to add individual grants.</p>
    </Modal>
  );
}

function PermissionOverridesModal({ target, permissions, onClose }: { target: AdminRow | null; permissions: PermissionMeta[]; onClose: () => void }) {
  const toast = useToast();
  const existing = useApiQuery<{ overrides: { permissionKey: string; granted: boolean }[] }>(
    target ? `/api/admin/admins/${target.id}/permissions` : null,
    undefined,
    { enabled: Boolean(target) },
  );
  const [state, setState] = useState<Record<string, boolean | undefined>>({});
  const [busy, setBusy] = useState(false);

  const resolved = useMemo(() => {
    const map: Record<string, boolean | undefined> = {};
    for (const override of existing.data?.overrides ?? []) map[override.permissionKey] = override.granted;
    return { ...map, ...state };
  }, [existing.data, state]);

  const groups = useMemo(() => {
    const map = new Map<string, PermissionMeta[]>();
    for (const permission of permissions) {
      const list = map.get(permission.group) ?? [];
      list.push(permission);
      map.set(permission.group, list);
    }
    return Array.from(map.entries());
  }, [permissions]);

  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      title={`Permission overrides — ${target?.email ?? ''}`}
      description="Grants and denials here take precedence over the role. Deny always wins."
      size="lg"
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            loading={busy}
            onClick={async () => {
              if (!target) return;
              setBusy(true);
              try {
                const overrides = Object.entries(resolved)
                  .filter(([, value]) => value !== undefined)
                  .map(([permissionKey, granted]) => ({ permissionKey, granted }));
                await api.put(`/api/admin/admins/${target.id}/permissions`, { overrides });
                toast.success('Permission overrides saved');
                onClose();
              } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
            }}
          >
            Save overrides
          </Button>
        </>
      }
    >
      {existing.loading ? <Spinner /> : (
        <div className="space-y-3">
          {groups.map(([group, items]) => (
            <div key={group}>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{group}</p>
              <ul className="space-y-1">
                {items.map((permission) => {
                  const value = resolved[permission.key];
                  return (
                    <li key={permission.key} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-800">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-medium">{permission.label}</p>
                        <p className="truncate text-[10px] text-slate-400">{permission.key}</p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {([
                          { label: 'Inherit', value: undefined as boolean | undefined, tone: 'neutral' },
                          { label: 'Allow', value: true, tone: 'success' },
                          { label: 'Deny', value: false, tone: 'danger' },
                        ] as const).map((option) => (
                          <button
                            key={option.label}
                            type="button"
                            onClick={() => setState((current) => ({ ...current, [permission.key]: option.value }))}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              value === option.value
                                ? option.tone === 'success'
                                  ? 'bg-emerald-600 text-white'
                                  : option.tone === 'danger'
                                    ? 'bg-rose-600 text-white'
                                    : 'bg-slate-600 text-white'
                                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function RolePermissionsEditor({ role, current, permissions, editable, onSaved }: { role: Role; current: string[]; permissions: PermissionMeta[]; editable: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(current);
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, PermissionMeta[]>();
    for (const permission of permissions) {
      const list = map.get(permission.group) ?? [];
      list.push(permission);
      map.set(permission.group, list);
    }
    return Array.from(map.entries());
  }, [permissions]);

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => { setSelected(current); setOpen(true); }} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand-600">
          <KeyRound className="h-3 w-3" aria-hidden /> {editable ? 'Edit permissions' : 'View permissions'}
        </button>
        {!editable ? <span className="inline-flex items-center gap-1 text-[10.5px] text-slate-400"><ShieldOff className="h-3 w-3" aria-hidden /> Super Admin only</span> : null}
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`${role.name} permissions`}
        size="lg"
        footer={
          <>
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>Close</Button>
            {editable ? (
              <Button
                size="sm"
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.put(`/api/admin/roles/${role.id}/permissions`, { permissions: selected });
                    toast.success('Role permissions updated');
                    setOpen(false);
                    onSaved();
                  } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
                }}
              >
                Save
              </Button>
            ) : null}
          </>
        }
      >
        <div className="space-y-3">
          {groups.map(([group, items]) => (
            <div key={group}>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{group}</p>
              <div className="grid gap-1 sm:grid-cols-2">
                {items.map((permission) => (
                  <label key={permission.key} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] dark:border-slate-800">
                    <input
                      type="checkbox"
                      disabled={!editable}
                      checked={selected.includes(permission.key)}
                      onChange={(event) => setSelected((current) => event.target.checked ? [...current, permission.key] : current.filter((key) => key !== permission.key))}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600"
                    />
                    <span className={permission.dangerous ? 'text-rose-600 dark:text-rose-400' : ''}>{permission.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
