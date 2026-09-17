import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarPlus, Syringe } from 'lucide-react';
import { OT_STATUSES, OT_TRANSITIONS, PRIORITIES, addDays, toHospitalDate, type OtStatus } from '@hms/shared';
import { useAuth } from '../contexts/AuthContext';
import { useAction, useSettings } from '../hooks/queries';
import { api } from '../services/api';
import { DataTable, EmptyState, Loading, QueryState, StatusBadge } from '../components/data';
import { Modal } from '../components/overlay';
import { DoctorSelect, PatientPicker } from '../components/pickers';
import { Button, enumOptions, KeyValue, Notice, PageHeader, Panel, SelectInput, TextArea, TextInput } from '../components/ui';
import { doctorName, fmtDate, fmtDateTime, fmtTime, formatEnum } from '../utils/format';
import type { OtBooking, Patient } from '../types';

const ANAESTHESIA = ['general', 'spinal', 'epidural', 'regional', 'local', 'sedation', 'none'];

function BookingModal({ open, onClose, theatres }: { open: boolean; onClose: () => void; theatres: string[] }) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [f, setF] = useState({
    procedureName: '',
    surgeon: '',
    assistant: '',
    anaesthetist: '',
    anaesthesiaType: 'local',
    theatre: '',
    date: '',
    time: '09:00',
    estimatedMinutes: '60',
    priority: 'routine',
    preOpNotes: '',
  });
  useEffect(() => {
    if (open) {
      setPatient(null);
      setF((x) => ({ ...x, procedureName: '', theatre: theatres[0] ?? '', date: addDays(toHospitalDate(), 1), preOpNotes: '' }));
    }
  }, [open, theatres]);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = useAction(
    () =>
      api.post<OtBooking>('/ot', {
        patient: patient!.id,
        procedureName: f.procedureName,
        surgeon: f.surgeon,
        assistant: f.assistant,
        anaesthetist: f.anaesthetist,
        anaesthesiaType: f.anaesthesiaType,
        theatre: f.theatre,
        scheduledStart: new Date(`${f.date}T${f.time}:00+05:30`).toISOString(),
        estimatedMinutes: Number(f.estimatedMinutes),
        priority: f.priority,
        preOpNotes: f.preOpNotes,
      }),
    { success: (b) => `Procedure scheduled (${b.bookingNumber})`, invalidate: [['ot']], onSuccess: onClose },
  );
  const ok = Boolean(patient && f.procedureName.trim() && f.surgeon && f.theatre && f.date && f.time);

  return (
    <Modal
      open={open}
      wide
      title="Schedule procedure"
      onClose={onClose}
      onSubmit={() => ok && save.mutate(undefined)}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!ok} loading={save.isPending}>
            Schedule
          </Button>
        </>
      }
    >
      <div className="form-grid form-grid-3">
        <div className="span-all">
          <PatientPicker value={patient} onChange={setPatient} required />
        </div>
        <TextInput label="Procedure" required fieldClassName="span-2" value={f.procedureName} onChange={(e) => set('procedureName', e.target.value)} />
        <SelectInput label="Priority" value={f.priority} options={enumOptions(PRIORITIES)} onChange={(e) => set('priority', e.target.value)} />
        <DoctorSelect label="Surgeon" required value={f.surgeon} onChange={(v) => set('surgeon', v)} />
        <TextInput label="Assistant" value={f.assistant} onChange={(e) => set('assistant', e.target.value)} />
        <TextInput label="Anaesthetist" value={f.anaesthetist} onChange={(e) => set('anaesthetist', e.target.value)} />
        <SelectInput label="Anaesthesia" value={f.anaesthesiaType} options={enumOptions(ANAESTHESIA)} onChange={(e) => set('anaesthesiaType', e.target.value)} />
        <SelectInput label="Theatre" required value={f.theatre} options={theatres.map((t) => ({ value: t, label: t }))} onChange={(e) => set('theatre', e.target.value)} />
        <TextInput label="Estimated minutes" type="number" min={5} value={f.estimatedMinutes} onChange={(e) => set('estimatedMinutes', e.target.value)} />
        <TextInput label="Date" type="date" required min={toHospitalDate()} value={f.date} onChange={(e) => set('date', e.target.value)} />
        <TextInput label="Start time" type="time" required value={f.time} onChange={(e) => set('time', e.target.value)} />
        <TextArea label="Pre-operative notes" fieldClassName="span-all" rows={3} value={f.preOpNotes} onChange={(e) => set('preOpNotes', e.target.value)} />
      </div>
    </Modal>
  );
}

function BookingDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can } = useAuth();
  const [note, setNote] = useState('');
  const [postOp, setPostOp] = useState('');
  const query = useQuery({ queryKey: ['ot', id], queryFn: () => api.get<OtBooking>(`/ot/${id}`), enabled: Boolean(id) });
  const b = query.data;
  useEffect(() => {
    setNote('');
    setPostOp(b?.postOpNotes ?? '');
  }, [b]);
  const status = useAction((s: OtStatus) => api.post(`/ot/${id}/status`, { status: s, note }), {
    success: 'Status updated',
    invalidate: [['ot']],
  });
  const saveNotes = useAction(() => api.patch(`/ot/${id}`, { postOpNotes: postOp }), {
    success: 'Post-operative notes saved',
    invalidate: [['ot']],
  });
  const next = b ? OT_TRANSITIONS[b.status as OtStatus] : [];

  return (
    <Modal open={Boolean(id)} variant="drawer" title={b ? `${b.procedureName}` : 'Procedure'} onClose={onClose}>
      {!b ? (
        <Loading />
      ) : (
        <div className="stack">
          <KeyValue
            items={[
              ['Booking', <span key="n" className="mono">{b.bookingNumber}</span>],
              ['Status', <StatusBadge key="s" status={b.status} />],
              ['Patient', <Link key="p" to={`/patients/${b.patient.id ?? b.patient._id}`}>{b.patient.fullName} ({b.patient.uhid})</Link>],
              ['Scheduled', `${fmtDateTime(b.scheduledStart)} to ${fmtTime(b.scheduledEnd)}`],
              ['Theatre', b.theatre],
              ['Surgeon', doctorName(b.surgeon)],
              ['Assistant', b.assistant],
              ['Anaesthetist', b.anaesthetist],
              ['Anaesthesia', b.anaesthesiaType ? formatEnum(b.anaesthesiaType) : ''],
              ['Priority', formatEnum(b.priority)],
              ['Actual start', fmtDateTime(b.actualStart)],
              ['Actual end', fmtDateTime(b.actualEnd)],
              ['Pre-op notes', b.preOpNotes],
            ]}
          />
          {can('ot:manage') && ['in_progress', 'completed'].includes(b.status) && (
            <div className="stack-sm">
              <TextArea label="Post-operative notes" rows={5} value={postOp} onChange={(e) => setPostOp(e.target.value)} />
              <div>
                <Button size="sm" disabled={!postOp.trim()} loading={saveNotes.isPending} onClick={() => saveNotes.mutate(undefined)}>
                  Save notes
                </Button>
              </div>
            </div>
          )}
          {!can('ot:manage') && b.postOpNotes && <KeyValue items={[['Post-op notes', b.postOpNotes]]} />}
          {can('ot:manage') && next.length > 0 && (
            <div className="stack-sm">
              <TextInput label="Note (required to postpone or cancel)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="row">
                {next.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={s === 'cancelled' ? 'danger' : 'default'}
                    disabled={['cancelled', 'postponed'].includes(s) && !note.trim()}
                    loading={status.isPending && status.variables === s}
                    onClick={() => status.mutate(s)}
                  >
                    {formatEnum(s)}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div>
            <h3 style={{ marginBottom: 6 }}>History</h3>
            <ul className="list small">
              {b.statusHistory?.map((h, i) => (
                <li key={i} className="list-item">
                  {formatEnum(h.status)} · {fmtDateTime(h.at)} · {h.by?.name}
                  {h.note ? `: ${h.note}` : ''}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function OtPage() {
  const { can } = useAuth();
  const settings = useSettings();
  const [from, setFrom] = useState(toHospitalDate());
  const [to, setTo] = useState(addDays(toHospitalDate(), 14));
  const [status, setStatus] = useState('');
  const [booking, setBooking] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const enabled = settings.data?.modules.ot;

  const query = useQuery({
    queryKey: ['ot', { from, to, status }],
    queryFn: () => api.page<OtBooking>('/ot', { from, to, status, limit: 100 }).then((r) => r.data),
    enabled: Boolean(enabled && can('ot:read')),
    placeholderData: keepPreviousData,
  });

  if (settings.isLoading) return <Loading />;
  if (!enabled) {
    return (
      <>
        <PageHeader title="Operation Theatre" />
        <Panel>
          <EmptyState title="The operation theatre module is not enabled" icon={<Syringe size={28} />}>
            <p>The hospital's operation theatre facility is being developed. Scheduling becomes available once an administrator enables the module.</p>
            {can('settings:manage') && (
              <p style={{ marginTop: 8 }}>
                <Link to="/settings?tab=modules">Open module settings</Link>
              </p>
            )}
          </EmptyState>
        </Panel>
      </>
    );
  }

  const theatres = settings.data?.ot.theatres ?? [];
  return (
    <>
      <PageHeader
        title="Operation Theatre"
        description="Theatre schedule. Bookings cannot overlap for the same theatre or surgeon."
        actions={
          can('ot:manage') && (
            <Button variant="primary" icon={<CalendarPlus size={15} />} disabled={!theatres.length} onClick={() => setBooking(true)}>
              Schedule procedure
            </Button>
          )
        }
      />
      {!theatres.length && <Notice tone="warn">No theatres are configured. Add them in Settings.</Notice>}
      <Panel
        flush
        title={
          <div className="row">
            <TextInput aria-label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <TextInput aria-label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <div style={{ width: 160 }}>
              <SelectInput aria-label="Status" value={status} placeholder="All statuses" options={enumOptions(OT_STATUSES)} onChange={(e) => setStatus(e.target.value)} />
            </div>
          </div>
        }
      >
        <QueryState query={query} empty={{ when: (d) => d.length === 0, title: 'No procedures scheduled in this period' }}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(b) => b.id}
              onRowClick={(b) => setSelected(b.id)}
              columns={[
                {
                  key: 'when',
                  header: 'When',
                  render: (b) => (
                    <span className="nowrap">
                      {fmtDate(b.scheduledStart)}
                      <br />
                      {fmtTime(b.scheduledStart)} to {fmtTime(b.scheduledEnd)}
                    </span>
                  ),
                },
                { key: 'theatre', header: 'Theatre', render: (b) => b.theatre },
                { key: 'proc', header: 'Procedure', render: (b) => <span className="cell-title">{b.procedureName}</span> },
                { key: 'patient', header: 'Patient', render: (b) => b.patient.fullName },
                { key: 'surgeon', header: 'Surgeon', render: (b) => doctorName(b.surgeon) },
                { key: 'priority', header: 'Priority', render: (b) => <StatusBadge status={b.priority} /> },
                { key: 'status', header: 'Status', render: (b) => <StatusBadge status={b.status} /> },
              ]}
            />
          )}
        </QueryState>
      </Panel>
      <BookingModal open={booking} onClose={() => setBooking(false)} theatres={theatres} />
      <BookingDrawer id={selected} onClose={() => setSelected(null)} />
    </>
  );
}
