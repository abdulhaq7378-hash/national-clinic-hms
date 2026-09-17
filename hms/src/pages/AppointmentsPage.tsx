import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { APPOINTMENT_STATUSES, addDays, toHospitalDate } from '@hms/shared';
import { useAuth } from '../contexts/AuthContext';
import { useAction } from '../hooks/queries';
import { api } from '../services/api';
import { DataTable, QueryState, StatusBadge } from '../components/data';
import { ConfirmDialog } from '../components/overlay';
import { DoctorSelect } from '../components/pickers';
import { Button, enumOptions, PageHeader, Panel, SelectInput, TextInput } from '../components/ui';
import { BookAppointmentModal } from '../features/opd/BookAppointmentModal';
import { doctorName, fmtClock, fmtDate, formatEnum, patientLine } from '../utils/format';
import type { Appointment } from '../types';

type Pending = { appointment: Appointment; status: 'cancelled' | 'no_show' } | null;

function RowActions({
  a,
  onReschedule,
  onStatus,
}: {
  a: Appointment;
  onReschedule: () => void;
  onStatus: (status: 'cancelled' | 'no_show') => void;
}) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const today = toHospitalDate();
  const confirm = useAction(() => api.post(`/appointments/${a.id}/status`, { status: 'confirmed' }), {
    success: 'Appointment confirmed',
    invalidate: [['appointments']],
  });
  const checkIn = useAction(() => api.post<{ number: number }>('/queue/check-in', { appointment: a.id }), {
    success: (t) => `Checked in. Token ${t.number}`,
    invalidate: [['appointments'], ['queue'], ['dashboard']],
  });

  if (!can('appointment:manage')) return null;
  const open_ = ['scheduled', 'confirmed'].includes(a.status);
  if (!open_) return null;

  return (
    <div className="row nowrap" style={{ justifyContent: 'flex-end' }}>
      {a.date === today && can('queue:manage') && (
        <Button size="sm" variant="primary" loading={checkIn.isPending} onClick={() => checkIn.mutate(undefined)}>
          Check in
        </Button>
      )}
      <div className="dropdown">
        <Button size="sm" iconOnly aria-label="More actions" icon={<MoreHorizontal size={14} />} onClick={() => setOpen((v) => !v)} />
        {open && (
          <div className="dropdown-menu" onMouseLeave={() => setOpen(false)}>
            {a.status === 'scheduled' && (
              <button className="dropdown-item" onClick={() => { setOpen(false); confirm.mutate(undefined); }}>
                Mark confirmed
              </button>
            )}
            <button className="dropdown-item" onClick={() => { setOpen(false); onReschedule(); }}>
              Reschedule
            </button>
            {a.date <= today && (
              <button className="dropdown-item" onClick={() => { setOpen(false); onStatus('no_show'); }}>
                Mark no-show
              </button>
            )}
            <button className="dropdown-item danger-text" onClick={() => { setOpen(false); onStatus('cancelled'); }}>
              Cancel appointment
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AppointmentsPage() {
  const { can, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? toHospitalDate();
  const doctor = params.get('doctor') ?? (user?.role === 'doctor' ? user.doctorId ?? '' : '');
  const status = params.get('status') ?? '';
  const [booking, setBooking] = useState(false);
  const [rescheduling, setRescheduling] = useState<Appointment | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  useEffect(() => {
    if (params.get('new') === '1') {
      setBooking(true);
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const query = useQuery({
    queryKey: ['appointments', { date, doctor, status }],
    queryFn: () => api.page<Appointment>('/appointments', { date, doctor, status, limit: 200 }).then((r) => r.data),
  });
  const changeStatus = useAction(
    (reason: string) => api.post(`/appointments/${pending!.appointment.id}/status`, { status: pending!.status, reason }),
    { success: 'Appointment updated', invalidate: [['appointments'], ['dashboard']], onSuccess: () => setPending(null) },
  );

  const counts = (query.data ?? []).reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Appointments"
        description={fmtDate(date)}
        actions={
          can('appointment:manage') && (
            <Button variant="primary" icon={<CalendarPlus size={15} />} onClick={() => setBooking(true)}>
              Book appointment
            </Button>
          )
        }
      />
      <Panel
        flush
        title={
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Button iconOnly aria-label="Previous day" icon={<ChevronLeft size={16} />} onClick={() => update('date', addDays(date, -1))} />
            <TextInput aria-label="Date" type="date" value={date} onChange={(e) => update('date', e.target.value)} />
            <Button iconOnly aria-label="Next day" icon={<ChevronRight size={16} />} onClick={() => update('date', addDays(date, 1))} />
            <Button onClick={() => update('date', '')}>Today</Button>
            <div style={{ minWidth: 220 }}>
              <DoctorSelect label="" value={doctor} onChange={(v) => update('doctor', v)} allowAll />
            </div>
            <div style={{ minWidth: 160 }}>
              <SelectInput
                aria-label="Status"
                value={status}
                placeholder="All statuses"
                options={enumOptions(APPOINTMENT_STATUSES)}
                onChange={(e) => update('status', e.target.value)}
              />
            </div>
          </div>
        }
      >
        {Object.keys(counts).length > 0 && (
          <div className="row small muted" style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
            {Object.entries(counts).map(([s, n]) => (
              <span key={s}>
                {formatEnum(s)}: <strong>{n}</strong>
              </span>
            ))}
          </div>
        )}
        <QueryState query={query} empty={{ when: (d) => d.length === 0, title: 'No appointments for this day' }}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(a) => a.id}
              columns={[
                { key: 'time', header: 'Time', render: (a) => <span className="strong nowrap">{fmtClock(a.startTime)}</span> },
                {
                  key: 'patient',
                  header: 'Patient',
                  render: (a) => (
                    <>
                      <Link to={`/patients/${a.patient.id ?? a.patient._id}`} className="cell-title">
                        {a.patient.fullName}
                      </Link>
                      <div className="cell-sub">
                        <span className="mono">{a.patient.uhid}</span> · {patientLine(a.patient)} · {a.patient.phone}
                      </div>
                    </>
                  ),
                },
                { key: 'doctor', header: 'Doctor', render: (a) => doctorName(a.doctor) },
                { key: 'type', header: 'Type', render: (a) => formatEnum(a.type) },
                { key: 'source', header: 'Source', render: (a) => formatEnum(a.source) },
                {
                  key: 'status',
                  header: 'Status',
                  render: (a) => (
                    <>
                      <StatusBadge status={a.status} />
                      {a.notes && <div className="cell-sub">{a.notes}</div>}
                    </>
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  className: 'right',
                  render: (a) => (
                    <RowActions
                      a={a}
                      onReschedule={() => setRescheduling(a)}
                      onStatus={(s) => setPending({ appointment: a, status: s })}
                    />
                  ),
                },
              ]}
            />
          )}
        </QueryState>
      </Panel>

      <BookAppointmentModal
        open={booking}
        onClose={() => setBooking(false)}
        defaultDate={date}
        defaultDoctor={doctor}
        onBooked={(a) => update('date', a.date)}
      />
      <BookAppointmentModal open={Boolean(rescheduling)} appointment={rescheduling} onClose={() => setRescheduling(null)} />
      <ConfirmDialog
        open={Boolean(pending)}
        title={pending?.status === 'cancelled' ? 'Cancel appointment' : 'Mark as no-show'}
        message={pending && `${pending.appointment.patient.fullName}, ${fmtDate(pending.appointment.date)} at ${fmtClock(pending.appointment.startTime)}`}
        requireReason={pending?.status === 'cancelled'}
        danger
        confirmLabel={pending?.status === 'cancelled' ? 'Cancel appointment' : 'Mark no-show'}
        loading={changeStatus.isPending}
        onConfirm={(reason) => changeStatus.mutate(reason)}
        onClose={() => setPending(null)}
      />
    </>
  );
}
