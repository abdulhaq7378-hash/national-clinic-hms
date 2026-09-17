import { useEffect, useState } from 'react';
import { PRIORITIES, referralCreateSchema, toHospitalDate } from '@hms/shared';
import { useAction } from '../../hooks/queries';
import { api } from '../../services/api';
import { Modal } from '../../components/overlay';
import { Button, enumOptions, Notice, SelectInput, TextArea, TextInput } from '../../components/ui';
import type { Referral } from '../../types';

const EMPTY = {
  referredToDoctor: '',
  specialty: '',
  hospital: '',
  reason: '',
  clinicalNotes: '',
  referralDate: '',
  priority: 'routine',
};

export function ReferralModal({
  open,
  patientId,
  consultationId,
  onClose,
}: {
  open: boolean;
  patientId: string;
  consultationId?: string;
  onClose: () => void;
}) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY, referralDate: toHospitalDate() });
      setError('');
    }
  }, [open]);

  const save = useAction((body: unknown) => api.post<Referral>('/referrals', body), {
    success: (r) => `Referral ${r.number} created`,
    invalidate: [['referrals']],
    onSuccess: onClose,
  });

  const submit = () => {
    const body = { ...form, patient: patientId, consultation: consultationId };
    const parsed = referralCreateSchema.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form');
      return;
    }
    save.mutate(body);
  };

  const set = (k: keyof typeof EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal
      open={open}
      wide
      title="Refer patient"
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            Create referral
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
        <TextInput label="Specialty" required value={form.specialty} onChange={(e) => set('specialty', e.target.value)} />
        <TextInput label="Referred to (doctor)" value={form.referredToDoctor} onChange={(e) => set('referredToDoctor', e.target.value)} />
        <TextInput label="Hospital or clinic" value={form.hospital} onChange={(e) => set('hospital', e.target.value)} />
        <SelectInput label="Priority" value={form.priority} options={enumOptions(PRIORITIES)} onChange={(e) => set('priority', e.target.value)} />
        <TextInput label="Referral date" type="date" required value={form.referralDate} onChange={(e) => set('referralDate', e.target.value)} />
        <TextArea label="Reason" required fieldClassName="span-all" rows={2} value={form.reason} onChange={(e) => set('reason', e.target.value)} />
        <TextArea
          label="Clinical notes for the receiving doctor"
          fieldClassName="span-all"
          rows={4}
          value={form.clinicalNotes}
          onChange={(e) => set('clinicalNotes', e.target.value)}
        />
      </div>
    </Modal>
  );
}
