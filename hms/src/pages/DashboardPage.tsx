import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  BedDouble,
  CalendarClock,
  FlaskConical,
  Pill,
  Receipt,
  Ticket,
  UserPlus,
  Users,
} from 'lucide-react';
import { addDays, toHospitalDate } from '@hms/shared';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { DataTable, EmptyState, Loading, QueryState, Stat, StatusBadge } from '../components/data';
import { LinkButton, PageHeader, Panel } from '../components/ui';
import { auditLabel } from '../utils/audit-labels';
import { fmtClock, fmtDate, fmtDateTime, fmtTime, money, patientLine } from '../utils/format';
import type { Appointment, QueueData, Token } from '../types';

interface Dashboard {
  date: string;
  modules: { pharmacy: boolean; laboratory: boolean; beds: boolean; ot: boolean };
  appointments?: { total: number; byStatus: Record<string, number> };
  opd?: { scope: 'mine' | 'all'; waiting: number; withDoctor: number; completed: number; skipped: number };
  patientsToday?: { visits: number; newRegistrations: number };
  myDraftConsultations?: number;
  beds?: { total: number; available: number; occupied: number; reserved: number; cleaning: number; maintenance: number };
  billing?: { unpaidInvoices: number; outstanding: number; pendingCharges: number; patientsToBill: number };
  pharmacy?: { lowStock: number; outOfStock: number; expiring: number; expired: number; pendingPrescriptions: number | null };
  laboratory?: { byStatus: Record<string, number>; pending: number };
  recentActivity: { scope: 'all' | 'mine'; items: { _id: string; at: string; userName?: string; action: string }[] };
}

function greeting() {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', timeZone: 'Asia/Kolkata', hour12: false }).format(new Date()));
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function QueuePreview() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const doctor = user?.role === 'doctor' ? user.doctorId : undefined;
  const query = useQuery({
    queryKey: ['queue', { doctor }],
    queryFn: () => api.get<QueueData>('/queue', { doctor }),
  });
  const rows: Token[] = [...(query.data?.withDoctor ?? []), ...(query.data?.waiting ?? [])].slice(0, 8);
  return (
    <Panel
      title={doctor ? 'My queue' : 'OPD queue'}
      flush
      actions={<LinkButton size="sm" to={doctor ? '/consultations' : '/reception'}>Open</LinkButton>}
    >
      <QueryState query={query} empty={{ when: () => rows.length === 0, title: 'No patients waiting' }}>
        {() => (
          <DataTable
            rows={rows}
            rowKey={(t) => t.id}
            onRowClick={() => navigate(doctor ? '/consultations' : '/reception')}
            columns={[
              { key: 'no', header: 'Token', render: (t) => <span className="token-number">{t.number}</span> },
              {
                key: 'patient',
                header: 'Patient',
                render: (t) => (
                  <>
                    <div className="cell-title">{t.patient.fullName}</div>
                    <div className="cell-sub">{patientLine(t.patient)}</div>
                  </>
                ),
              },
              { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} /> },
              { key: 'priority', header: 'Priority', render: (t) => t.priority !== 'routine' && <StatusBadge status={t.priority} /> },
              { key: 'since', header: 'Arrived', render: (t) => <span className="nowrap">{fmtTime(t.checkedInAt)}</span> },
            ]}
          />
        )}
      </QueryState>
    </Panel>
  );
}

function UpcomingAppointments() {
  const today = toHospitalDate();
  const query = useQuery({
    queryKey: ['appointments', { date: today, dashboard: true }],
    queryFn: () => api.page<Appointment>('/appointments', { date: today, limit: 50 }).then((r) => r.data),
  });
  const rows = (query.data ?? []).filter((a) => ['scheduled', 'confirmed'].includes(a.status)).slice(0, 8);
  return (
    <Panel title="Not yet arrived" flush actions={<LinkButton size="sm" to="/appointments">Open</LinkButton>}>
      <QueryState query={query} empty={{ when: () => rows.length === 0, title: 'No pending appointments today' }}>
        {() => (
          <ul className="list">
            {rows.map((a) => (
              <li className="list-item row-between" key={a.id}>
                <div>
                  <div className="cell-title">{a.patient.fullName}</div>
                  <div className="cell-sub">
                    Dr. {a.doctor.user.name} · {a.type.replace('_', ' ')}
                  </div>
                </div>
                <span className="strong nowrap">{fmtClock(a.startTime)}</span>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </Panel>
  );
}

function VisitTrend() {
  const to = toHospitalDate();
  const from = addDays(to, -13);
  const query = useQuery({
    queryKey: ['analytics', from, to],
    queryFn: () =>
      api.get<{ series: { date: string; visits: number; newPatients: number }[] }>('/analytics', { from, to }),
  });
  return (
    <Panel title="OPD visits, last 14 days">
      <QueryState query={query}>
        {(data) => (
          <div style={{ height: 200 }}>
            <ResponsiveContainer>
              <LineChart data={data.series} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#eceded" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(8)} tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={(d) => fmtDate(String(d))} />
                <Line type="monotone" dataKey="visits" name="Visits" stroke="#9b3426" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="newPatients" name="New patients" stroke="#5b616b" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </QueryState>
    </Panel>
  );
}

export default function DashboardPage() {
  const { user, can } = useAuth();
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/dashboard') });

  if (query.isLoading) return <Loading />;
  const d = query.data;
  if (!d || !user) return <EmptyState title="Dashboard unavailable" />;

  const stats = [];
  if (d.appointments) {
    const arrived = (d.appointments.byStatus.checked_in ?? 0) + (d.appointments.byStatus.in_consultation ?? 0) + (d.appointments.byStatus.completed ?? 0);
    stats.push(
      <Stat key="appt" icon={<CalendarClock size={14} />} label="Today's appointments" value={d.appointments.total} note={`${arrived} arrived`} href="/appointments" />,
    );
  }
  if (d.patientsToday) {
    stats.push(
      <Stat key="pt" icon={<Users size={14} />} label="Patients today" value={d.patientsToday.visits} note={`${d.patientsToday.newRegistrations} newly registered`} href="/patients" />,
    );
  }
  if (d.opd) {
    stats.push(
      <Stat
        key="opd"
        icon={<Ticket size={14} />}
        label={d.opd.scope === 'mine' ? 'Waiting for me' : 'Waiting in OPD'}
        value={d.opd.waiting}
        note={`${d.opd.withDoctor} with doctor, ${d.opd.completed} seen`}
        href={d.opd.scope === 'mine' ? '/consultations' : '/reception'}
      />,
    );
  }
  if (d.myDraftConsultations !== undefined) {
    stats.push(
      <Stat
        key="drafts"
        label="Unfinished consultations"
        value={d.myDraftConsultations}
        note={d.myDraftConsultations ? 'Complete them to lock the record' : 'All completed'}
        noteTone={d.myDraftConsultations ? 'warn' : undefined}
        href="/consultations?status=draft"
      />,
    );
  }
  if (d.beds) {
    stats.push(
      <Stat
        key="beds"
        icon={<BedDouble size={14} />}
        label="Beds available"
        value={`${d.beds.available} / ${d.beds.total}`}
        note={`${d.beds.occupied} occupied${d.beds.cleaning ? `, ${d.beds.cleaning} being cleaned` : ''}`}
        href="/beds"
      />,
    );
  }
  if (d.billing) {
    stats.push(
      <Stat
        key="bill"
        icon={<Receipt size={14} />}
        label="Outstanding bills"
        value={money(d.billing.outstanding)}
        note={`${d.billing.unpaidInvoices} invoices, ${d.billing.patientsToBill} patients to bill`}
        noteTone={d.billing.patientsToBill ? 'warn' : undefined}
        href="/billing"
      />,
    );
  }
  if (d.pharmacy) {
    const alerts = d.pharmacy.lowStock + d.pharmacy.outOfStock + d.pharmacy.expiring + d.pharmacy.expired;
    stats.push(
      <Stat
        key="ph"
        icon={<Pill size={14} />}
        label="Pharmacy alerts"
        value={alerts}
        note={
          d.pharmacy.pendingPrescriptions !== null
            ? `${d.pharmacy.pendingPrescriptions} prescriptions to dispense`
            : `${d.pharmacy.outOfStock} out of stock`
        }
        noteTone={d.pharmacy.outOfStock || d.pharmacy.expired ? 'bad' : alerts ? 'warn' : undefined}
        href="/pharmacy"
      />,
    );
  }
  if (d.laboratory) {
    stats.push(
      <Stat
        key="lab"
        icon={<FlaskConical size={14} />}
        label="Lab tests pending"
        value={d.laboratory.pending}
        note={`${d.laboratory.byStatus.verified ?? 0} verified, awaiting release`}
        href="/laboratory"
      />,
    );
  }

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${user.name.split(' ')[0]}`}
        description={fmtDate(d.date)}
        actions={
          <>
            {can('patient:create') && (
              <LinkButton to="/patients/new" icon={<UserPlus size={15} />}>
                Register patient
              </LinkButton>
            )}
            {can('appointment:manage') && (
              <LinkButton to="/appointments?new=1" variant="primary" icon={<CalendarClock size={15} />}>
                Book appointment
              </LinkButton>
            )}
          </>
        }
      />

      {stats.length > 0 && <div className="grid stat-grid">{stats}</div>}

      <div className="grid grid-sidebar">
        <div className="stack">
          {can('queue:read') && <QueuePreview />}
          {can('analytics:read') && <VisitTrend />}
          {can('appointment:read') && user.role !== 'doctor' && !can('queue:read') && <UpcomingAppointments />}
        </div>
        <div className="stack">
          {can('appointment:read') && can('queue:read') && <UpcomingAppointments />}
          <Panel title={d.recentActivity.scope === 'all' ? 'Recent activity' : 'My recent activity'} flush>
            {d.recentActivity.items.length === 0 ? (
              <EmptyState title="No activity yet" />
            ) : (
              <ul className="list">
                {d.recentActivity.items.map((a) => (
                  <li key={a._id} className="list-item">
                    <div>{auditLabel(a.action)}</div>
                    <div className="small subtle">
                      {d.recentActivity.scope === 'all' && a.userName ? `${a.userName} · ` : ''}
                      {fmtDateTime(a.at)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {can('audit:read') && (
              <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)' }}>
                <Link to="/audit" className="small">
                  View audit log
                </Link>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
