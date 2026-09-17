import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PRIORITIES } from '@hms/shared';
import { useAction } from '../../hooks/queries';
import { api } from '../../services/api';
import { Loading } from '../../components/data';
import { Modal } from '../../components/overlay';
import { Button, Checkbox, enumOptions, SelectInput, TextArea, TextInput } from '../../components/ui';
import { money } from '../../utils/format';
import type { LabOrder, LabTest } from '../../types';

export function LabOrderModal({
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
  const [selected, setSelected] = useState<string[]>([]);
  const [priority, setPriority] = useState('routine');
  const [notes, setNotes] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (open) {
      setSelected([]);
      setPriority('routine');
      setNotes('');
      setFilter('');
    }
  }, [open]);

  const tests = useQuery({
    queryKey: ['lab', 'tests'],
    queryFn: () => api.get<LabTest[]>('/laboratory/tests'),
    enabled: open,
  });
  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return (tests.data ?? []).filter((t) => !term || `${t.code} ${t.name} ${t.category ?? ''}`.toLowerCase().includes(term));
  }, [tests.data, filter]);
  const total = (tests.data ?? []).filter((t) => selected.includes(t.id)).reduce((n, t) => n + t.price, 0);

  const save = useAction(
    () => api.post<LabOrder>('/laboratory/orders', { patient: patientId, consultation: consultationId, tests: selected, priority, clinicalNotes: notes }),
    { success: (o) => `Lab order ${o.orderNumber} placed`, invalidate: [['lab']], onSuccess: onClose },
  );

  return (
    <Modal
      open={open}
      wide
      title="Order lab tests"
      onClose={onClose}
      footer={
        <>
          <span className="muted" style={{ marginRight: 'auto' }}>
            {selected.length} selected · {money(total)}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!selected.length} loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Place order
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        <div className="form-grid">
          <TextInput label="Find test" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <SelectInput label="Priority" value={priority} options={enumOptions(PRIORITIES)} onChange={(e) => setPriority(e.target.value)} />
        </div>
        {tests.isLoading ? (
          <Loading />
        ) : visible.length === 0 ? (
          <p className="muted">No tests found. Lab tests are configured under Settings.</p>
        ) : (
          <div className="panel" style={{ maxHeight: 280, overflowY: 'auto', boxShadow: 'none' }}>
            <ul className="list">
              {visible.map((t) => (
                <li key={t.id} className="list-item row-between">
                  <Checkbox
                    label={
                      <span>
                        <span className="strong">{t.name}</span> <span className="small muted">({t.code}, {t.sampleType})</span>
                      </span>
                    }
                    checked={selected.includes(t.id)}
                    onChange={(c) => setSelected((s) => (c ? [...s, t.id] : s.filter((x) => x !== t.id)))}
                  />
                  <span className="small">{money(t.price)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <TextArea label="Clinical notes for the laboratory" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}
