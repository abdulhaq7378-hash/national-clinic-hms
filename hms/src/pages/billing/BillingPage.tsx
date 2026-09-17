import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FilePlus2, Search } from 'lucide-react';
import { INVOICE_STATUSES } from '@hms/shared';
import { useAuth } from '../../contexts/AuthContext';
import { useDebounce } from '../../hooks/useDebounce';
import { api } from '../../services/api';
import { DataTable, Pagination, QueryState, StatusBadge } from '../../components/data';
import { Button, enumOptions, LinkButton, PageHeader, Panel, SelectInput, Tabs, TextInput } from '../../components/ui';
import { fmtDate, fmtDateTime, money } from '../../utils/format';
import type { Invoice, Patient } from '../../types';

interface PendingRow {
  patient?: Patient;
  count: number;
  amount: number;
  oldest: string;
}

function PendingCharges() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['billing', 'pending'],
    queryFn: () => api.get<PendingRow[]>('/billing/charges/pending-summary'),
  });
  return (
    <QueryState query={query} empty={{ when: (d) => d.length === 0, title: 'Every recorded charge has been billed' }}>
      {(rows) => (
        <DataTable
          rows={rows}
          rowKey={(r) => r.patient?.id ?? r.oldest}
          columns={[
            {
              key: 'patient',
              header: 'Patient',
              render: (r) => (
                <>
                  <div className="cell-title">{r.patient?.fullName}</div>
                  <div className="cell-sub mono">{r.patient?.uhid}</div>
                </>
              ),
            },
            { key: 'count', header: 'Unbilled items', className: 'num', render: (r) => r.count },
            { key: 'amount', header: 'Amount before tax', className: 'num', render: (r) => money(r.amount) },
            { key: 'oldest', header: 'Oldest item', render: (r) => fmtDateTime(r.oldest) },
            {
              key: 'go',
              header: '',
              className: 'right',
              render: (r) =>
                can('billing:manage') &&
                r.patient && (
                  <Button size="sm" variant="primary" onClick={() => navigate(`/billing/new?patient=${r.patient!.id}`)}>
                    Create invoice
                  </Button>
                ),
            },
          ]}
        />
      )}
    </QueryState>
  );
}

function InvoiceList() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const page = Number(params.get('page') ?? 1);
  const [term, setTerm] = useState('');
  const q = useDebounce(term.trim(), 300);
  const query = useQuery({
    queryKey: ['billing', 'invoices', { status, from, to, page, q }],
    queryFn: () => api.page<Invoice>('/billing/invoices', { status, from, to, page, q, limit: 25 }),
    placeholderData: keepPreviousData,
  });
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <>
      <div className="row" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', alignItems: 'flex-end' }}>
        <div className="input-group" style={{ width: 200 }}>
          <Search size={15} />
          <input className="input" placeholder="Invoice number" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <div style={{ width: 170 }}>
          <SelectInput aria-label="Status" value={status} placeholder="All statuses" options={enumOptions(INVOICE_STATUSES)} onChange={(e) => set('status', e.target.value)} />
        </div>
        <TextInput aria-label="From" type="date" value={from} onChange={(e) => set('from', e.target.value)} />
        <TextInput aria-label="To" type="date" value={to} onChange={(e) => set('to', e.target.value)} />
      </div>
      <QueryState query={query} empty={{ when: (r) => r.data.length === 0, title: 'No invoices found' }}>
        {(r) => (
          <>
            <DataTable
              rows={r.data}
              rowKey={(i) => i.id}
              onRowClick={(i) => navigate(`/billing/invoices/${i.id}`)}
              columns={[
                { key: 'no', header: 'Invoice', render: (i) => <span className="mono">{i.invoiceNumber}</span> },
                { key: 'date', header: 'Date', render: (i) => <span className="nowrap">{fmtDate(i.date)}</span> },
                {
                  key: 'patient',
                  header: 'Patient',
                  render: (i) => (
                    <>
                      <div className="cell-title">{i.patient.fullName}</div>
                      <div className="cell-sub mono">{i.patient.uhid}</div>
                    </>
                  ),
                },
                { key: 'total', header: 'Total', className: 'num', render: (i) => money(i.total) },
                { key: 'paid', header: 'Paid', className: 'num', render: (i) => money(i.amountPaid - i.amountRefunded) },
                { key: 'balance', header: 'Balance', className: 'num', render: (i) => money(i.balance) },
                { key: 'status', header: 'Status', render: (i) => <StatusBadge status={i.status} /> },
              ]}
            />
            <Pagination meta={r.meta} onPage={(n) => set('page', String(n))} />
          </>
        )}
      </QueryState>
    </>
  );
}

export default function BillingPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'invoices' | 'pending') ?? 'pending';
  return (
    <>
      <PageHeader
        title="Billing"
        description="Consultation, pharmacy, laboratory and room charges arrive here automatically."
        actions={
          can('billing:manage') && (
            <LinkButton to="/billing/new" variant="primary" icon={<FilePlus2 size={15} />}>
              New invoice
            </LinkButton>
          )
        }
      />
      <Panel flush>
        <div style={{ padding: '0 16px' }}>
          <Tabs
            active={tab}
            onChange={(k) => setParams({ tab: k }, { replace: true })}
            tabs={[
              { key: 'pending', label: 'Patients to bill' },
              { key: 'invoices', label: 'Invoices' },
            ]}
          />
        </div>
        {tab === 'pending' ? <PendingCharges /> : <InvoiceList />}
      </Panel>
    </>
  );
}
