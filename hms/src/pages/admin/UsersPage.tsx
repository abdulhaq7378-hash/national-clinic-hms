import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Check, Search, UserPlus } from 'lucide-react';
import {
  PASSWORD_MIN_LENGTH,
  PERMISSIONS,
  ROLE_LABELS,
  ROLES,
  passwordSchema,
  userCreateSchema,
  type Role,
} from '@hms/shared';
import { useAuth } from '../../contexts/AuthContext';
import { useAction } from '../../hooks/queries';
import { useDebounce } from '../../hooks/useDebounce';
import { api } from '../../services/api';
import { Badge, DataTable, Pagination, QueryState } from '../../components/data';
import { Modal } from '../../components/overlay';
import { Button, Checkbox, Field, Notice, PageHeader, Panel, SelectInput, Tabs, TextInput } from '../../components/ui';
import { fmtDateTime } from '../../utils/format';
import type { StaffUser } from '../../types';
import { DoctorProfileModal } from './DoctorProfileModal';

const roleOptions = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

function UserModal({ user, open, onClose }: { user: StaffUser | null; open: boolean; onClose: () => void }) {
  const { user: me } = useAuth();
  const editing = Boolean(user);
  const [form, setForm] = useState({ name: '', email: '', role: 'receptionist', phone: '', designation: '', password: '', isActive: true });
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(
      user
        ? { name: user.name, email: user.email, role: user.role, phone: user.phone ?? '', designation: user.designation ?? '', password: '', isActive: user.isActive }
        : { name: '', email: '', role: 'receptionist', phone: '', designation: '', password: '', isActive: true },
    );
  }, [open, user]);

  const save = useAction(
    () =>
      editing
        ? api.patch(`/users/${user!.id}`, {
            name: form.name,
            role: form.role,
            phone: form.phone,
            designation: form.designation,
            isActive: form.isActive,
          })
        : api.post('/users', { name: form.name, email: form.email, role: form.role, phone: form.phone, designation: form.designation, password: form.password }),
    { success: editing ? 'User updated' : 'User created', invalidate: [['users'], ['doctors']], onSuccess: onClose, silentError: true },
  );

  const submit = () => {
    if (!editing) {
      const parsed = userCreateSchema.safeParse(form);
      if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the form');
    } else if (!form.name.trim()) {
      return setError('Name is required');
    }
    setError('');
    save.mutate(undefined, { onError: (e) => setError(e.message) });
  };
  const self = user?.id === me?.id;
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal
      open={open}
      title={editing ? `Edit ${user!.name}` : 'New user'}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <div className="form-grid">
        {error && (
          <div className="span-all">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
        <TextInput label="Full name" required value={form.name} onChange={(e) => set('name', e.target.value)} />
        <TextInput label="Email" type="email" required disabled={editing} value={form.email} onChange={(e) => set('email', e.target.value)} />
        <SelectInput label="Role" required disabled={self} value={form.role} options={roleOptions} onChange={(e) => set('role', e.target.value)} />
        <TextInput label="Designation" value={form.designation} onChange={(e) => set('designation', e.target.value)} />
        <TextInput label="Phone" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        {!editing ? (
          <TextInput
            label="Initial password"
            type="password"
            autoComplete="new-password"
            required
            hint={`At least ${PASSWORD_MIN_LENGTH} characters with upper and lower case letters and a number. Share it privately.`}
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
          />
        ) : (
          <Field label="Account">
            {() => <Checkbox label="Active" disabled={self} checked={form.isActive} onChange={(v) => set('isActive', v)} />}
          </Field>
        )}
        {form.role === 'doctor' && !editing && (
          <p className="small muted span-all">After saving, add the doctor profile and OPD hours from the user list.</p>
        )}
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: StaffUser | null; onClose: () => void }) {
  const [password, setPassword] = useState('');
  useEffect(() => setPassword(''), [user]);
  const valid = passwordSchema.safeParse(password);
  const reset = useAction(() => api.post(`/users/${user!.id}/reset-password`, { newPassword: password }), {
    success: 'Password reset. The user has been signed out everywhere.',
    onSuccess: onClose,
  });
  return (
    <Modal
      open={Boolean(user)}
      title={`Reset password for ${user?.name ?? ''}`}
      onClose={onClose}
      onSubmit={() => valid.success && reset.mutate(undefined)}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!valid.success} loading={reset.isPending}>
            Reset password
          </Button>
        </>
      }
    >
      <TextInput
        label="New password"
        type="password"
        autoComplete="new-password"
        value={password}
        error={password && !valid.success ? valid.error.issues[0]?.message : undefined}
        onChange={(e) => setPassword(e.target.value)}
      />
    </Modal>
  );
}

function RoleMatrix() {
  const query = useQuery({
    queryKey: ['users', 'roles'],
    queryFn: () => api.get<{ role: Role; label: string; permissions: string[] }[]>('/users/roles'),
  });
  return (
    <QueryState query={query}>
      {(roles) => (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Permission</th>
                {roles.map((r) => (
                  <th key={r.role} style={{ textAlign: 'center' }}>
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((p) => (
                <tr key={p}>
                  <td className="mono">{p}</td>
                  {roles.map((r) => (
                    <td key={r.role} style={{ textAlign: 'center' }}>
                      {r.permissions.includes(p) ? <Check size={14} color="var(--success)" aria-label="Allowed" /> : ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted" style={{ padding: 16 }}>
            Role permissions are defined in the application code and enforced by the API. Changes require a software update.
          </p>
        </div>
      )}
    </QueryState>
  );
}

export default function UsersPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [term, setTerm] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<StaffUser | null>(null);
  const [doctorFor, setDoctorFor] = useState<StaffUser | null>(null);
  const q = useDebounce(term.trim(), 300);
  const manage = can('user:manage');

  const query = useQuery({
    queryKey: ['users', { q, role, page }],
    queryFn: () => api.page<StaffUser>('/users', { q, role, page, limit: 25 }),
    placeholderData: keepPreviousData,
    enabled: tab === 'users',
  });
  const unlock = useAction((id: string) => api.post(`/users/${id}/unlock`), { success: 'Account unlocked' });

  return (
    <>
      <PageHeader
        title="Users"
        description="Staff accounts and what each role can do."
        actions={
          manage && (
            <Button variant="primary" icon={<UserPlus size={15} />} onClick={() => setCreating(true)}>
              New user
            </Button>
          )
        }
      />
      <Panel flush>
        <div style={{ padding: '0 16px' }}>
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: 'users', label: 'Staff' },
              { key: 'roles', label: 'Role permissions' },
            ]}
          />
        </div>
        {tab === 'roles' ? (
          <RoleMatrix />
        ) : (
          <>
            <div className="row" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
              <div className="input-group" style={{ width: 240 }}>
                <Search size={15} />
                <input className="input" placeholder="Name or email" value={term} onChange={(e) => { setTerm(e.target.value); setPage(1); }} />
              </div>
              <div style={{ width: 200 }}>
                <SelectInput aria-label="Role" value={role} placeholder="All roles" options={roleOptions} onChange={(e) => { setRole(e.target.value); setPage(1); }} />
              </div>
            </div>
            <QueryState query={query} empty={{ when: (r) => r.data.length === 0, title: 'No users found' }}>
              {(r) => (
                <>
                  <DataTable
                    rows={r.data}
                    rowKey={(u) => u.id}
                    columns={[
                      {
                        key: 'name',
                        header: 'Name',
                        render: (u) => (
                          <>
                            <div className="cell-title">{u.name}</div>
                            <div className="cell-sub">{u.email}</div>
                          </>
                        ),
                      },
                      {
                        key: 'role',
                        header: 'Role',
                        render: (u) => (
                          <>
                            {ROLE_LABELS[u.role]}
                            {u.designation && <div className="cell-sub">{u.designation}</div>}
                          </>
                        ),
                      },
                      {
                        key: 'status',
                        header: 'Status',
                        render: (u) => (
                          <div className="row">
                            {u.isActive ? <Badge tone="success">Active</Badge> : <Badge>Disabled</Badge>}
                            {u.role === 'doctor' && !u.hasDoctorProfile && <Badge tone="warning">Profile missing</Badge>}
                          </div>
                        ),
                      },
                      { key: 'login', header: 'Last sign-in', render: (u) => fmtDateTime(u.lastLoginAt) || 'Never' },
                      {
                        key: 'actions',
                        header: '',
                        className: 'right',
                        render: (u) =>
                          manage && (
                            <div className="row nowrap" style={{ justifyContent: 'flex-end' }}>
                              {u.role === 'doctor' && (can('doctor:manage')) && (
                                <Button size="sm" onClick={() => setDoctorFor(u)}>
                                  {u.hasDoctorProfile ? 'Doctor profile' : 'Add doctor profile'}
                                </Button>
                              )}
                              <Button size="sm" onClick={() => setEditing(u)}>
                                Edit
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setResetting(u)}>
                                Reset password
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => unlock.mutate(u.id)}>
                                Unlock
                              </Button>
                            </div>
                          ),
                      },
                    ]}
                  />
                  <Pagination meta={r.meta} onPage={setPage} />
                </>
              )}
            </QueryState>
          </>
        )}
      </Panel>
      <UserModal open={creating || Boolean(editing)} user={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />
      <DoctorProfileModal user={doctorFor} onClose={() => setDoctorFor(null)} />
    </>
  );
}
