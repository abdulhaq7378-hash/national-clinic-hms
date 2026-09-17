import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { calculateLine, calculateTotals, SERVICE_CATEGORIES } from '@hms/shared';
import { useAction, useServices } from '../../hooks/queries';
import { api } from '../../services/api';
import { EmptyState, Loading } from '../../components/data';
import { PatientPicker } from '../../components/pickers';
import { Button, Checkbox, enumOptions, Notice, PageHeader, Panel, SelectInput, TextArea } from '../../components/ui';
import { fmtDate, formatEnum, money } from '../../utils/format';
import type { Charge, Invoice, Patient } from '../../types';

interface ExtraLine {
  key: number;
  service: string;
  description: string;
  category: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  discount: string;
}

let seq = 1;
const num = (v: string) => (v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));

export default function NewInvoicePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [extras, setExtras] = useState<ExtraLine[]>([]);
  const [notes, setNotes] = useState('');
  const services = useServices();

  const initialId = params.get('patient');
  const initial = useQuery({
    queryKey: ['patients', initialId],
    queryFn: () => api.get<Patient>(`/patients/${initialId}`),
    enabled: Boolean(initialId),
  });
  useEffect(() => {
    if (initial.data) setPatient(initial.data);
  }, [initial.data]);

  const charges = useQuery({
    queryKey: ['billing', 'charges', patient?.id],
    queryFn: () => api.get<Charge[]>('/billing/charges', { patient: patient!.id, status: 'pending' }),
    enabled: Boolean(patient),
  });
  useEffect(() => {
    // Select every pending charge by default, with no discount.
    setSelected(Object.fromEntries((charges.data ?? []).map((c) => [c.id, '0'])));
  }, [charges.data]);

  const serviceMap = useMemo(() => new Map((services.data ?? []).map((s) => [s.id, s])), [services.data]);

  const lines = [
    ...(charges.data ?? [])
      .filter((c) => selected[c.id] !== undefined)
      .map((c) => ({ quantity: c.quantity, unitPrice: c.unitPrice, taxRate: c.taxRate, discount: num(selected[c.id]) })),
    ...extras.map((e) => ({ quantity: num(e.quantity), unitPrice: num(e.unitPrice), taxRate: num(e.taxRate), discount: num(e.discount) })),
  ];
  const totals = calculateTotals(lines);

  const create = useAction((body: unknown) => api.post<Invoice>('/billing/invoices', body), {
    success: (inv) => `Invoice ${inv.invoiceNumber} created`,
    invalidate: [['billing'], ['dashboard']],
    onSuccess: (inv) => navigate(`/billing/invoices/${inv.id}`),
  });

  const updateExtra = (key: number, patch: Partial<ExtraLine>) =>
    setExtras((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const submit = () => {
    const items = [
      ...Object.entries(selected).map(([charge, discount]) => ({ charge, discount: num(discount) })),
      ...extras.map((e) =>
        e.service
          ? { service: e.service, quantity: num(e.quantity), discount: num(e.discount), description: e.description || undefined }
          : {
              description: e.description,
              category: e.category,
              quantity: num(e.quantity),
              unitPrice: num(e.unitPrice),
              taxRate: num(e.taxRate),
              discount: num(e.discount),
            },
      ),
    ];
    create.mutate({ patient: patient!.id, items, notes });
  };

  const invalidExtra = extras.some((e) => num(e.quantity) <= 0 || (!e.service && (!e.description.trim() || e.unitPrice === '')));
  if (initialId && initial.isLoading) return <Loading />;

  return (
    <>
      <PageHeader title="New invoice" description="Totals are recalculated by the server from the price list." />
      <div className="grid grid-sidebar">
        <div className="stack">
          <Panel>
            <PatientPicker value={patient} onChange={setPatient} required autoFocus={!initialId} />
          </Panel>

          {patient && (
            <Panel title="Unbilled charges" flush>
              {charges.isLoading ? (
                <Loading />
              ) : !charges.data?.length ? (
                <EmptyState title="No unbilled charges for this patient" />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th />
                        <th>Item</th>
                        <th>Date</th>
                        <th className="num">Qty</th>
                        <th className="num">Rate</th>
                        <th className="num">Tax %</th>
                        <th className="num">Discount</th>
                        <th className="num">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {charges.data.map((c) => {
                        const on = selected[c.id] !== undefined;
                        const line = calculateLine({ ...c, discount: num(selected[c.id] ?? '0') });
                        return (
                          <tr key={c.id}>
                            <td>
                              <Checkbox
                                label={<span className="sr-only">Include</span>}
                                checked={on}
                                onChange={(v) =>
                                  setSelected((s) => {
                                    const next = { ...s };
                                    if (v) next[c.id] = '0';
                                    else delete next[c.id];
                                    return next;
                                  })
                                }
                              />
                            </td>
                            <td>
                              <div>{c.description}</div>
                              <div className="cell-sub">{formatEnum(c.category)}</div>
                            </td>
                            <td className="nowrap">{fmtDate(c.date)}</td>
                            <td className="num">{c.quantity}</td>
                            <td className="num">{money(c.unitPrice)}</td>
                            <td className="num">{c.taxRate}</td>
                            <td className="num" style={{ width: 110 }}>
                              <input
                                className="input"
                                type="number"
                                min={0}
                                aria-label="Discount"
                                disabled={!on}
                                value={selected[c.id] ?? ''}
                                onChange={(e) => setSelected((s) => ({ ...s, [c.id]: e.target.value }))}
                              />
                            </td>
                            <td className="num">{on ? money(line.amount) : ''}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}

          {patient && (
            <Panel
              title="Additional items"
              flush
              actions={
                <Button
                  size="sm"
                  icon={<Plus size={13} />}
                  onClick={() =>
                    setExtras((xs) => [
                      ...xs,
                      { key: seq++, service: '', description: '', category: 'other', quantity: '1', unitPrice: '', taxRate: '0', discount: '0' },
                    ])
                  }
                >
                  Add item
                </Button>
              }
            >
              {extras.length === 0 ? (
                <p className="muted small" style={{ padding: 16 }}>
                  Add procedures or services that were not recorded automatically.
                </p>
              ) : (
                <div className="stack-sm" style={{ padding: 16 }}>
                  {extras.map((e) => (
                    <div key={e.key} className="form-grid form-grid-4" style={{ alignItems: 'end' }}>
                      <SelectInput
                        label="Price list item"
                        value={e.service}
                        placeholder="Custom item"
                        options={(services.data ?? []).map((s) => ({ value: s.id, label: `${s.name} (${money(s.price)})` }))}
                        onChange={(ev) => {
                          const s = serviceMap.get(ev.target.value);
                          updateExtra(e.key, {
                            service: ev.target.value,
                            description: s?.name ?? '',
                            category: s?.category ?? 'other',
                            unitPrice: s ? String(s.price) : '',
                            taxRate: s ? String(s.taxRate) : '0',
                          });
                        }}
                      />
                      <div className="field">
                        <label className="field-label">Description</label>
                        <input className="input" value={e.description} onChange={(ev) => updateExtra(e.key, { description: ev.target.value })} />
                      </div>
                      <SelectInput
                        label="Category"
                        disabled={Boolean(e.service)}
                        value={e.category}
                        options={enumOptions(SERVICE_CATEGORIES)}
                        onChange={(ev) => updateExtra(e.key, { category: ev.target.value })}
                      />
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <div className="field" style={{ width: 70 }}>
                          <label className="field-label">Qty</label>
                          <input className="input" type="number" min={0} value={e.quantity} onChange={(ev) => updateExtra(e.key, { quantity: ev.target.value })} />
                        </div>
                        <div className="field">
                          <label className="field-label">Rate</label>
                          <input
                            className="input"
                            type="number"
                            min={0}
                            disabled={Boolean(e.service)}
                            value={e.unitPrice}
                            onChange={(ev) => updateExtra(e.key, { unitPrice: ev.target.value })}
                          />
                        </div>
                      </div>
                      <div className="field">
                        <label className="field-label">Tax %</label>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          max={100}
                          disabled={Boolean(e.service)}
                          value={e.taxRate}
                          onChange={(ev) => updateExtra(e.key, { taxRate: ev.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label className="field-label">Discount</label>
                        <input className="input" type="number" min={0} value={e.discount} onChange={(ev) => updateExtra(e.key, { discount: ev.target.value })} />
                      </div>
                      <div className="row">
                        <span className="strong">{money(calculateLine({ quantity: num(e.quantity), unitPrice: num(e.unitPrice), taxRate: num(e.taxRate), discount: num(e.discount) }).amount)}</span>
                        <Button size="sm" variant="ghost" iconOnly aria-label="Remove item" icon={<Trash2 size={14} />} onClick={() => setExtras((xs) => xs.filter((x) => x.key !== e.key))} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          )}
        </div>

        <Panel
          title="Summary"
          footer={
            <Button
              variant="primary"
              disabled={!patient || lines.length === 0 || invalidExtra}
              loading={create.isPending}
              onClick={submit}
            >
              Create invoice
            </Button>
          }
        >
          <div className="stack-sm">
            <div className="row-between">
              <span>Subtotal</span>
              <span>{money(totals.subtotal)}</span>
            </div>
            <div className="row-between">
              <span>Discount</span>
              <span>- {money(totals.discountTotal)}</span>
            </div>
            <div className="row-between">
              <span>Tax</span>
              <span>{money(totals.taxTotal)}</span>
            </div>
            <hr className="divider" />
            <div className="row-between strong" style={{ fontSize: 16 }}>
              <span>Total</span>
              <span>{money(totals.total)}</span>
            </div>
            {invalidExtra && <Notice tone="warn">Complete the description, quantity and rate for each additional item.</Notice>}
            <TextArea label="Invoice notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </Panel>
      </div>
    </>
  );
}
