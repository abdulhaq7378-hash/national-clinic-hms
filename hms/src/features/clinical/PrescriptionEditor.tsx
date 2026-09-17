import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import {
  DURATION_UNITS,
  MEDICINE_FORMS,
  MEDICINE_ROUTES,
  prescriptionItemSchema,
  suggestQuantity,
} from '@hms/shared';
import { useAction, useSettings } from '../../hooks/queries';
import { useDebounce } from '../../hooks/useDebounce';
import { api } from '../../services/api';
import { Modal } from '../../components/overlay';
import { Button, enumOptions, Notice, SelectInput, TextArea, TextInput } from '../../components/ui';
import type { MedicineStock, Prescription } from '../../types';

interface Line {
  key: number;
  medicine: string;
  medicineName: string;
  strength: string;
  form: string;
  dose: string;
  frequency: string;
  timing: string;
  durationValue: string;
  durationUnit: string;
  route: string;
  instructions: string;
  quantity: string;
  stock?: number;
}

const FREQUENCIES = ['1-0-0', '0-1-0', '0-0-1', '1-0-1', '1-1-1', '1-1-1-1', '0-0-0-1', 'SOS', 'STAT'];
const TIMINGS = ['after_food', 'before_food', 'with_food', 'empty_stomach', 'bedtime', 'as_needed', 'any'];
let keySeq = 1;

const blankLine = (): Line => ({
  key: keySeq++,
  medicine: '',
  medicineName: '',
  strength: '',
  form: 'tablet',
  dose: '1 tablet',
  frequency: '1-0-1',
  timing: 'after_food',
  durationValue: '5',
  durationUnit: 'days',
  route: 'oral',
  instructions: '',
  quantity: '',
});

function MedicineSearch({ line, onPick, onType }: { line: Line; onPick: (m: MedicineStock) => void; onType: (v: string) => void }) {
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const term = useDebounce(line.medicineName.trim(), 250);
  const ref = useRef<HTMLDivElement>(null);
  const enabled = settings.data?.modules.pharmacy !== false;
  const results = useQuery({
    queryKey: ['pharmacy', 'search', term],
    queryFn: () => api.get<MedicineStock[]>('/pharmacy/medicines/search', { q: term }),
    enabled: enabled && open && term.length >= 2 && !line.medicine,
  });
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <TextInput
        label="Medicine"
        required
        value={line.medicineName}
        hint={
          line.medicine
            ? `From pharmacy stock${line.stock !== undefined ? `: ${line.stock} available` : ''}`
            : enabled
              ? 'Pick from pharmacy stock, or type a name to prescribe from outside'
              : undefined
        }
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onType(e.target.value);
          setOpen(true);
        }}
      />
      {open && results.data && results.data.length > 0 && (
        <div className="search-results">
          {results.data.map((m) => (
            <div
              key={m.id}
              className="list-item clickable"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(m);
                setOpen(false);
              }}
            >
              <div className="cell-title">
                {m.name} {m.strength}
              </div>
              <div className="cell-sub">
                {m.genericName} · {m.form} · stock {m.stock}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PrescriptionEditor({
  open,
  consultationId,
  onClose,
}: {
  open: boolean;
  consultationId: string;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setLines([blankLine()]);
      setNotes('');
      setError('');
    }
  }, [open]);

  const update = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = useAction((body: unknown) => api.post<Prescription>('/prescriptions', body), {
    success: (p) => `Prescription ${p.number} issued`,
    invalidate: [['prescriptions'], ['consultations']],
    onSuccess: onClose,
  });

  const submit = () => {
    const items = lines.map((l) => ({
      medicine: l.medicine || null,
      medicineName: l.medicineName,
      strength: l.strength,
      form: l.form,
      dose: l.dose,
      frequency: l.frequency,
      timing: l.timing,
      durationValue: l.durationValue,
      durationUnit: l.durationUnit,
      route: l.route,
      instructions: l.instructions,
      quantity: l.quantity,
    }));
    for (const [i, item] of items.entries()) {
      const parsed = prescriptionItemSchema.safeParse(item);
      if (!parsed.success) {
        setError(`Line ${i + 1}: ${parsed.error.issues[0]?.message}`);
        return;
      }
    }
    setError('');
    save.mutate({ consultation: consultationId, items, notes });
  };

  return (
    <Modal
      open={open}
      wide
      title="New prescription"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Issue prescription
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <Notice tone="danger">{error}</Notice>}
        {lines.map((l, index) => {
          const suggested =
            ['tablet', 'capsule'].includes(l.form) && l.durationValue
              ? suggestQuantity(l.frequency, Number(l.durationValue), l.durationUnit as 'days')
              : null;
          return (
            <div key={l.key} className="panel" style={{ boxShadow: 'none' }}>
              <div className="panel-header" style={{ minHeight: 40, padding: '6px 12px' }}>
                <strong>Medicine {index + 1}</strong>
                {lines.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    iconOnly
                    aria-label="Remove medicine"
                    icon={<Trash2 size={14} />}
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  />
                )}
              </div>
              <div className="panel-body form-grid form-grid-4">
                <div className="span-2">
                  <MedicineSearch
                    line={l}
                    onType={(v) => update(l.key, { medicineName: v, medicine: '', stock: undefined })}
                    onPick={(m) =>
                      update(l.key, {
                        medicine: m.id,
                        medicineName: m.name,
                        strength: m.strength ?? '',
                        form: m.form,
                        dose: `1 ${m.unit}`,
                        stock: m.stock,
                      })
                    }
                  />
                </div>
                <TextInput label="Strength" value={l.strength} onChange={(e) => update(l.key, { strength: e.target.value })} />
                <SelectInput label="Form" value={l.form} options={enumOptions(MEDICINE_FORMS)} onChange={(e) => update(l.key, { form: e.target.value })} />
                <TextInput label="Dose" value={l.dose} onChange={(e) => update(l.key, { dose: e.target.value })} />
                <TextInput
                  label="Frequency"
                  required
                  list="rx-frequencies"
                  value={l.frequency}
                  hint="Morning-noon-night"
                  onChange={(e) => update(l.key, { frequency: e.target.value })}
                />
                <SelectInput label="Timing" value={l.timing} options={enumOptions(TIMINGS)} onChange={(e) => update(l.key, { timing: e.target.value })} />
                <SelectInput label="Route" value={l.route} options={enumOptions(MEDICINE_ROUTES)} onChange={(e) => update(l.key, { route: e.target.value })} />
                <TextInput
                  label="Duration"
                  type="number"
                  min={1}
                  required
                  value={l.durationValue}
                  onChange={(e) => update(l.key, { durationValue: e.target.value })}
                />
                <SelectInput
                  label="Unit"
                  value={l.durationUnit}
                  options={enumOptions(DURATION_UNITS)}
                  onChange={(e) => update(l.key, { durationUnit: e.target.value })}
                />
                <TextInput
                  label="Quantity"
                  type="number"
                  min={1}
                  value={l.quantity}
                  placeholder={suggested ? String(suggested) : ''}
                  hint={suggested ? `Calculated: ${suggested}` : 'Optional'}
                  onChange={(e) => update(l.key, { quantity: e.target.value })}
                />
                <TextInput label="Instructions" value={l.instructions} onChange={(e) => update(l.key, { instructions: e.target.value })} />
              </div>
            </div>
          );
        })}
        <datalist id="rx-frequencies">
          {FREQUENCIES.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <div>
          <Button icon={<Plus size={14} />} onClick={() => setLines((ls) => [...ls, blankLine()])}>
            Add medicine
          </Button>
        </div>
        <TextArea label="Notes for the patient or pharmacist" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}
