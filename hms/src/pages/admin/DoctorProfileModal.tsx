import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { WEEKDAYS } from '@hms/shared';
import { useAction, useServices } from '../../hooks/queries';
import { api } from '../../services/api';
import { Loading } from '../../components/data';
import { Modal } from '../../components/overlay';
import { Button, Checkbox, Field, Notice, SelectInput, TextInput } from '../../components/ui';
import { formatEnum, money } from '../../utils/format';
import type { Doctor, StaffUser } from '../../types';

interface Window {
  day: string;
  start: string;
  end: string;
}

const DAY_LABELS: Record<string, string> = {
  sun: 'Sunday',
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
};

/** Creates or edits the clinical profile and weekly OPD hours for a doctor account. */
export function DoctorProfileModal({ user, onClose }: { user: StaffUser | null; onClose: () => void }) {
  const services = useServices('consultation');
  const doctors = useQuery({
    queryKey: ['doctors', 'all'],
    queryFn: () => api.get<Doctor[]>('/doctors', { includeInactive: 'true' }),
    enabled: Boolean(user),
  });
  const existing = doctors.data?.find((d) => (d.user._id ?? d.user.id) === user?.id);

  const [form, setForm] = useState({
    specialization: '',
    qualification: '',
    registrationNumber: '',
    department: '',
    consultationService: '',
    followUpService: '',
    slotMinutes: '15',
    isActive: true,
  });
  const [windows, setWindows] = useState<Window[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user || doctors.isLoading) return;
    setError('');
    if (existing) {
      setForm({
        specialization: existing.specialization,
        qualification: existing.qualification ?? '',
        registrationNumber: existing.registrationNumber ?? '',
        department: existing.department ?? '',
        consultationService: existing.consultationService?.id ?? '',
        followUpService: existing.followUpService?.id ?? '',
        slotMinutes: String(existing.slotMinutes),
        isActive: existing.isActive,
      });
      setWindows(existing.availability.map((w) => ({ ...w })));
    } else {
      setForm({
        specialization: 'General Physician',
        qualification: '',
        registrationNumber: '',
        department: '',
        consultationService: '',
        followUpService: '',
        slotMinutes: '15',
        isActive: true,
      });
      setWindows([]);
    }
  }, [user, existing, doctors.isLoading]);

  const save = useAction(
    () => {
      const body = { ...form, slotMinutes: Number(form.slotMinutes), availability: windows };
      return existing ? api.patch(`/doctors/${existing.id}`, body) : api.post('/doctors', { ...body, user: user!.id });
    },
    {
      success: 'Doctor profile saved',
      invalidate: [['doctors'], ['users']],
      onSuccess: onClose,
      silentError: true,
    },
  );

  const submit = () => {
    if (!form.specialization.trim()) return setError('Specialization is required');
    if (windows.some((w) => w.start >= w.end)) return setError('Each OPD session must end after it starts');
    setError('');
    save.mutate(undefined, { onError: (e) => setError(e.message) });
  };

  const serviceOptions = (services.data ?? []).map((s) => ({ value: s.id, label: `${s.name} (${money(s.price)})` }));
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal
      open={Boolean(user)}
      wide
      title={user ? `Doctor profile: ${user.name}` : ''}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Save profile
          </Button>
        </>
      }
    >
      {doctors.isLoading ? (
        <Loading />
      ) : (
        <div className="stack">
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="form-grid form-grid-3">
            <TextInput label="Specialization" required value={form.specialization} onChange={(e) => set('specialization', e.target.value)} />
            <TextInput label="Qualification" placeholder="MBBS, MD" value={form.qualification} onChange={(e) => set('qualification', e.target.value)} />
            <TextInput label="Medical council registration" value={form.registrationNumber} onChange={(e) => set('registrationNumber', e.target.value)} />
            <TextInput label="Department" value={form.department} onChange={(e) => set('department', e.target.value)} />
            <SelectInput
              label="Consultation fee"
              value={form.consultationService}
              placeholder="No automatic fee"
              options={serviceOptions}
              onChange={(e) => set('consultationService', e.target.value)}
            />
            <SelectInput
              label="Follow-up fee"
              value={form.followUpService}
              placeholder="Same as consultation"
              options={serviceOptions}
              onChange={(e) => set('followUpService', e.target.value)}
            />
            <TextInput label="Appointment length (minutes)" type="number" min={5} max={120} value={form.slotMinutes} onChange={(e) => set('slotMinutes', e.target.value)} />
            <Field label="Status">{() => <Checkbox label="Accepting appointments" checked={form.isActive} onChange={(v) => set('isActive', v)} />}</Field>
          </div>
          {serviceOptions.length === 0 && (
            <Notice tone="warn">Add consultation services to the price list in Settings to charge fees automatically.</Notice>
          )}
          <div>
            <div className="row-between" style={{ marginBottom: 8 }}>
              <h3>Weekly OPD hours</h3>
              <Button size="sm" icon={<Plus size={13} />} onClick={() => setWindows((w) => [...w, { day: 'mon', start: '09:00', end: '13:00' }])}>
                Add session
              </Button>
            </div>
            {windows.length === 0 ? (
              <p className="small muted">No hours set. Appointments cannot be booked until at least one session is added.</p>
            ) : (
              <div className="stack-sm">
                {windows.map((w, i) => (
                  <div key={i} className="row">
                    <select className="select" style={{ width: 150 }} value={w.day} aria-label="Day" onChange={(e) => setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, day: e.target.value } : x)))}>
                      {WEEKDAYS.map((d) => (
                        <option key={d} value={d}>
                          {DAY_LABELS[d]}
                        </option>
                      ))}
                    </select>
                    <input className="input" style={{ width: 130 }} type="time" aria-label="Start" value={w.start} onChange={(e) => setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
                    <span className="muted">to</span>
                    <input className="input" style={{ width: 130 }} type="time" aria-label="End" value={w.end} onChange={(e) => setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
                    <Button size="sm" variant="ghost" iconOnly aria-label="Remove session" icon={<Trash2 size={14} />} onClick={() => setWindows((ws) => ws.filter((_, j) => j !== i))} />
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const first = windows[0];
                    const days = WEEKDAYS.filter((d) => d !== 'sun' && !windows.some((w) => w.day === d && w.start === first.start));
                    setWindows((ws) => [...ws, ...days.map((day) => ({ day, start: first.start, end: first.end }))]);
                  }}
                >
                  Copy the first session to Monday to Saturday
                </Button>
              </div>
            )}
            <p className="small muted" style={{ marginTop: 6 }}>
              Sessions: {windows.map((w) => `${formatEnum(w.day)} ${w.start} to ${w.end}`).join(', ') || 'none'}
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
