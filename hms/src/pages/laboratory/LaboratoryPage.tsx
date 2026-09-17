import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import { LAB_ORDER_STATUSES } from '@hms/shared';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../services/api';
import { DataTable, Pagination, QueryState, StatusBadge } from '../../components/data';
import { PatientPicker } from '../../components/pickers';
import { Button, enumOptions, PageHeader, Panel, Segmented, SelectInput } from '../../components/ui';
import { LabOrderModal } from '../../features/clinical/LabOrderModal';
import { doctorName, fmtDate, fmtTime } from '../../utils/format';
import type { LabOrder, Patient } from '../../types';

export default function LaboratoryPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') ?? 'active';
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 1);
  const [ordering, setOrdering] = useState<Patient | null>(null);
  const [picking, setPicking] = useState(false);

  const query = useQuery({
    queryKey: ['lab', 'orders', { view, status, page }],
    queryFn: () =>
      api.page<LabOrder>('/laboratory/orders', {
        active: view === 'active' && !status ? 'true' : undefined,
        status,
        page,
        limit: 25,
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Laboratory"
        description="Orders move from sample collection to a verified, released report."
        actions={
          can('lab:order') && (
            <Button variant="primary" icon={<FlaskConical size={15} />} onClick={() => setPicking(true)}>
              New lab order
            </Button>
          )
        }
      />
      {picking && !ordering && (
        <Panel title="Select patient for the order" actions={<Button size="sm" onClick={() => setPicking(false)}>Close</Button>}>
          <PatientPicker value={null} onChange={(p) => setOrdering(p)} autoFocus />
        </Panel>
      )}
      <Panel
        flush
        className="no-print"
        title={
          <div className="row">
            <Segmented
              value={view}
              onChange={(v) => setParams({ view: v }, { replace: true })}
              options={[
                { value: 'active', label: 'Worklist' },
                { value: 'all', label: 'All orders' },
              ]}
            />
            {view === 'all' && (
              <div style={{ width: 180 }}>
                <SelectInput
                  aria-label="Status"
                  value={status}
                  placeholder="All statuses"
                  options={enumOptions(LAB_ORDER_STATUSES)}
                  onChange={(e) => setParams({ view, ...(e.target.value ? { status: e.target.value } : {}) }, { replace: true })}
                />
              </div>
            )}
          </div>
        }
      >
        <QueryState
          query={query}
          empty={{ when: (r) => r.data.length === 0, title: view === 'active' ? 'No pending lab work' : 'No lab orders' }}
        >
          {(r) => (
            <>
              <DataTable
                rows={r.data}
                rowKey={(o) => o.id}
                onRowClick={(o) => navigate(`/laboratory/orders/${o.id}`)}
                columns={[
                  { key: 'no', header: 'Order', render: (o) => <span className="mono">{o.orderNumber}</span> },
                  {
                    key: 'when',
                    header: 'Ordered',
                    render: (o) => (
                      <span className="nowrap">
                        {fmtDate(o.date)} {fmtTime(o.createdAt)}
                      </span>
                    ),
                  },
                  {
                    key: 'patient',
                    header: 'Patient',
                    render: (o) => (
                      <>
                        <div className="cell-title">{o.patient.fullName}</div>
                        <div className="cell-sub mono">{o.patient.uhid}</div>
                      </>
                    ),
                  },
                  {
                    key: 'tests',
                    header: 'Tests',
                    render: (o) => (
                      <>
                        {o.items.map((i) => i.testName).join(', ')}
                        <div className="cell-sub">{[...new Set(o.items.map((i) => i.sampleType))].join(', ')}</div>
                      </>
                    ),
                  },
                  { key: 'by', header: 'Ordered by', render: (o) => doctorName(o.doctor) || o.orderedBy?.name },
                  { key: 'priority', header: 'Priority', render: (o) => <StatusBadge status={o.priority} /> },
                  { key: 'status', header: 'Status', render: (o) => <StatusBadge status={o.status} /> },
                ]}
              />
              <Pagination meta={r.meta} onPage={(n) => setParams({ view, ...(status ? { status } : {}), page: String(n) })} />
            </>
          )}
        </QueryState>
      </Panel>
      <LabOrderModal
        open={Boolean(ordering)}
        patientId={ordering?.id ?? ''}
        onClose={() => {
          setOrdering(null);
          setPicking(false);
        }}
      />
    </>
  );
}
