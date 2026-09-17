import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useDebounce } from '../../hooks/useDebounce';
import { api } from '../../services/api';
import { DataTable, Pagination, QueryState, StatusBadge } from '../../components/data';
import { Button, PageHeader, Panel, Segmented } from '../../components/ui';
import { doctorName, fmtDate } from '../../utils/format';
import type { Prescription } from '../../types';

export default function PrescriptionsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') ?? (can('pharmacy:dispense') ? 'pending' : 'all');
  const page = Number(params.get('page') ?? 1);
  const [term, setTerm] = useState('');
  const q = useDebounce(term.trim(), 300);

  const query = useQuery({
    queryKey: ['prescriptions', { view, page, q }],
    queryFn: () =>
      api.page<Prescription>('/prescriptions', {
        pending: view === 'pending' ? 'true' : undefined,
        q,
        page,
        limit: 25,
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Prescriptions"
        description={can('pharmacy:dispense') ? 'Prescriptions waiting at the pharmacy appear first.' : undefined}
      />
      <Panel
        flush
        title={
          <div className="row">
            <Segmented
              value={view}
              onChange={(v) => setParams({ view: v }, { replace: true })}
              options={[
                { value: 'pending', label: 'To dispense' },
                { value: 'all', label: 'All' },
              ]}
            />
            <div className="input-group" style={{ width: 220 }}>
              <Search size={15} />
              <input className="input" placeholder="Prescription number" value={term} onChange={(e) => setTerm(e.target.value)} />
            </div>
          </div>
        }
      >
        <QueryState
          query={query}
          empty={{ when: (r) => r.data.length === 0, title: view === 'pending' ? 'Nothing waiting to be dispensed' : 'No prescriptions' }}
        >
          {(r) => (
            <>
              <DataTable
                rows={r.data}
                rowKey={(p) => p.id}
                onRowClick={(p) => navigate(`/prescriptions/${p.id}/print`)}
                columns={[
                  { key: 'no', header: 'Number', render: (p) => <span className="mono">{p.number}</span> },
                  { key: 'date', header: 'Date', render: (p) => <span className="nowrap">{fmtDate(p.date)}</span> },
                  {
                    key: 'patient',
                    header: 'Patient',
                    render: (p) => (
                      <>
                        <div className="cell-title">{p.patient.fullName}</div>
                        <div className="cell-sub mono">{p.patient.uhid}</div>
                      </>
                    ),
                  },
                  { key: 'doctor', header: 'Doctor', render: (p) => doctorName(p.doctor) },
                  {
                    key: 'items',
                    header: 'Medicines',
                    render: (p) => (
                      <span className="small">
                        {p.items.map((i) => `${i.medicineName}${i.quantity ? ` × ${i.quantity}` : ''}`).join(', ')}
                      </span>
                    ),
                  },
                  { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
                  {
                    key: 'go',
                    header: '',
                    className: 'right',
                    render: (p) =>
                      can('pharmacy:dispense') &&
                      ['active', 'partially_dispensed'].includes(p.status) && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/pharmacy/dispense?prescription=${p.id}`);
                          }}
                        >
                          Dispense
                        </Button>
                      ),
                  },
                ]}
              />
              <Pagination meta={r.meta} onPage={(n) => setParams({ view, page: String(n) })} />
            </>
          )}
        </QueryState>
      </Panel>
    </>
  );
}
