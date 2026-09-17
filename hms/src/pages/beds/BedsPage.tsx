import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BedDouble } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useAction } from '../../hooks/queries';
import { api } from '../../services/api';
import { DataTable, Pagination, QueryState, StatusBadge } from '../../components/data';
import { Modal } from '../../components/overlay';
import { DoctorSelect, PatientPicker } from '../../components/pickers';
import { Button, KeyValue, PageHeader, Panel, SelectInput, Tabs, TextArea, TextInput } from '../../components/ui';
import { doctorName, fmtDate, fmtDateTime, formatEnum, money, patientLine } from '../../utils/format';
import type { Admission, Bed, BedBoard, Patient } from '../../types';

const LEGEND: [string, string][] = [
  ['available', 'var(--success)'],
  ['occupied', 'var(--brand)'],
  ['reserved', 'var(--info)'],
  ['cleaning', 'var(--warning)'],
  ['maintenance', 'var(--neutral)'],
];

function AdmitModal({
  open,
  bed,
  patient: initialPatient,
  board,
  onClose,
}: {
  open: boolean;
  bed?: Bed | null;
  patient?: Patient | null;
  board?: BedBoard;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [bedId, setBedId] = useState('');
  const [doctor, setDoctor] = useState('');
  const [reason, setReason] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [expected, setExpected] = useState('');

  useEffect(() => {
    if (!open) return;
    setPatient(initialPatient ?? null);
    setBedId(bed?.id ?? '');
    setDoctor(user?.doctorId ?? '');
    setReason('');
    setDiagnosis('');
    setExpected('');
  }, [open, bed, initialPatient, user]);

  const freeBeds = (board?.wards ?? []).flatMap((w) =>
    w.beds.filter((b) => ['available', 'reserved'].includes(b.status)).map((b) => ({
      value: b.id,
      label: `${w.name}: ${b.code}${b.status === 'reserved' ? ' (reserved)' : ''}${b.dailyService ? `, ${money(b.dailyService.price)}/day` : ''}`,
    })),
  );

  const admit = useAction(
    () =>
      api.post<Admission>('/admissions', {
        patient: patient!.id,
        bed: bedId,
        admittingDoctor: doctor,
        reason,
        provisionalDiagnosis: diagnosis,
        expectedDischargeDate: expected,
      }),
    {
      success: (a) => `Admitted (${a.admissionNumber})`,
      invalidate: [['beds'], ['admissions'], ['dashboard']],
      onSuccess: (a) => {
        onClose();
        navigate(`/beds/admissions/${a.id}`);
      },
    },
  );
  const ok = Boolean(patient && bedId && doctor && reason.trim());

  return (
    <Modal
      open={open}
      wide
      title="Admit patient"
      onClose={onClose}
      onSubmit={() => ok && admit.mutate(undefined)}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!ok} loading={admit.isPending}>
            Admit
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="span-all">
          <PatientPicker value={patient} onChange={setPatient} required autoFocus={!initialPatient} />
        </div>
        <SelectInput label="Bed" required value={bedId} placeholder="Select bed" options={freeBeds} onChange={(e) => setBedId(e.target.value)} />
        <DoctorSelect label="Admitting doctor" value={doctor} onChange={setDoctor} required />
        <TextArea label="Reason for admission" required fieldClassName="span-all" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        <TextInput label="Provisional diagnosis" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
        <TextInput label="Expected discharge" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
      </div>
    </Modal>
  );
}

function BedModal({ bed, onClose, onAdmit }: { bed: Bed | null; onClose: () => void; onAdmit: (bed: Bed) => void }) {
  const { can } = useAuth();
  const [note, setNote] = useState('');
  useEffect(() => setNote(bed?.statusNote ?? ''), [bed]);
  const setStatus = useAction((status: string) => api.post(`/beds/${bed!.id}/status`, { status, note }), {
    success: 'Bed status updated',
    invalidate: [['beds'], ['dashboard']],
    onSuccess: onClose,
  });
  if (!bed) return null;
  const a = bed.currentAdmission;
  const options = ['available', 'reserved', 'cleaning', 'maintenance'].filter((s) => s !== bed.status);

  return (
    <Modal open title={`Bed ${bed.code}`} onClose={onClose}>
      <div className="stack">
        <KeyValue
          items={[
            ['Status', <StatusBadge key="s" status={bed.status} />],
            ['Type', formatEnum(bed.type)],
            ['Daily charge', bed.dailyService ? `${bed.dailyService.name}, ${money(bed.dailyService.price)}` : 'Not set'],
            ['Since', fmtDateTime(bed.statusChangedAt)],
            ['Note', bed.statusNote],
          ]}
        />
        {a && (
          <div className="panel">
            <div className="panel-body stack-sm">
              <div className="strong">{a.patient.fullName}</div>
              <div className="small muted">
                {a.patient.uhid} · {patientLine(a.patient)} · {doctorName(a.admittingDoctor)}
              </div>
              <div className="small">
                Admitted {fmtDateTime(a.admittedAt)} ({a.admissionNumber})
              </div>
              <div>
                <Link to={`/beds/admissions/${a._id}`}>Open admission</Link>
              </div>
            </div>
          </div>
        )}
        {can('admission:manage') && ['available', 'reserved'].includes(bed.status) && (
          <Button variant="primary" icon={<BedDouble size={14} />} onClick={() => onAdmit(bed)}>
            Admit a patient to this bed
          </Button>
        )}
        {can('bed:manage') && bed.status !== 'occupied' && (
          <div className="stack-sm">
            <TextInput label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="row">
              {options.map((s) => (
                <Button key={s} size="sm" loading={setStatus.isPending && setStatus.variables === s} onClick={() => setStatus.mutate(s)}>
                  Mark {formatEnum(s).toLowerCase()}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function AdmissionsList() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('admitted');
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['admissions', { status, page }],
    queryFn: () => api.page<Admission>('/admissions', { status, page, limit: 25 }),
  });
  return (
    <>
      <div className="row" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ width: 180 }}>
          <SelectInput
            aria-label="Status"
            value={status}
            placeholder="All admissions"
            options={[
              { value: 'admitted', label: 'Currently admitted' },
              { value: 'discharged', label: 'Discharged' },
            ]}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>
      <QueryState query={query} empty={{ when: (r) => r.data.length === 0, title: 'No admissions' }}>
        {(r) => (
          <>
            <DataTable
              rows={r.data}
              rowKey={(a) => a.id}
              onRowClick={(a) => navigate(`/beds/admissions/${a.id}`)}
              columns={[
                { key: 'no', header: 'Admission', render: (a) => <span className="mono">{a.admissionNumber}</span> },
                {
                  key: 'patient',
                  header: 'Patient',
                  render: (a) => (
                    <>
                      <div className="cell-title">{a.patient.fullName}</div>
                      <div className="cell-sub mono">{a.patient.uhid}</div>
                    </>
                  ),
                },
                { key: 'bed', header: 'Bed', render: (a) => `${a.bed?.ward?.name ?? ''} ${a.bed?.code ?? ''}` },
                { key: 'doctor', header: 'Doctor', render: (a) => doctorName(a.admittingDoctor) },
                { key: 'in', header: 'Admitted', render: (a) => fmtDateTime(a.admittedAt) },
                { key: 'out', header: 'Discharged', render: (a) => fmtDateTime(a.dischargedAt) || (a.expectedDischargeDate ? `Expected ${fmtDate(a.expectedDischargeDate)}` : '') },
                { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.status} /> },
              ]}
            />
            <Pagination meta={r.meta} onPage={setPage} />
          </>
        )}
      </QueryState>
    </>
  );
}

export default function BedsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'board' | 'admissions') ?? 'board';
  const [selected, setSelected] = useState<Bed | null>(null);
  const [admit, setAdmit] = useState<{ bed?: Bed | null; patient?: Patient | null } | null>(null);
  const board = useQuery({ queryKey: ['beds', 'board'], queryFn: () => api.get<BedBoard>('/beds/board') });

  const admitFor = params.get('admit');
  const admitPatient = useQuery({
    queryKey: ['patients', admitFor],
    queryFn: () => api.get<Patient>(`/patients/${admitFor}`),
    enabled: Boolean(admitFor),
  });
  useEffect(() => {
    if (admitPatient.data) {
      setAdmit({ patient: admitPatient.data });
      const next = new URLSearchParams(params);
      next.delete('admit');
      setParams(next, { replace: true });
    }
  }, [admitPatient.data, params, setParams]);

  const s = board.data?.summary;
  return (
    <>
      <PageHeader
        title="Rooms & Beds"
        description={s ? `${s.available} of ${s.total} beds available, ${s.occupied} occupied` : undefined}
        actions={
          can('admission:manage') && (
            <Button variant="primary" icon={<BedDouble size={15} />} onClick={() => setAdmit({})}>
              Admit patient
            </Button>
          )
        }
      />
      <Panel flush>
        <div style={{ padding: '0 16px' }} className="row-between">
          <Tabs
            active={tab}
            onChange={(k) => setParams({ tab: k }, { replace: true })}
            tabs={[
              { key: 'board', label: 'Bed board' },
              { key: 'admissions', label: 'Admissions' },
            ]}
          />
          {tab === 'board' && (
            <div className="legend">
              {LEGEND.map(([k, c]) => (
                <span key={k}>
                  <i style={{ background: c }} />
                  {formatEnum(k)} {s ? `(${s[k as keyof typeof s]})` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
        {tab === 'admissions' ? (
          <AdmissionsList />
        ) : (
          <QueryState
            query={board}
            empty={{
              when: (d) => d.wards.length === 0,
              title: 'No wards configured',
              body: can('ward:configure') ? <Link to="/settings?tab=wards">Add wards and beds in Settings</Link> : undefined,
            }}
          >
            {(d) => (
              <div className="stack" style={{ padding: 16 }}>
                {d.wards.map((w) => (
                  <div key={w.id}>
                    <div className="row-between" style={{ marginBottom: 8 }}>
                      <h2>
                        {w.name} <span className="small muted">({formatEnum(w.type)}{w.floor ? `, floor ${w.floor}` : ''})</span>
                      </h2>
                      <span className="small muted">
                        {w.beds.filter((b) => b.status === 'available').length} of {w.beds.length} available
                      </span>
                    </div>
                    {w.beds.length === 0 ? (
                      <p className="small muted">No beds in this ward yet.</p>
                    ) : (
                      <div className="bed-grid">
                        {w.beds.map((b) => {
                          const room = w.rooms.find((r) => r.id === b.room);
                          const a = b.currentAdmission;
                          return (
                            <button key={b.id} type="button" className={`bed ${b.status}`} onClick={() => setSelected(b)}>
                              <span className="row-between">
                                <span className="bed-code">{b.code}</span>
                                <StatusBadge status={b.status} />
                              </span>
                              {room && <span className="small muted">Room {room.number}</span>}
                              {a ? (
                                <>
                                  <span className="strong small">{a.patient.fullName}</span>
                                  <span className="small muted">Since {fmtDate(a.admittedAt)}</span>
                                </>
                              ) : (
                                b.statusNote && <span className="small muted">{b.statusNote}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </QueryState>
        )}
      </Panel>
      <BedModal
        bed={selected}
        onClose={() => setSelected(null)}
        onAdmit={(bed) => {
          setSelected(null);
          setAdmit({ bed });
        }}
      />
      <AdmitModal open={Boolean(admit)} bed={admit?.bed} patient={admit?.patient} board={board.data} onClose={() => setAdmit(null)} />
    </>
  );
}
