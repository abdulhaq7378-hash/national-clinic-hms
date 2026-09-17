import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useAction } from '../../hooks/queries';
import { useDebounce } from '../../hooks/useDebounce';
import { api } from '../../services/api';
import { EmptyState, Loading, StatusBadge } from '../../components/data';
import { PatientPicker } from '../../components/pickers';
import { Button, Notice, PageHeader, Panel, Segmented, TextInput } from '../../components/ui';
import { doctorName, fmtDate, money, patientLine } from '../../utils/format';
import type { MedicineStock, Patient, Prescription } from '../../types';

interface DispenseResult {
  referenceNumber: string;
  dispensed: { medicine: string; strength?: string; quantity: number; batches: { batchNumber: string; quantity: number; unitPrice: number }[] }[];
}

function MedicinePicker({ onPick, placeholder }: { onPick: (m: MedicineStock) => void; placeholder?: string }) {
  const [term, setTerm] = useState('');
  const q = useDebounce(term.trim(), 250);
  const results = useQuery({
    queryKey: ['pharmacy', 'medicines', 'pick', q],
    queryFn: () => api.page<MedicineStock>('/pharmacy/medicines', { q, limit: 8 }).then((r) => r.data),
    enabled: q.length >= 2,
  });
  return (
    <div style={{ position: 'relative' }}>
      <input className="input" placeholder={placeholder ?? 'Search stock'} value={term} onChange={(e) => setTerm(e.target.value)} />
      {q.length >= 2 && results.data && (
        <div className="search-results">
          {results.data.length === 0 && <div className="list-item muted">No match</div>}
          {results.data.map((m) => (
            <div
              key={m.id}
              className="list-item clickable"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(m);
                setTerm('');
              }}
            >
              {m.name} {m.strength} <span className="muted">· stock {m.stock} {m.unit}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PrescriptionDispense({ prescriptionId, onDone }: { prescriptionId: string; onDone: (r: DispenseResult) => void }) {
  const query = useQuery({
    queryKey: ['prescriptions', prescriptionId],
    queryFn: () => api.get<Prescription>(`/prescriptions/${prescriptionId}`),
  });
  const [qty, setQty] = useState<Record<string, string>>({});
  const [mapped, setMapped] = useState<Record<string, MedicineStock>>({});

  useEffect(() => {
    if (!query.data) return;
    setQty(
      Object.fromEntries(
        query.data.items.map((i) => [i._id, i.quantity ? String(Math.max(0, i.quantity - i.dispensedQuantity)) : '']),
      ),
    );
  }, [query.data]);

  const dispense = useAction(
    (items: unknown) => api.post<DispenseResult>('/pharmacy/dispense', { prescription: prescriptionId, items }),
    { invalidate: [['prescriptions'], ['pharmacy'], ['dashboard'], ['billing']], onSuccess: onDone },
  );

  if (query.isLoading) return <Loading />;
  const p = query.data;
  if (!p) return <EmptyState title="Prescription not found" />;
  const pending = ['active', 'partially_dispensed'].includes(p.status);
  const lines = p.items
    .filter((i) => Number(qty[i._id]) > 0)
    .map((i) => ({ prescriptionItem: i._id, quantity: Number(qty[i._id]), medicine: i.medicine ? undefined : mapped[i._id]?.id }));
  const unmapped = lines.some((l) => !p.items.find((i) => i._id === l.prescriptionItem)?.medicine && !l.medicine);

  return (
    <Panel
      title={
        <div>
          <h2>
            {p.number} <StatusBadge status={p.status} />
          </h2>
          <div className="small muted">
            {p.patient.fullName} ({p.patient.uhid}) · {patientLine(p.patient)} · {doctorName(p.doctor)} · {fmtDate(p.date)}
          </div>
        </div>
      }
      flush
      footer={
        pending && (
          <Button variant="primary" disabled={!lines.length || unmapped} loading={dispense.isPending} onClick={() => dispense.mutate(lines)}>
            Dispense {lines.length} item{lines.length === 1 ? '' : 's'}
          </Button>
        )
      }
    >
      {!pending && (
        <div style={{ padding: 16 }}>
          <Notice>This prescription is {p.status.replace('_', ' ')}.</Notice>
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Medicine</th>
              <th>Directions</th>
              <th className="num">Prescribed</th>
              <th className="num">Already given</th>
              <th style={{ width: 280 }}>Stock item</th>
              <th style={{ width: 110 }}>Give now</th>
            </tr>
          </thead>
          <tbody>
            {p.items.map((i) => {
              const done = i.quantity ? i.dispensedQuantity >= i.quantity : false;
              return (
                <tr key={i._id}>
                  <td>
                    <div className="cell-title">
                      {i.medicineName} {i.strength}
                    </div>
                    {i.instructions && <div className="cell-sub">{i.instructions}</div>}
                  </td>
                  <td className="small">
                    {i.dose} · {i.frequency} · {i.durationValue} {i.durationUnit}
                  </td>
                  <td className="num">{i.quantity ?? 'Not specified'}</td>
                  <td className="num">{i.dispensedQuantity}</td>
                  <td>
                    {i.medicine ? (
                      <span className="small muted">Linked to pharmacy stock</span>
                    ) : mapped[i._id] ? (
                      <span className="small">
                        {mapped[i._id].name} {mapped[i._id].strength}{' '}
                        <Button size="sm" variant="ghost" onClick={() => setMapped(({ [i._id]: _, ...rest }) => rest)}>
                          Change
                        </Button>
                      </span>
                    ) : (
                      <MedicinePicker placeholder="Select the stock to give" onPick={(m) => setMapped((x) => ({ ...x, [i._id]: m }))} />
                    )}
                  </td>
                  <td>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      aria-label="Quantity to dispense"
                      disabled={!pending || done}
                      value={qty[i._id] ?? ''}
                      onChange={(e) => setQty((q) => ({ ...q, [i._id]: e.target.value }))}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ padding: '8px 16px' }}>
        Items without a quantity (for example external advice) can be left at zero. Stock is taken from the batch with the earliest expiry.
      </p>
    </Panel>
  );
}

function PendingList({ onPick }: { onPick: (id: string) => void }) {
  const query = useQuery({
    queryKey: ['prescriptions', { view: 'pending', dispense: true }],
    queryFn: () => api.page<Prescription>('/prescriptions', { pending: 'true', limit: 50 }).then((r) => r.data),
  });
  if (query.isLoading) return <Loading />;
  if (!query.data?.length) return <EmptyState title="No prescriptions waiting" />;
  return (
    <ul className="list">
      {query.data.map((p) => (
        <li key={p.id} className="list-item clickable row-between" onClick={() => onPick(p.id)}>
          <div>
            <div className="cell-title">{p.patient.fullName}</div>
            <div className="cell-sub">
              <span className="mono">{p.number}</span> · {doctorName(p.doctor)} · {p.items.length} items
            </div>
          </div>
          <StatusBadge status={p.status} />
        </li>
      ))}
    </ul>
  );
}

function CounterSale({ onDone }: { onDone: (r: DispenseResult) => void }) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [lines, setLines] = useState<{ medicine: MedicineStock; quantity: string }[]>([]);
  const sale = useAction(
    () =>
      api.post<DispenseResult>('/pharmacy/dispense', {
        patient: patient!.id,
        items: lines.map((l) => ({ medicine: l.medicine.id, quantity: Number(l.quantity) })),
      }),
    { invalidate: [['pharmacy'], ['billing'], ['dashboard']], onSuccess: onDone },
  );
  const invalid = lines.some((l) => !(Number(l.quantity) > 0) || Number(l.quantity) > l.medicine.stock);

  return (
    <Panel
      title="Sale without prescription"
      footer={
        <Button variant="primary" disabled={!patient || !lines.length || invalid} loading={sale.isPending} onClick={() => sale.mutate(undefined)}>
          Dispense
        </Button>
      }
    >
      <div className="stack">
        <PatientPicker value={patient} onChange={setPatient} required />
        {lines.map((l, i) => (
          <div key={l.medicine.id} className="row">
            <div style={{ flex: 1 }}>
              <div className="strong">
                {l.medicine.name} {l.medicine.strength}
              </div>
              <div className="small muted">
                {l.medicine.stock} {l.medicine.unit} in stock
              </div>
            </div>
            <div style={{ width: 120 }}>
              <TextInput
                aria-label="Quantity"
                type="number"
                min={1}
                max={l.medicine.stock}
                value={l.quantity}
                error={Number(l.quantity) > l.medicine.stock ? 'Not enough stock' : undefined}
                onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
              />
            </div>
            <Button variant="ghost" iconOnly aria-label="Remove" icon={<Trash2 size={14} />} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} />
          </div>
        ))}
        <div className="row">
          <Plus size={14} />
          <div style={{ flex: 1 }}>
            <MedicinePicker
              placeholder="Add medicine"
              onPick={(m) => setLines((ls) => (ls.some((x) => x.medicine.id === m.id) ? ls : [...ls, { medicine: m, quantity: '1' }]))}
            />
          </div>
        </div>
      </div>
    </Panel>
  );
}

export default function DispensePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const prescription = params.get('prescription');
  const [mode, setMode] = useState<'prescription' | 'counter'>('prescription');
  const [result, setResult] = useState<DispenseResult | null>(null);

  const totals = useMemo(
    () => result?.dispensed.reduce((n, d) => n + d.batches.reduce((m, b) => m + b.quantity * b.unitPrice, 0), 0) ?? 0,
    [result],
  );

  if (result) {
    return (
      <>
        <PageHeader title="Dispensed" description={`Reference ${result.referenceNumber}`} />
        <Panel
          footer={
            <>
              <Button onClick={() => { setResult(null); setParams({}); }}>Dispense another</Button>
              <Button variant="primary" onClick={() => navigate('/prescriptions')}>
                Back to prescriptions
              </Button>
            </>
          }
        >
          <div className="stack-sm">
            {result.dispensed.map((d) => (
              <div key={d.medicine}>
                <strong>
                  {d.medicine} {d.strength}
                </strong>{' '}
                × {d.quantity}
                <div className="small muted">
                  {d.batches.map((b) => `Batch ${b.batchNumber}: ${b.quantity} at ${money(b.unitPrice)}`).join('; ')}
                </div>
              </div>
            ))}
            <hr className="divider" />
            <div>
              Value before tax: <strong>{money(totals)}</strong>. The charges were added to the patient's bill.{' '}
              <Link to="/billing">Go to billing</Link>
            </div>
          </div>
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Dispense medicines"
        actions={
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'prescription', label: 'From prescription' },
              { value: 'counter', label: 'Counter sale' },
            ]}
          />
        }
      />
      {mode === 'counter' ? (
        <CounterSale onDone={setResult} />
      ) : prescription ? (
        <div className="stack">
          <div>
            <Button size="sm" onClick={() => setParams({})}>
              Choose another prescription
            </Button>
          </div>
          <PrescriptionDispense prescriptionId={prescription} onDone={setResult} />
        </div>
      ) : (
        <Panel title="Prescriptions waiting" flush>
          <PendingList onPick={(id) => setParams({ prescription: id })} />
        </Panel>
      )}
    </>
  );
}
