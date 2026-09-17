import { useEffect, useState } from 'react';
import { vitalsSchema } from '@hms/shared';
import { useAction } from '../../hooks/queries';
import { api } from '../../services/api';
import { Modal } from '../../components/overlay';
import { Button, TextInput } from '../../components/ui';
import type { Token, Vitals } from '../../types';

export const VITAL_FIELDS: { key: keyof Vitals; label: string; step?: string }[] = [
  { key: 'systolic', label: 'BP systolic (mmHg)' },
  { key: 'diastolic', label: 'BP diastolic (mmHg)' },
  { key: 'pulse', label: 'Pulse (/min)' },
  { key: 'temperatureC', label: 'Temperature (°C)', step: '0.1' },
  { key: 'spo2', label: 'SpO2 (%)' },
  { key: 'respiratoryRate', label: 'Respiratory rate (/min)' },
  { key: 'weightKg', label: 'Weight (kg)', step: '0.1' },
  { key: 'heightCm', label: 'Height (cm)', step: '0.1' },
  { key: 'bloodSugar', label: 'Random blood sugar (mg/dL)' },
];

export function vitalsToForm(v?: Vitals | null) {
  return Object.fromEntries(VITAL_FIELDS.map((f) => [f.key, v?.[f.key] != null ? String(v[f.key]) : ''])) as Record<keyof Vitals, string>;
}

export function VitalsFields({
  value,
  onChange,
  errors,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  errors?: Record<string, string>;
}) {
  return (
    <div className="form-grid form-grid-3">
      {VITAL_FIELDS.map((f) => (
        <TextInput
          key={f.key}
          label={f.label}
          type="number"
          inputMode="decimal"
          step={f.step ?? '1'}
          value={value[f.key] ?? ''}
          error={errors?.[f.key]}
          onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
        />
      ))}
    </div>
  );
}

export function VitalsModal({ token, onClose }: { token: Token | null; onClose: () => void }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (token) {
      setForm(vitalsToForm(token.vitals));
      setErrors({});
    }
  }, [token]);

  const save = useAction((body: unknown) => api.put(`/queue/${token!.id}/vitals`, body), {
    success: 'Vitals recorded',
    invalidate: [['queue']],
    onSuccess: onClose,
  });

  const submit = () => {
    const parsed = vitalsSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), 'Value is out of range'])));
      return;
    }
    save.mutate(parsed.data);
  };

  return (
    <Modal
      open={Boolean(token)}
      wide
      title={token ? `Vitals: ${token.patient.fullName} (token ${token.number})` : ''}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            Save vitals
          </Button>
        </>
      }
    >
      <VitalsFields value={form} onChange={setForm} errors={errors} />
    </Modal>
  );
}
