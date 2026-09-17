import { useState } from 'react';
import { changePasswordSchema, PASSWORD_MIN_LENGTH, ROLE_LABELS } from '@hms/shared';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { api, ApiError } from '../services/api';
import { Button, KeyValue, PageHeader, Panel, TextInput } from '../components/ui';

export default function AccountPage() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const next: Record<string, string> = {};
    const parsed = changePasswordSchema.safeParse(form);
    if (!parsed.success) for (const i of parsed.error.issues) next[String(i.path[0])] ??= i.message;
    if (form.newPassword !== form.confirm) next.confirm = 'Passwords do not match';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await api.post('/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      toast.success('Password changed. Please sign in again.');
      await logout();
    } catch (err) {
      if (err instanceof ApiError) setErrors({ currentPassword: err.message });
      else toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;
  return (
    <>
      <PageHeader title="My account" />
      <div className="grid grid-2">
        <Panel title="Profile">
          <KeyValue
            items={[
              ['Name', user.name],
              ['Email', user.email],
              ['Role', ROLE_LABELS[user.role]],
              ['Designation', user.designation],
            ]}
          />
        </Panel>
        <Panel
          title="Change password"
          footer={
            <Button variant="primary" onClick={submit} loading={saving}>
              Update password
            </Button>
          }
        >
          <div className="stack-sm">
            <TextInput
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={form.currentPassword}
              error={errors.currentPassword}
              onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
            />
            <TextInput
              label="New password"
              type="password"
              autoComplete="new-password"
              value={form.newPassword}
              error={errors.newPassword}
              hint={`At least ${PASSWORD_MIN_LENGTH} characters with upper and lower case letters and a number.`}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
            />
            <TextInput
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              error={errors.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            />
            <p className="small muted">Changing your password signs you out on every device.</p>
          </div>
        </Panel>
      </div>
    </>
  );
}
