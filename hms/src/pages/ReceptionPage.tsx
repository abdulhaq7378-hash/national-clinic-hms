import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, PhoneCall, Ticket, UserPlus } from 'lucide-react';
import { toHospitalDate } from '@hms/shared';
import { useAuth } from '../contexts/AuthContext';
import { useAction, useDoctors } from '../hooks/queries';
import { api } from '../services/api';
import { DataTable, EmptyState, QueryState, StatusBadge } from '../components/data';
import { ConfirmDialog } from '../components/overlay';
import { DoctorSelect } from '../components/pickers';
import { Button, LinkButton, PageHeader, Panel } from '../components/ui';
import { VitalsModal } from '../features/opd/VitalsModal';
import { WalkInModal } from '../features/opd/WalkInModal';
import { doctorName, fmtClock, fmtDate, fmtTime, formatEnum, patientLine, vitalsSummary } from '../utils/format';
import type { Appointment, QueueData, Token } from '../types';

type Action = 'call' | 'complete' | 'skip' | 'requeue' | 'cancel';

function PatientCell({ t }: { t: Token }) {
  return (
    <>
      <Link to={`/patients/${t.patient._id ?? t.patient.id}`} className="cell-title">
        {t.patient.fullName}
      </Link>
      <div className="cell-sub">
        <span className="mono">{t.patient.uhid}</span> · {patientLine(t.patient)}
      </div>
      {t.vitals && <div className="cell-sub">{vitalsSummary(t.vitals as Record<string, number>)}</div>}
      {t.notes && <div className="cell-sub">Reason: {t.notes}</div>}
    </>
  );
}

export default function ReceptionPage() {
  const { can, user } = useAuth();
  const doctors = useDoctors();
  const [params, setParams] = useSearchParams();
  const doctor = params.get('doctor') ?? (user?.role === 'doctor' ? user.doctorId ?? '' : '');
  const [walkIn, setWalkIn] = useState(false);
  const [vitalsFor, setVitalsFor] = useState<Token | null>(null);
  const [cancelling, setCancelling] = useState<Token | null>(null);
  const today = toHospitalDate();

  const queue = useQuery({
    queryKey: ['queue', { doctor }],
    queryFn: () => api.get<QueueData>('/queue', { doctor }),
  });
  const arrivals = useQuery({
    queryKey: ['appointments', { date: today, doctor, arrivals: true }],
    queryFn: () => api.page<Appointment>('/appointments', { date: today, doctor, limit: 200 }).then((r) => r.data),
    enabled: can('appointment:read'),
  });
  const act = useAction(
    ({ id, action, reason }: { id: string; action: Action; reason?: string }) =>
      api.post(`/queue/${id}/action`, { action, reason }),
    { invalidate: [['queue'], ['appointments'], ['dashboard']], onSuccess: () => setCancelling(null) },
  );
  const callNext = useAction(() => api.post<Token>('/queue/call-next', { doctor }), {
    success: (t) => `Token ${t.number}: ${t.patient.fullName} sent to ${doctorName(t.doctor)}`,
    invalidate: [['queue'], ['appointments']],
  });
  const checkIn = useAction((id: string) => api.post<Token>('/queue/check-in', { appointment: id }), {
    success: (t) => `Checked in. Token ${t.number}`,
    invalidate: [['queue'], ['appointments'], ['dashboard']],
  });

  const manage = can('queue:manage');
  const s = queue.data?.summary;
  const notArrived = (arrivals.data ?? []).filter((a) => ['scheduled', 'confirmed'].includes(a.status));
  const showDoctor = !doctor && (doctors.data?.length ?? 0) > 1;
  const doctorColumn = showDoctor
    ? [{ key: 'doctor', header: 'Doctor', render: (t: Token) => doctorName(t.doctor) }]
    : [];

  return (
    <>
      <PageHeader
        title="Reception"
        description={`OPD queue for ${fmtDate(today)}`}
        actions={
          <>
            {can('patient:create') && (
              <LinkButton to="/patients/new" icon={<UserPlus size={15} />}>
                Register patient
              </LinkButton>
            )}
            {manage && (
              <Button variant="primary" icon={<Ticket size={15} />} onClick={() => setWalkIn(true)}>
                Walk-in token
              </Button>
            )}
          </>
        }
      />

      <div className="row-between" style={{ marginBottom: 12 }}>
        <div style={{ minWidth: 260 }}>
          <DoctorSelect
            label=""
            value={doctor}
            allowAll
            onChange={(v) => setParams(v ? { doctor: v } : {}, { replace: true })}
          />
        </div>
        {manage && doctor && (
          <Button
            icon={<PhoneCall size={15} />}
            onClick={() => callNext.mutate(undefined)}
            loading={callNext.isPending}
            disabled={!s?.waiting}
          >
            Send next patient
          </Button>
        )}
      </div>

      <div className="queue-board" style={{ marginBottom: 16 }}>
        <div className="panel queue-figure">
          <div className="label">Current token</div>
          <div className="value">{s?.lastIssued ?? '0'}</div>
          <div className="small subtle">{doctor ? 'Last issued for this doctor' : 'Last issued'}</div>
        </div>
        <div className="panel queue-figure now">
          <div className="label">Now serving</div>
          <div className="value">{s?.nowServing.length ? s.nowServing.join(', ') : 'None'}</div>
          <div className="small subtle">With the doctor</div>
        </div>
        <div className="panel queue-figure">
          <div className="label">Waiting</div>
          <div className="value">{s?.waiting ?? 0}</div>
          <div className="small subtle">{s?.skipped ? `${s.skipped} skipped` : 'In the waiting area'}</div>
        </div>
        <div className="panel queue-figure">
          <div className="label">Completed</div>
          <div className="value">{s?.completed ?? 0}</div>
          <div className="small subtle">Seen today</div>
        </div>
      </div>

      <div className="grid grid-sidebar">
        <div className="stack">
          <Panel title="With doctor" flush>
            <QueryState query={queue} empty={{ when: (d) => d.withDoctor.length === 0, title: 'No patient is with a doctor' }}>
              {(d) => (
                <DataTable
                  rows={d.withDoctor}
                  rowKey={(t) => t.id}
                  columns={[
                    { key: 'no', header: 'Token', render: (t) => <span className="token-number">{t.number}</span> },
                    { key: 'patient', header: 'Patient', render: (t) => <PatientCell t={t} /> },
                    ...doctorColumn,
                    {
                      key: 'since',
                      header: 'Consultation',
                      render: (t) => (
                        <>
                          <div className="nowrap">Since {fmtTime(t.calledAt)}</div>
                          {t.consultation && <StatusBadge status={t.consultation.status} />}
                        </>
                      ),
                    },
                    {
                      key: 'actions',
                      header: '',
                      className: 'right',
                      render: (t) =>
                        manage && (
                          <div className="row nowrap" style={{ justifyContent: 'flex-end' }}>
                            <Button size="sm" onClick={() => act.mutate({ id: t.id, action: 'complete' })}>
                              Mark seen
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: t.id, action: 'skip' })}>
                              Not present
                            </Button>
                          </div>
                        ),
                    },
                  ]}
                />
              )}
            </QueryState>
          </Panel>

          <Panel title={`Waiting (${s?.waiting ?? 0})`} flush>
            <QueryState query={queue} empty={{ when: (d) => d.waiting.length === 0, title: 'Nobody is waiting' }}>
              {(d) => (
                <DataTable
                  rows={d.waiting}
                  rowKey={(t) => t.id}
                  columns={[
                    { key: 'no', header: 'Token', render: (t) => <span className="token-number">{t.number}</span> },
                    { key: 'patient', header: 'Patient', render: (t) => <PatientCell t={t} /> },
                    ...doctorColumn,
                    {
                      key: 'visit',
                      header: 'Visit',
                      render: (t) => (
                        <>
                          <div>{t.appointment ? `Appointment ${fmtClock(t.appointment.startTime)}` : 'Walk-in'}</div>
                          {t.priority !== 'routine' && <StatusBadge status={t.priority} />}
                        </>
                      ),
                    },
                    { key: 'arrived', header: 'Arrived', render: (t) => <span className="nowrap">{fmtTime(t.checkedInAt)}</span> },
                    {
                      key: 'actions',
                      header: '',
                      className: 'right',
                      render: (t) => (
                        <div className="row nowrap" style={{ justifyContent: 'flex-end' }}>
                          {can('vitals:write') && (
                            <Button size="sm" icon={<Activity size={13} />} onClick={() => setVitalsFor(t)}>
                              Vitals
                            </Button>
                          )}
                          {manage && (
                            <>
                              <Button size="sm" variant="primary" onClick={() => act.mutate({ id: t.id, action: 'call' })}>
                                Send in
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: t.id, action: 'skip' })}>
                                Skip
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setCancelling(t)}>
                                Cancel
                              </Button>
                            </>
                          )}
                        </div>
                      ),
                    },
                  ]}
                />
              )}
            </QueryState>
          </Panel>

          {(queue.data?.other.length ?? 0) > 0 && (
            <Panel title="Skipped and cancelled" flush>
              <DataTable
                rows={queue.data!.other}
                rowKey={(t) => t.id}
                columns={[
                  { key: 'no', header: 'Token', render: (t) => <span className="token-number">{t.number}</span> },
                  { key: 'patient', header: 'Patient', render: (t) => t.patient.fullName },
                  ...doctorColumn,
                  { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} /> },
                  {
                    key: 'actions',
                    header: '',
                    className: 'right',
                    render: (t) =>
                      manage &&
                      t.status === 'skipped' && (
                        <Button size="sm" onClick={() => act.mutate({ id: t.id, action: 'requeue' })}>
                          Return to queue
                        </Button>
                      ),
                  },
                ]}
              />
            </Panel>
          )}

          <Panel title={`Completed (${s?.completed ?? 0})`} flush>
            <QueryState query={queue} empty={{ when: (d) => d.completed.length === 0, title: 'No completed visits yet' }}>
              {(d) => (
                <DataTable
                  rows={d.completed}
                  rowKey={(t) => t.id}
                  columns={[
                    { key: 'no', header: 'Token', render: (t) => <span className="token-number">{t.number}</span> },
                    { key: 'patient', header: 'Patient', render: (t) => t.patient.fullName },
                    ...doctorColumn,
                    { key: 'done', header: 'Completed', render: (t) => fmtTime(t.completedAt) },
                  ]}
                />
              )}
            </QueryState>
          </Panel>
        </div>

        {can('appointment:read') && (
          <Panel title={`Expected today (${notArrived.length})`} flush>
            {notArrived.length === 0 ? (
              <EmptyState title="No appointments waiting for check-in" />
            ) : (
              <ul className="list">
                {notArrived.map((a) => (
                  <li key={a.id} className="list-item row-between">
                    <div style={{ minWidth: 0 }}>
                      <div className="cell-title">
                        {fmtClock(a.startTime)} · {a.patient.fullName}
                      </div>
                      <div className="cell-sub">
                        {doctorName(a.doctor)} · {formatEnum(a.type)}
                      </div>
                    </div>
                    {manage && (
                      <Button size="sm" variant="primary" onClick={() => checkIn.mutate(a.id)}>
                        Check in
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>

      <WalkInModal open={walkIn} onClose={() => setWalkIn(false)} />
      <VitalsModal token={vitalsFor} onClose={() => setVitalsFor(null)} />
      <ConfirmDialog
        open={Boolean(cancelling)}
        title={cancelling ? `Cancel token ${cancelling.number}` : ''}
        message={cancelling?.appointment ? 'The linked appointment will also be cancelled.' : undefined}
        requireReason
        danger
        confirmLabel="Cancel token"
        loading={act.isPending}
        onConfirm={(reason) => act.mutate({ id: cancelling!.id, action: 'cancel', reason })}
        onClose={() => setCancelling(null)}
      />
    </>
  );
}
