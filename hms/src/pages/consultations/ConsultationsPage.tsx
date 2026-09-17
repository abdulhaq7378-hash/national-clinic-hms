import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Stethoscope } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useAction } from '../../hooks/queries';
import { api } from '../../services/api';
import { DataTable, Pagination, QueryState, StatusBadge } from '../../components/data';
import { Button, PageHeader, Panel, Segmented } from '../../components/ui';
import { doctorName, fmtClock, fmtDate, fmtTime, patientLine, vitalsSummary } from '../../utils/format';
import type { Consultation, QueueData, Token } from '../../types';

function MyQueue({ doctorId }: { doctorId: string }) {
  const navigate = useNavigate();
  const queue = useQuery({
    queryKey: ['queue', { doctor: doctorId }],
    queryFn: () => api.get<QueueData>('/queue', { doctor: doctorId }),
  });
  const start = useAction((token: string) => api.post<Consultation>('/consultations', { token }), {
    invalidate: [['queue']],
    onSuccess: (c) => navigate(`/consultations/${c.id}`),
  });
  const rows: Token[] = [...(queue.data?.withDoctor ?? []), ...(queue.data?.waiting ?? [])];

  return (
    <Panel title={`My queue today (${rows.length})`} flush>
      <QueryState query={queue} empty={{ when: () => rows.length === 0, title: 'No patients waiting for you' }}>
        {() => (
          <DataTable
            rows={rows}
            rowKey={(t) => t.id}
            columns={[
              { key: 'no', header: 'Token', render: (t) => <span className="token-number">{t.number}</span> },
              {
                key: 'patient',
                header: 'Patient',
                render: (t) => (
                  <>
                    <div className="cell-title">{t.patient.fullName}</div>
                    <div className="cell-sub">
                      <span className="mono">{t.patient.uhid}</span> · {patientLine(t.patient)}
                    </div>
                    {t.vitals && <div className="cell-sub">{vitalsSummary(t.vitals as Record<string, number>)}</div>}
                  </>
                ),
              },
              {
                key: 'visit',
                header: 'Visit',
                render: (t) => (
                  <>
                    <div>{t.appointment ? `Appointment ${fmtClock(t.appointment.startTime)}` : 'Walk-in'}</div>
                    {t.notes && <div className="cell-sub">{t.notes}</div>}
                  </>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (t) => (
                  <>
                    <StatusBadge status={t.status} />
                    {t.priority !== 'routine' && <StatusBadge status={t.priority} />}
                    <div className="cell-sub">Arrived {fmtTime(t.checkedInAt)}</div>
                  </>
                ),
              },
              {
                key: 'go',
                header: '',
                className: 'right',
                render: (t) => (
                  <Button
                    size="sm"
                    variant={t.status === 'with_doctor' ? 'primary' : 'default'}
                    icon={<Stethoscope size={13} />}
                    loading={start.isPending && start.variables === t.id}
                    onClick={() => start.mutate(t.id)}
                  >
                    {t.consultation ? 'Continue' : t.status === 'with_doctor' ? 'Start' : 'Call in and start'}
                  </Button>
                ),
              },
            ]}
          />
        )}
      </QueryState>
    </Panel>
  );
}

export default function ConsultationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 1);

  const list = useQuery({
    queryKey: ['consultations', { status, page }],
    queryFn: () => api.page<Consultation>('/consultations', { status, page, limit: 25 }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Consultations"
        description={user?.role === 'doctor' ? 'Your queue and recent consultations' : 'Consultations recorded by doctors'}
      />
      <div className="stack">
        {user?.doctorId && <MyQueue doctorId={user.doctorId} />}
        <Panel
          flush
          title={user?.role === 'doctor' ? 'My consultations' : 'All consultations'}
          actions={
            <Segmented
              value={status}
              onChange={(v) => setParams(v ? { status: v } : {}, { replace: true })}
              options={[
                { value: '', label: 'All' },
                { value: 'draft', label: 'Open drafts' },
                { value: 'completed', label: 'Completed' },
              ]}
            />
          }
        >
          <QueryState query={list} empty={{ when: (r) => r.data.length === 0, title: 'No consultations found' }}>
            {(r) => (
              <>
                <DataTable
                  rows={r.data}
                  rowKey={(c) => c.id}
                  onRowClick={(c) => navigate(`/consultations/${c.id}`)}
                  columns={[
                    { key: 'date', header: 'Date', render: (c) => <span className="nowrap">{fmtDate(c.date)}</span> },
                    {
                      key: 'patient',
                      header: 'Patient',
                      render: (c) => (
                        <>
                          <div className="cell-title">{c.patient.fullName}</div>
                          <div className="cell-sub mono">{c.patient.uhid}</div>
                        </>
                      ),
                    },
                    { key: 'doctor', header: 'Doctor', render: (c) => doctorName(c.doctor) },
                    { key: 'cc', header: 'Chief complaint', render: (c) => c.chiefComplaint },
                    { key: 'dx', header: 'Diagnosis', render: (c) => c.diagnoses.map((d) => d.description).join(', ') },
                    { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
                  ]}
                />
                <Pagination meta={r.meta} onPage={(n) => setParams({ ...(status ? { status } : {}), page: String(n) })} />
              </>
            )}
          </QueryState>
        </Panel>
      </div>
    </>
  );
}
