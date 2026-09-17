import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, UserPlus } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useDebounce } from '../../hooks/useDebounce';
import { api } from '../../services/api';
import { DataTable, Pagination, QueryState } from '../../components/data';
import { LinkButton, PageHeader, Panel } from '../../components/ui';
import { fmtDate, formatEnum, patientLine } from '../../utils/format';
import type { Patient } from '../../types';

export default function PatientListPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState(params.get('q') ?? '');
  const q = useDebounce(term.trim(), 300);
  const page = Number(params.get('page') ?? 1);

  const query = useQuery({
    queryKey: ['patients', 'list', q, page],
    queryFn: () => api.page<Patient>('/patients', { q, page, limit: 25 }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Patients"
        description="Every patient has one record, shared by all departments."
        actions={
          can('patient:create') && (
            <LinkButton to="/patients/new" variant="primary" icon={<UserPlus size={15} />}>
              Register patient
            </LinkButton>
          )
        }
      />
      <Panel
        flush
        title={
          <div className="input-group" style={{ width: 'min(420px, 100%)' }}>
            <Search size={15} />
            <input
              className="input"
              type="search"
              aria-label="Search patients"
              placeholder="Search by name, phone number or UHID"
              value={term}
              autoFocus
              onChange={(e) => {
                setTerm(e.target.value);
                setParams(e.target.value ? { q: e.target.value } : {}, { replace: true });
              }}
            />
          </div>
        }
      >
        <QueryState
          query={query}
          empty={{
            when: (r) => r.data.length === 0,
            title: q ? 'No patients match this search' : 'No patients registered yet',
          }}
        >
          {(result) => (
            <>
              <DataTable
                rows={result.data}
                rowKey={(p) => p.id}
                onRowClick={(p) => navigate(`/patients/${p.id}`)}
                columns={[
                  { key: 'uhid', header: 'UHID', render: (p) => <span className="mono">{p.uhid}</span> },
                  { key: 'name', header: 'Name', render: (p) => <span className="cell-title">{p.fullName}</span> },
                  { key: 'demo', header: 'Age / Gender', render: (p) => patientLine(p) },
                  { key: 'phone', header: 'Phone', render: (p) => p.phone },
                  { key: 'blood', header: 'Blood group', render: (p) => (p.bloodGroup && p.bloodGroup !== 'unknown' ? p.bloodGroup : '') },
                  { key: 'reg', header: 'Registered', render: (p) => <span className="nowrap">{fmtDate(p.createdAt)}</span> },
                  { key: 'active', header: '', render: (p) => (p.isActive === false ? formatEnum('inactive') : '') },
                ]}
              />
              <Pagination
                meta={result.meta}
                onPage={(n) => setParams({ ...(q ? { q } : {}), page: String(n) }, { replace: true })}
              />
            </>
          )}
        </QueryState>
      </Panel>
    </>
  );
}
