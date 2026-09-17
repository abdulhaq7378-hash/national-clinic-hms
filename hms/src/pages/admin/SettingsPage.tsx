import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import {
  SAMPLE_TYPES,
  SERVICE_CATEGORIES,
  WARD_TYPES,
  labTestCreateSchema,
  serviceSchema,
  settingsUpdateSchema,
} from '@hms/shared';
import { useAuth } from '../../contexts/AuthContext';
import { useAction, useServices, useSettings } from '../../hooks/queries';
import { api } from '../../services/api';
import { Badge, DataTable, Loading, QueryState } from '../../components/data';
import { Modal } from '../../components/overlay';
import {
  Button,
  Checkbox,
  enumOptions,
  Field,
  Notice,
  PageHeader,
  Panel,
  SelectInput,
  Tabs,
  TextArea,
  TextInput,
} from '../../components/ui';
import { formatEnum, money } from '../../utils/format';
import type { BedBoard, HospitalSettings, LabParameter, LabTest, Service, Ward } from '../../types';

type TabKey = 'hospital' | 'opd' | 'modules' | 'services' | 'lab' | 'wards';

function useSaveSettings() {
  return useAction((body: unknown) => api.patch<HospitalSettings>('/settings', body), {
    success: 'Settings saved',
    invalidate: [['settings'], ['dashboard']],
  });
}

function validateSection(body: unknown, setError: (e: string) => void) {
  const parsed = settingsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    setError(parsed.error.issues[0]?.message ?? 'Check the form');
    return false;
  }
  setError('');
  return true;
}

function HospitalTab({ settings }: { settings: HospitalSettings }) {
  const [h, setH] = useState(settings.hospital);
  const [billing, setBilling] = useState(settings.billing);
  const [clinical, setClinical] = useState(settings.clinical);
  const [error, setError] = useState('');
  const save = useSaveSettings();
  const set = (k: keyof typeof h, v: string) => setH((x) => ({ ...x, [k]: v }));

  const submit = () => {
    const body = {
      hospital: { ...h, establishedYear: h.establishedYear ? Number(h.establishedYear) : null },
      billing,
      clinical,
    };
    if (validateSection(body, setError)) save.mutate(body);
  };

  return (
    <Panel
      footer={
        <Button variant="primary" loading={save.isPending} onClick={submit}>
          Save
        </Button>
      }
    >
      <div className="form-grid form-grid-3">
        {error && (
          <div className="span-all">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
        <div className="form-section-title">Hospital details (printed on documents)</div>
        <TextInput label="Name" required value={h.name} onChange={(e) => set('name', e.target.value)} />
        <TextInput label="Short name" value={h.shortName ?? ''} onChange={(e) => set('shortName', e.target.value)} />
        <TextInput label="Established" type="number" value={h.establishedYear ?? ''} onChange={(e) => set('establishedYear', e.target.value)} />
        <TextInput label="Address" fieldClassName="span-all" value={h.addressLine ?? ''} onChange={(e) => set('addressLine', e.target.value)} />
        <TextInput label="City" value={h.city ?? ''} onChange={(e) => set('city', e.target.value)} />
        <TextInput label="State" value={h.state ?? ''} onChange={(e) => set('state', e.target.value)} />
        <TextInput label="PIN code" value={h.pincode ?? ''} onChange={(e) => set('pincode', e.target.value)} />
        <TextInput label="Phone" value={h.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
        <TextInput label="Email" value={h.email ?? ''} onChange={(e) => set('email', e.target.value)} />
        <TextInput label="Registration number" value={h.registrationNumber ?? ''} onChange={(e) => set('registrationNumber', e.target.value)} />
        <TextInput label="GSTIN" value={h.gstin ?? ''} onChange={(e) => set('gstin', e.target.value)} />

        <div className="form-section-title">Billing</div>
        <TextInput
          label="Invoice number prefix"
          hint="Applies to new invoices"
          value={billing.invoicePrefix}
          onChange={(e) => setBilling({ ...billing, invoicePrefix: e.target.value })}
        />
        <TextArea
          label="Invoice footer"
          fieldClassName="span-2"
          rows={2}
          value={billing.invoiceFooter ?? ''}
          onChange={(e) => setBilling({ ...billing, invoiceFooter: e.target.value })}
        />

        <div className="form-section-title">Clinical</div>
        <div className="span-all stack-sm">
          <Checkbox
            label="Doctors can open clinical records only for their own patients (others need recorded emergency access)"
            checked={clinical.restrictDoctorsToAssignedPatients}
            onChange={(v) => setClinical({ ...clinical, restrictDoctorsToAssignedPatients: v })}
          />
          <Checkbox
            label="Lab results must be verified by a different staff member than the one who entered them"
            checked={clinical.requireIndependentLabVerification}
            onChange={(v) => setClinical({ ...clinical, requireIndependentLabVerification: v })}
          />
        </div>
        <TextArea
          label="Prescription footer"
          fieldClassName="span-all"
          rows={2}
          value={clinical.prescriptionFooter ?? ''}
          onChange={(e) => setClinical({ ...clinical, prescriptionFooter: e.target.value })}
        />
      </div>
    </Panel>
  );
}

function OpdTab({ settings }: { settings: HospitalSettings }) {
  const [opd, setOpd] = useState(settings.opd);
  const [pharmacy, setPharmacy] = useState(settings.pharmacy);
  const [error, setError] = useState('');
  const save = useSaveSettings();
  const submit = () => {
    const body = { opd: { ...opd, defaultSlotMinutes: Number(opd.defaultSlotMinutes) }, pharmacy: { expiryAlertDays: Number(pharmacy.expiryAlertDays) } };
    if (validateSection(body, setError)) save.mutate(body);
  };

  return (
    <Panel
      footer={
        <Button variant="primary" loading={save.isPending} onClick={submit}>
          Save
        </Button>
      }
    >
      <div className="stack">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="form-grid form-grid-3">
          <SelectInput
            label="Token numbers restart"
            value={opd.tokenReset}
            options={[
              { value: 'daily', label: 'Every day' },
              { value: 'session', label: 'Every OPD session' },
            ]}
            onChange={(e) => setOpd({ ...opd, tokenReset: e.target.value as 'daily' | 'session' })}
          />
          <Field label="Numbering">
            {() => (
              <Checkbox
                label="Separate token series for each doctor"
                checked={opd.tokenPerDoctor}
                onChange={(v) => setOpd({ ...opd, tokenPerDoctor: v })}
              />
            )}
          </Field>
          <TextInput
            label="Pharmacy expiry alert (days)"
            type="number"
            min={1}
            value={pharmacy.expiryAlertDays}
            onChange={(e) => setPharmacy({ expiryAlertDays: Number(e.target.value) })}
          />
        </div>
        <div>
          <div className="row-between" style={{ marginBottom: 8 }}>
            <h3>OPD sessions</h3>
            <Button size="sm" icon={<Plus size={13} />} onClick={() => setOpd({ ...opd, sessions: [...opd.sessions, { name: '', start: '09:00', end: '13:00' }] })}>
              Add session
            </Button>
          </div>
          <p className="small muted" style={{ marginBottom: 8 }}>
            Used when tokens restart per session. The hospital runs a full-time OPD, so a single full-day session is the default.
          </p>
          <div className="stack-sm">
            {opd.sessions.map((s, i) => (
              <div key={i} className="row">
                <input className="input" style={{ width: 180 }} aria-label="Session name" placeholder="Name" value={s.name} onChange={(e) => setOpd({ ...opd, sessions: opd.sessions.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <input className="input" style={{ width: 130 }} type="time" aria-label="Start" value={s.start} onChange={(e) => setOpd({ ...opd, sessions: opd.sessions.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} />
                <span className="muted">to</span>
                <input className="input" style={{ width: 130 }} type="time" aria-label="End" value={s.end} onChange={(e) => setOpd({ ...opd, sessions: opd.sessions.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })} />
                {opd.sessions.length > 1 && (
                  <Button size="sm" variant="ghost" iconOnly aria-label="Remove session" icon={<Trash2 size={14} />} onClick={() => setOpd({ ...opd, sessions: opd.sessions.filter((_, j) => j !== i) })} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function ModulesTab({ settings }: { settings: HospitalSettings }) {
  const [modules, setModules] = useState(settings.modules);
  const [theatres, setTheatres] = useState(settings.ot.theatres.join('\n'));
  const [error, setError] = useState('');
  const save = useSaveSettings();
  const submit = () => {
    const body = {
      modules,
      ot: { theatres: theatres.split('\n').map((t) => t.trim()).filter(Boolean) },
    };
    if (validateSection(body, setError)) save.mutate(body);
  };
  const labels: Record<keyof typeof modules, string> = {
    pharmacy: 'Pharmacy',
    laboratory: 'Laboratory',
    beds: 'Rooms and beds (inpatient)',
    ot: 'Operation theatre',
  };
  return (
    <Panel
      footer={
        <Button variant="primary" loading={save.isPending} onClick={submit}>
          Save
        </Button>
      }
    >
      <div className="stack">
        {error && <Notice tone="danger">{error}</Notice>}
        <p className="muted">Disabled modules are hidden and their API endpoints refuse requests. Existing records are kept.</p>
        {(Object.keys(labels) as (keyof typeof modules)[]).map((k) => (
          <Checkbox key={k} label={labels[k]} checked={modules[k]} onChange={(v) => setModules({ ...modules, [k]: v })} />
        ))}
        {!modules.ot && (
          <Notice>The operation theatre facility is under development. Enable this module once the theatre is ready for use.</Notice>
        )}
        <TextArea
          label="Operation theatres (one per line)"
          rows={3}
          value={theatres}
          onChange={(e) => setTheatres(e.target.value)}
        />
      </div>
    </Panel>
  );
}

function ServicesTab() {
  const { can } = useAuth();
  const services = useQuery({ queryKey: ['services', 'admin'], queryFn: () => api.get<Service[]>('/services', { includeInactive: 'true' }) });
  const [editing, setEditing] = useState<Partial<Service> | null>(null);
  const [error, setError] = useState('');
  const save = useAction(
    (body: Record<string, unknown>) => (editing?.id ? api.patch(`/services/${editing.id}`, body) : api.post('/services', body)),
    { success: 'Price list updated', invalidate: [['services']], onSuccess: () => setEditing(null) },
  );
  const submit = () => {
    const body = {
      code: editing?.code ?? '',
      name: editing?.name ?? '',
      category: editing?.category ?? 'other',
      price: Number(editing?.price ?? 0),
      taxRate: Number(editing?.taxRate ?? 0),
      description: editing?.description ?? '',
      isActive: editing?.isActive ?? true,
    };
    const parsed = serviceSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the form');
    setError('');
    save.mutate(body);
  };

  return (
    <Panel
      flush
      title="Price list"
      actions={
        can('service:manage') && (
          <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setEditing({ category: 'consultation', taxRate: 0, isActive: true })}>
            Add service
          </Button>
        )
      }
    >
      <QueryState query={services} empty={{ when: (d) => d.length === 0, title: 'No services priced yet', body: 'Add consultation, room and procedure charges here.' }}>
        {(rows) => (
          <DataTable
            rows={rows}
            rowKey={(s) => s.id}
            onRowClick={can('service:manage') ? (s) => setEditing(s) : undefined}
            columns={[
              { key: 'code', header: 'Code', render: (s) => <span className="mono">{s.code}</span> },
              {
                key: 'name',
                header: 'Service',
                render: (s) => (
                  <>
                    <div className="cell-title">{s.name}</div>
                    {s.description && <div className="cell-sub">{s.description}</div>}
                  </>
                ),
              },
              { key: 'cat', header: 'Category', render: (s) => formatEnum(s.category) },
              { key: 'price', header: 'Price', className: 'num', render: (s) => money(s.price) },
              { key: 'tax', header: 'Tax', className: 'num', render: (s) => `${s.taxRate}%` },
              { key: 'status', header: '', render: (s) => !s.isActive && <Badge>Inactive</Badge> },
            ]}
          />
        )}
      </QueryState>
      <Modal
        open={Boolean(editing)}
        title={editing?.id ? `Edit ${editing.name}` : 'Add service'}
        onClose={() => setEditing(null)}
        onSubmit={submit}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={save.isPending}>
              Save
            </Button>
          </>
        }
      >
        {editing && (
          <div className="form-grid">
            {error && (
              <div className="span-all">
                <Notice tone="danger">{error}</Notice>
              </div>
            )}
            <TextInput label="Code" required value={editing.code ?? ''} onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
            <SelectInput label="Category" value={editing.category ?? 'other'} options={enumOptions(SERVICE_CATEGORIES)} onChange={(e) => setEditing({ ...editing, category: e.target.value })} />
            <TextInput label="Name" required fieldClassName="span-all" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <TextInput label="Price (INR)" type="number" min={0} step="0.01" required value={editing.price ?? ''} onChange={(e) => setEditing({ ...editing, price: e.target.value as unknown as number })} />
            <TextInput label="Tax %" type="number" min={0} max={100} value={editing.taxRate ?? 0} onChange={(e) => setEditing({ ...editing, taxRate: e.target.value as unknown as number })} />
            <TextInput label="Description" fieldClassName="span-all" value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            <Checkbox label="Active" checked={editing.isActive ?? true} onChange={(v) => setEditing({ ...editing, isActive: v })} />
            {editing.id && <p className="small muted span-all">Price changes apply to new charges only. Existing charges and invoices keep their original prices.</p>}
          </div>
        )}
      </Modal>
    </Panel>
  );
}

function LabTestsTab() {
  const tests = useQuery({ queryKey: ['lab', 'tests', 'admin'], queryFn: () => api.get<LabTest[]>('/laboratory/tests', { includeInactive: 'true' }) });
  const [editing, setEditing] = useState<Partial<LabTest> | null>(null);
  const [error, setError] = useState('');
  const save = useAction(
    (body: Record<string, unknown>) => (editing?.id ? api.patch(`/laboratory/tests/${editing.id}`, body) : api.post('/laboratory/tests', body)),
    { success: 'Lab test saved', invalidate: [['lab']], onSuccess: () => setEditing(null) },
  );
  const params: LabParameter[] = editing?.parameters ?? [];
  const setParams = (p: LabParameter[]) => setEditing((e) => ({ ...e, parameters: p }));
  const submit = () => {
    const body = {
      code: editing?.code ?? '',
      name: editing?.name ?? '',
      category: editing?.category ?? '',
      sampleType: editing?.sampleType ?? 'blood',
      price: Number(editing?.price ?? 0),
      taxRate: Number(editing?.taxRate ?? 0),
      turnaroundHours: Number(editing?.turnaroundHours ?? 24),
      parameters: params.map((p) => ({
        ...p,
        refLow: (p.refLow as unknown) === '' ? undefined : p.refLow,
        refHigh: (p.refHigh as unknown) === '' ? undefined : p.refHigh,
      })),
      isActive: editing?.isActive ?? true,
    };
    const parsed = labTestCreateSchema.safeParse(body);
    if (!parsed.success) return setError(`${parsed.error.issues[0]?.path.join(' ')}: ${parsed.error.issues[0]?.message}`);
    setError('');
    save.mutate(body);
  };

  return (
    <Panel
      flush
      title="Lab test catalog"
      actions={
        <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setEditing({ sampleType: 'blood', turnaroundHours: 24, taxRate: 0, isActive: true, parameters: [{ name: '' }] })}>
          Add test
        </Button>
      }
    >
      <QueryState query={tests} empty={{ when: (d) => d.length === 0, title: 'No lab tests configured' }}>
        {(rows) => (
          <DataTable
            rows={rows}
            rowKey={(t) => t.id}
            onRowClick={(t) => setEditing(JSON.parse(JSON.stringify(t)))}
            columns={[
              { key: 'code', header: 'Code', render: (t) => <span className="mono">{t.code}</span> },
              { key: 'name', header: 'Test', render: (t) => <span className="cell-title">{t.name}</span> },
              { key: 'sample', header: 'Sample', render: (t) => formatEnum(t.sampleType) },
              { key: 'params', header: 'Parameters', render: (t) => t.parameters.map((p) => p.name).join(', ') },
              { key: 'price', header: 'Price', className: 'num', render: (t) => money(t.price) },
              { key: 'tat', header: 'Turnaround', render: (t) => `${t.turnaroundHours} h` },
              { key: 'status', header: '', render: (t) => !t.isActive && <Badge>Inactive</Badge> },
            ]}
          />
        )}
      </QueryState>
      <Modal
        open={Boolean(editing)}
        wide
        title={editing?.id ? `Edit ${editing.name}` : 'Add lab test'}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} onClick={submit}>
              Save
            </Button>
          </>
        }
      >
        {editing && (
          <div className="stack">
            {error && <Notice tone="danger">{error}</Notice>}
            <div className="form-grid form-grid-3">
              <TextInput label="Code" required value={editing.code ?? ''} onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
              <TextInput label="Name" required fieldClassName="span-2" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              <TextInput label="Category" value={editing.category ?? ''} onChange={(e) => setEditing({ ...editing, category: e.target.value })} />
              <SelectInput label="Sample" value={editing.sampleType ?? 'blood'} options={enumOptions(SAMPLE_TYPES)} onChange={(e) => setEditing({ ...editing, sampleType: e.target.value })} />
              <TextInput label="Turnaround (hours)" type="number" min={1} value={editing.turnaroundHours ?? 24} onChange={(e) => setEditing({ ...editing, turnaroundHours: e.target.value as unknown as number })} />
              <TextInput label="Price (INR)" type="number" min={0} value={editing.price ?? ''} onChange={(e) => setEditing({ ...editing, price: e.target.value as unknown as number })} />
              <TextInput label="Tax %" type="number" min={0} value={editing.taxRate ?? 0} onChange={(e) => setEditing({ ...editing, taxRate: e.target.value as unknown as number })} />
              <Field label="Status">{() => <Checkbox label="Active" checked={editing.isActive ?? true} onChange={(v) => setEditing({ ...editing, isActive: v })} />}</Field>
            </div>
            <div>
              <div className="row-between" style={{ marginBottom: 6 }}>
                <h3>Parameters</h3>
                <Button size="sm" icon={<Plus size={13} />} onClick={() => setParams([...params, { name: '' }])}>
                  Add parameter
                </Button>
              </div>
              <p className="small muted" style={{ marginBottom: 6 }}>
                Numeric low and high limits enable automatic flagging. Use the reference range text for ranges that depend on age or sex.
              </p>
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Unit</th>
                    <th>Reference range (printed)</th>
                    <th>Low</th>
                    <th>High</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {params.map((p, i) => {
                    const upd = (patch: Partial<LabParameter>) => setParams(params.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                    return (
                      <tr key={i}>
                        <td><input className="input" aria-label="Name" value={p.name} onChange={(e) => upd({ name: e.target.value })} /></td>
                        <td><input className="input" aria-label="Unit" value={p.unit ?? ''} onChange={(e) => upd({ unit: e.target.value })} /></td>
                        <td><input className="input" aria-label="Reference range" value={p.referenceRange ?? ''} onChange={(e) => upd({ referenceRange: e.target.value })} /></td>
                        <td style={{ width: 90 }}><input className="input" type="number" aria-label="Low" value={p.refLow ?? ''} onChange={(e) => upd({ refLow: e.target.value as unknown as number })} /></td>
                        <td style={{ width: 90 }}><input className="input" type="number" aria-label="High" value={p.refHigh ?? ''} onChange={(e) => upd({ refHigh: e.target.value as unknown as number })} /></td>
                        <td>
                          {params.length > 1 && (
                            <Button size="sm" variant="ghost" iconOnly aria-label="Remove parameter" icon={<Trash2 size={14} />} onClick={() => setParams(params.filter((_, j) => j !== i))} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </Panel>
  );
}

function WardsTab() {
  const wards = useQuery({ queryKey: ['beds', 'wards'], queryFn: () => api.get<Ward[]>('/wards', { includeInactive: 'true' }) });
  const board = useQuery({ queryKey: ['beds', 'board'], queryFn: () => api.get<BedBoard>('/beds/board') });
  const rooms = useServices('room');
  const [wardForm, setWardForm] = useState<{ id?: string; name: string; code: string; type: string; floor: string } | null>(null);
  const [roomFor, setRoomFor] = useState<Ward | null>(null);
  const [roomNumber, setRoomNumber] = useState('');
  const [bedFor, setBedFor] = useState<Ward | null>(null);
  const [bed, setBed] = useState({ code: '', room: '', dailyService: '' });
  const [bedPrice, setBedPrice] = useState<{ id: string; code: string; dailyService: string } | null>(null);

  const saveWard = useAction(
    () =>
      wardForm?.id
        ? api.patch(`/wards/${wardForm.id}`, { name: wardForm.name, type: wardForm.type, floor: wardForm.floor })
        : api.post('/wards', wardForm),
    { success: 'Ward saved', invalidate: [['beds']], onSuccess: () => setWardForm(null) },
  );
  const addRoom = useAction(() => api.post(`/wards/${roomFor!.id}/rooms`, { number: roomNumber }), {
    success: 'Room added',
    invalidate: [['beds']],
    onSuccess: () => {
      setRoomFor(null);
      setRoomNumber('');
    },
  });
  const addBed = useAction(
    () => api.post('/beds', { ward: bedFor!.id, type: bedFor!.type, code: bed.code, room: bed.room, dailyService: bed.dailyService }),
    { success: 'Bed added', invalidate: [['beds']], onSuccess: () => setBedFor(null) },
  );
  const updateBedPrice = useAction(() => api.patch(`/beds/${bedPrice!.id}`, { dailyService: bedPrice!.dailyService }), {
    success: 'Daily charge updated',
    invalidate: [['beds']],
    onSuccess: () => setBedPrice(null),
  });
  const roomOptions = (rooms.data ?? []).map((s) => ({ value: s.id, label: `${s.name} (${money(s.price)})` }));

  if (wards.isLoading) return <Loading />;
  return (
    <div className="stack">
      <div className="row-between">
        <p className="muted">National Clinic currently has three private rooms and two general wards. Add wards, rooms and beds as the hospital grows.</p>
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => setWardForm({ name: '', code: '', type: 'general', floor: '' })}>
          Add ward
        </Button>
      </div>
      {(wards.data ?? []).map((w) => {
        const beds = board.data?.wards.find((b) => b.id === w.id)?.beds ?? [];
        return (
          <Panel
            key={w.id}
            title={
              <h2>
                {w.name} <span className="small muted">({w.code}, {formatEnum(w.type)})</span> {!w.isActive && <Badge>Inactive</Badge>}
              </h2>
            }
            actions={
              <>
                <Button size="sm" onClick={() => setWardForm({ id: w.id, name: w.name, code: w.code, type: w.type, floor: w.floor ?? '' })}>
                  Edit
                </Button>
                <Button size="sm" onClick={() => setRoomFor(w)}>
                  Add room
                </Button>
                <Button size="sm" variant="primary" onClick={() => { setBed({ code: '', room: '', dailyService: '' }); setBedFor(w); }}>
                  Add bed
                </Button>
              </>
            }
            flush
          >
            <div style={{ padding: '8px 16px' }} className="small muted">
              Rooms: {w.rooms.map((r) => r.number).join(', ') || 'none'}
            </div>
            {beds.length > 0 && (
              <DataTable
                rows={beds}
                rowKey={(b) => b.id}
                columns={[
                  { key: 'code', header: 'Bed', render: (b) => <strong>{b.code}</strong> },
                  { key: 'room', header: 'Room', render: (b) => w.rooms.find((r) => r.id === b.room)?.number },
                  { key: 'status', header: 'Status', render: (b) => formatEnum(b.status) },
                  {
                    key: 'charge',
                    header: 'Daily charge',
                    render: (b) => (b.dailyService ? `${b.dailyService.name}, ${money(b.dailyService.price)}` : <span className="danger-text">Not set</span>),
                  },
                  {
                    key: 'edit',
                    header: '',
                    className: 'right',
                    render: (b) => (
                      <Button size="sm" onClick={() => setBedPrice({ id: b.id, code: b.code, dailyService: b.dailyService?._id ?? '' })}>
                        Set charge
                      </Button>
                    ),
                  },
                ]}
              />
            )}
          </Panel>
        );
      })}

      <Modal
        open={Boolean(wardForm)}
        title={wardForm?.id ? 'Edit ward' : 'Add ward'}
        onClose={() => setWardForm(null)}
        onSubmit={() => wardForm?.name && wardForm.code && saveWard.mutate(undefined)}
        footer={
          <>
            <Button onClick={() => setWardForm(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saveWard.isPending}>
              Save
            </Button>
          </>
        }
      >
        {wardForm && (
          <div className="form-grid">
            <TextInput label="Name" required value={wardForm.name} onChange={(e) => setWardForm({ ...wardForm, name: e.target.value })} />
            <TextInput label="Code" required disabled={Boolean(wardForm.id)} value={wardForm.code} onChange={(e) => setWardForm({ ...wardForm, code: e.target.value })} />
            <SelectInput label="Type" value={wardForm.type} options={enumOptions(WARD_TYPES)} onChange={(e) => setWardForm({ ...wardForm, type: e.target.value })} />
            <TextInput label="Floor" value={wardForm.floor} onChange={(e) => setWardForm({ ...wardForm, floor: e.target.value })} />
          </div>
        )}
      </Modal>
      <Modal
        open={Boolean(roomFor)}
        title={`Add room to ${roomFor?.name ?? ''}`}
        onClose={() => setRoomFor(null)}
        onSubmit={() => roomNumber.trim() && addRoom.mutate(undefined)}
        footer={
          <>
            <Button onClick={() => setRoomFor(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={addRoom.isPending}>
              Add
            </Button>
          </>
        }
      >
        <TextInput label="Room number" required value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} />
      </Modal>
      <Modal
        open={Boolean(bedFor)}
        title={`Add bed to ${bedFor?.name ?? ''}`}
        onClose={() => setBedFor(null)}
        onSubmit={() => bed.code.trim() && addBed.mutate(undefined)}
        footer={
          <>
            <Button onClick={() => setBedFor(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={addBed.isPending}>
              Add
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <TextInput label="Bed code" required hint="Unique across the hospital, for example GW1-07" value={bed.code} onChange={(e) => setBed({ ...bed, code: e.target.value })} />
          <SelectInput
            label="Room"
            value={bed.room}
            placeholder="No room (open ward)"
            options={(bedFor?.rooms ?? []).map((r) => ({ value: r.id, label: r.number }))}
            onChange={(e) => setBed({ ...bed, room: e.target.value })}
          />
          <SelectInput label="Daily charge" fieldClassName="span-all" value={bed.dailyService} placeholder="Not set" options={roomOptions} onChange={(e) => setBed({ ...bed, dailyService: e.target.value })} />
          {roomOptions.length === 0 && (
            <p className="small muted span-all">Add services in the room category to the price list to set daily charges.</p>
          )}
        </div>
      </Modal>
      <Modal
        open={Boolean(bedPrice)}
        title={`Daily charge for ${bedPrice?.code ?? ''}`}
        onClose={() => setBedPrice(null)}
        footer={
          <>
            <Button onClick={() => setBedPrice(null)}>Cancel</Button>
            <Button variant="primary" loading={updateBedPrice.isPending} onClick={() => updateBedPrice.mutate(undefined)}>
              Save
            </Button>
          </>
        }
      >
        <SelectInput
          label="Daily charge"
          value={bedPrice?.dailyService ?? ''}
          placeholder="Not set"
          options={roomOptions}
          onChange={(e) => setBedPrice((b) => (b ? { ...b, dailyService: e.target.value } : b))}
        />
      </Modal>
    </div>
  );
}

export default function SettingsPage() {
  const { can } = useAuth();
  const settings = useSettings();
  const [params, setParams] = useSearchParams();
  const tabs = (
    [
      { key: 'hospital', label: 'Hospital', show: can('settings:manage') },
      { key: 'opd', label: 'OPD and tokens', show: can('settings:manage') },
      { key: 'modules', label: 'Modules', show: can('settings:manage') },
      { key: 'services', label: 'Price list', show: can('service:read') },
      { key: 'lab', label: 'Lab tests', show: can('lab:catalog') && settings.data?.modules.laboratory !== false },
      { key: 'wards', label: 'Wards and beds', show: can('ward:configure') && settings.data?.modules.beds !== false },
    ] as { key: TabKey; label: string; show: boolean }[]
  ).filter((t) => t.show);
  const requested = params.get('tab') as TabKey | null;
  const active = tabs.find((t) => t.key === requested)?.key ?? tabs[0]?.key;

  // Remount forms when fresh settings arrive so they never show stale values.
  const [version, setVersion] = useState(0);
  useEffect(() => setVersion((v) => v + 1), [settings.dataUpdatedAt]);

  if (settings.isLoading || !settings.data) return <Loading />;
  return (
    <>
      <PageHeader title="Settings" />
      <div style={{ marginBottom: 16 }}>
        <Tabs tabs={tabs} active={active} onChange={(k) => setParams({ tab: k }, { replace: true })} />
      </div>
      {active === 'hospital' && <HospitalTab key={version} settings={settings.data} />}
      {active === 'opd' && <OpdTab key={version} settings={settings.data} />}
      {active === 'modules' && <ModulesTab key={version} settings={settings.data} />}
      {active === 'services' && <ServicesTab />}
      {active === 'lab' && <LabTestsTab />}
      {active === 'wards' && <WardsTab />}
    </>
  );
}
