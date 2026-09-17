import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BedDouble, CalendarPlus, Pencil, Receipt, ShieldAlert, Stethoscope, Ticket } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useAction, useSettings } from '../../hooks/queries';
import { api } from '../../services/api';
import { Badge, EmptyState, ErrorState, Loading } from '../../components/data';
import { ConfirmDialog } from '../../components/overlay';
import { Button, KeyValue, LinkButton, Panel, Tabs } from '../../components/ui';
import { BookAppointmentModal } from '../../features/opd/BookAppointmentModal';
import { WalkInModal } from '../../features/opd/WalkInModal';
import { ageLabel, fmtDate, formatEnum } from '../../utils/format';
import type { Consultation, Patient } from '../../types';
import {
  BillingTab,
  ConsultationsTab,
  DocumentsTab,
  HistoryTab,
  LabTab,
  PrescriptionsTab,
  ReferralsTab,
  TimelineTab,
  VisitsTab,
} from './patient-tabs';

type TabKey =
  | 'overview'
  | 'timeline'
  | 'history'
  | 'visits'
  | 'consultations'
  | 'prescriptions'
  | 'lab'
  | 'referrals'
  | 'billing'
  | 'documents';

export default function PatientProfilePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can, canAny, user } = useAuth();
  const settings = useSettings();
  const [params, setParams] = useSearchParams();
  const [booking, setBooking] = useState(false);
  const [walkIn, setWalkIn] = useState(false);
  const [emergency, setEmergency] = useState(false);

  const query = useQuery({ queryKey: ['patients', id], queryFn: () => api.get<Patient>(`/patients/${id}`) });
  const grant = useAction((reason: string) => api.post(`/patients/${id}/emergency-access`, { reason }), {
    success: 'Emergency access recorded for 12 hours',
    invalidate: [['patients', id]],
    onSuccess: () => setEmergency(false),
  });
  const startConsult = useAction(() => api.post<Consultation>('/consultations', { patient: id }), {
    onSuccess: (c) => navigate(`/consultations/${c.id}`),
  });

  if (query.isLoading) return <Loading />;
  if (query.error || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const p = query.data;
  const clinical = Boolean(p.clinicalAccess);
  const modules = settings.data?.modules;

  const tabs: { key: TabKey; label: string; show: boolean }[] = [
    { key: 'overview', label: 'Overview', show: true },
    { key: 'timeline', label: 'Timeline', show: clinical },
    { key: 'history', label: 'Medical history', show: clinical },
    { key: 'visits', label: 'Visits', show: can('queue:read') },
    { key: 'consultations', label: 'Consultations', show: clinical && can('consultation:read') },
    { key: 'prescriptions', label: 'Prescriptions', show: can('prescription:read') && (clinical || user?.role === 'pharmacist') },
    { key: 'lab', label: 'Lab reports', show: clinical && can('lab:read') && modules?.laboratory !== false },
    { key: 'referrals', label: 'Referrals', show: clinical && can('referral:read') },
    { key: 'billing', label: 'Billing', show: can('billing:read') },
    { key: 'documents', label: 'Documents', show: clinical || canAny('medical:write', 'patient:update') },
  ];
  const visible = tabs.filter((t) => t.show);
  const requested = params.get('tab') as TabKey | null;
  const active: TabKey = visible.some((t) => t.key === requested) ? requested! : 'overview';

  return (
    <>
      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="patient-banner">
          <div>
            <div className="name">{p.fullName}</div>
            <div className="muted">
              <span className="mono">{p.uhid}</span> · {ageLabel(p)} · {formatEnum(p.gender)}
              {p.bloodGroup && p.bloodGroup !== 'unknown' ? ` · ${p.bloodGroup}` : ''} · {p.phone}
            </div>
          </div>
          {p.alerts && (p.alerts.allergies.length > 0 || p.alerts.conditions.length > 0) && (
            <div className="alert-strip">
              {p.alerts.allergies.map((a) => (
                <Badge key={a.id} tone="danger">
                  <AlertTriangle size={12} /> Allergy: {a.title}
                  {a.severity ? ` (${a.severity})` : ''}
                </Badge>
              ))}
              {p.alerts.conditions.map((c) => (
                <Badge key={c.id} tone="warning">
                  {c.title}
                </Badge>
              ))}
            </div>
          )}
          <div className="row" style={{ marginLeft: 'auto' }}>
            {can('patient:update') && (
              <LinkButton to={`/patients/${p.id}/edit`} icon={<Pencil size={14} />}>
                Edit
              </LinkButton>
            )}
            {can('appointment:manage') && (
              <Button icon={<CalendarPlus size={14} />} onClick={() => setBooking(true)}>
                Appointment
              </Button>
            )}
            {can('queue:manage') && user?.role !== 'doctor' && (
              <Button icon={<Ticket size={14} />} onClick={() => setWalkIn(true)}>
                Walk-in token
              </Button>
            )}
            {can('admission:manage') && modules?.beds !== false && (
              <LinkButton to={`/beds?admit=${p.id}`} icon={<BedDouble size={14} />}>
                Admit
              </LinkButton>
            )}
            {can('billing:manage') && (
              <LinkButton to={`/billing/new?patient=${p.id}`} icon={<Receipt size={14} />}>
                Bill
              </LinkButton>
            )}
            {user?.doctorId && clinical && (
              <Button
                variant="primary"
                icon={<Stethoscope size={14} />}
                loading={startConsult.isPending}
                onClick={() => startConsult.mutate(undefined)}
              >
                Consult
              </Button>
            )}
          </div>
        </div>
        <div style={{ padding: '0 16px' }}>
          <Tabs
            tabs={visible}
            active={active}
            onChange={(key) => setParams(key === 'overview' ? {} : { tab: key }, { replace: true })}
          />
        </div>
      </section>

      {can('medical:read') && !clinical && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-body row-between">
            <div className="row">
              <ShieldAlert size={18} color="var(--warning)" />
              <span>
                This patient is not under your care, so the clinical record is hidden. Emergency access is logged and
                lasts 12 hours.
              </span>
            </div>
            <Button variant="danger" onClick={() => setEmergency(true)}>
              Emergency access
            </Button>
          </div>
        </div>
      )}

      {active === 'overview' && (
        <div className="grid grid-2">
          <Panel title="Demographics">
            <KeyValue
              items={[
                ['Date of birth', `${fmtDate(p.dateOfBirth)}${p.dobEstimated ? ' (estimated from age)' : ''}`],
                ['Gender', formatEnum(p.gender)],
                ['Blood group', p.bloodGroup === 'unknown' ? '' : p.bloodGroup],
                ['Marital status', p.maritalStatus === 'unknown' ? '' : formatEnum(p.maritalStatus)],
                ['Occupation', p.occupation],
                ['Guardian', p.guardianName],
                ['Registered', fmtDate(p.createdAt)],
              ]}
            />
          </Panel>
          <Panel title="Contact">
            <KeyValue
              items={[
                ['Mobile', p.phone],
                ['Alternate', p.alternatePhone],
                ['Email', p.email],
                ['Address', [p.address?.line, p.address?.city, p.address?.district, p.address?.state, p.address?.pincode].filter(Boolean).join(', ')],
                [
                  'Emergency contact',
                  p.emergencyContact?.name
                    ? `${p.emergencyContact.name}${p.emergencyContact.relation ? ` (${p.emergencyContact.relation})` : ''}${p.emergencyContact.phone ? `, ${p.emergencyContact.phone}` : ''}`
                    : '',
                ],
                ['Notes', p.notes],
              ]}
            />
          </Panel>
          {!clinical && !can('medical:read') && (
            <div className="span-all">
              <EmptyState title="Clinical information is limited to clinical staff" />
            </div>
          )}
        </div>
      )}
      {active === 'timeline' && <TimelineTab patientId={p.id} />}
      {active === 'history' && <HistoryTab patientId={p.id} />}
      {active === 'visits' && <VisitsTab patientId={p.id} />}
      {active === 'consultations' && <ConsultationsTab patientId={p.id} />}
      {active === 'prescriptions' && <PrescriptionsTab patientId={p.id} />}
      {active === 'lab' && <LabTab patientId={p.id} />}
      {active === 'referrals' && <ReferralsTab patientId={p.id} />}
      {active === 'billing' && <BillingTab patientId={p.id} />}
      {active === 'documents' && <DocumentsTab patientId={p.id} canView={clinical} />}

      <BookAppointmentModal open={booking} onClose={() => setBooking(false)} patient={p} />
      <WalkInModal open={walkIn} onClose={() => setWalkIn(false)} patient={p} />
      <ConfirmDialog
        open={emergency}
        title="Emergency access"
        message="State why you need this record. The reason, your name and the time are stored in the audit log."
        requireReason
        danger
        confirmLabel="Open record"
        loading={grant.isPending}
        onConfirm={(reason) => grant.mutate(reason)}
        onClose={() => setEmergency(false)}
      />
    </>
  );
}
