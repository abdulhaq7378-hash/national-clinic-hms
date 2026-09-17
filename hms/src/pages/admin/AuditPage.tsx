import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { api, downloadFile } from '../../services/api';
import { DataTable, Pagination, QueryState, StatusBadge } from '../../components/data';
import { Modal } from '../../components/overlay';
import { Button, KeyValue, PageHeader, Panel, SelectInput, TextInput } from '../../components/ui';
import { auditLabel } from '../../utils/audit-labels';
import { fmtDateTime, formatEnum } from '../../utils/format';
import type { AuditEntry } from '../../types';

const RESOURCES = [
  'user',
  'patient',
  'medical_history',
  'document',
  'appointment',
  'token',
  'consultation',
  'prescription',
  'referral',
  'charge',
  'invoice',
  'service',
  'medicine',
  'inventory',
  'lab_test',
  'lab_order',
  'ward',
  'bed',
  'admission',
  'ot_booking',
  'settings',
  'report',
];

export default function AuditPage() {
  const toast = useToast();
  const [filters, setFilters] = useState({ action: '', resource: '', outcome: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [exporting, setExporting] = useState(false);

  const actions = useQuery({ queryKey: ['audit', 'actions'], queryFn: () => api.get<string[]>('/audit/actions') });
  const query = useQuery({
    queryKey: ['audit', filters, page],
    queryFn: () => api.page<AuditEntry>('/audit', { ...filters, page, limit: 50 }),
    placeholderData: keepPreviousData,
  });
  const set = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile('/audit/export', filters);
    } catch (err) {
      toast.error(err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Audit logs"
        description="Every sign-in, record change and access to clinical data. Entries cannot be edited or deleted."
        actions={
          <Button icon={<Download size={15} />} loading={exporting} onClick={exportCsv}>
            Export CSV
          </Button>
        }
      />
      <Panel
        flush
        title={
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div style={{ width: 230 }}>
              <SelectInput
                aria-label="Action"
                value={filters.action}
                placeholder="All actions"
                options={(actions.data ?? []).sort().map((a) => ({ value: a, label: auditLabel(a) }))}
                onChange={(e) => set('action', e.target.value)}
              />
            </div>
            <div style={{ width: 170 }}>
              <SelectInput aria-label="Record type" value={filters.resource} placeholder="All records" options={RESOURCES.map((r) => ({ value: r, label: formatEnum(r) }))} onChange={(e) => set('resource', e.target.value)} />
            </div>
            <div style={{ width: 140 }}>
              <SelectInput
                aria-label="Outcome"
                value={filters.outcome}
                placeholder="Any outcome"
                options={[
                  { value: 'success', label: 'Success' },
                  { value: 'failure', label: 'Failure' },
                ]}
                onChange={(e) => set('outcome', e.target.value)}
              />
            </div>
            <TextInput aria-label="From" type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} />
            <TextInput aria-label="To" type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} />
          </div>
        }
      >
        <QueryState query={query} empty={{ when: (r) => r.data.length === 0, title: 'No entries match' }}>
          {(r) => (
            <>
              <DataTable
                rows={r.data}
                rowKey={(a) => a.id}
                onRowClick={setSelected}
                columns={[
                  { key: 'at', header: 'Time', render: (a) => <span className="nowrap">{fmtDateTime(a.at)}</span> },
                  {
                    key: 'user',
                    header: 'User',
                    render: (a) => (
                      <>
                        <div>{a.userName ?? 'System'}</div>
                        {a.role && <div className="cell-sub">{formatEnum(a.role)}</div>}
                      </>
                    ),
                  },
                  {
                    key: 'action',
                    header: 'Action',
                    render: (a) => (
                      <>
                        <div>{auditLabel(a.action)}</div>
                        <div className="cell-sub mono">{a.action}</div>
                      </>
                    ),
                  },
                  { key: 'patient', header: 'Patient', render: (a) => (a.patient ? `${a.patient.fullName} (${a.patient.uhid})` : '') },
                  { key: 'outcome', header: 'Outcome', render: (a) => <StatusBadge status={a.outcome} /> },
                  { key: 'ip', header: 'IP address', render: (a) => <span className="mono small">{a.ip}</span> },
                ]}
              />
              <Pagination meta={r.meta} onPage={setPage} />
            </>
          )}
        </QueryState>
      </Panel>
      <Modal open={Boolean(selected)} title="Audit entry" variant="drawer" onClose={() => setSelected(null)}>
        {selected && (
          <KeyValue
            items={[
              ['Time', fmtDateTime(selected.at)],
              ['User', selected.userName],
              ['Role', selected.role ? formatEnum(selected.role) : ''],
              ['Action', `${auditLabel(selected.action)} (${selected.action})`],
              ['Record', `${formatEnum(selected.resource)}${selected.resourceId ? ` ${selected.resourceId}` : ''}`],
              [
                'Patient',
                selected.patient ? (
                  <Link key="p" to={`/patients/${selected.patient._id}`}>
                    {selected.patient.fullName} ({selected.patient.uhid})
                  </Link>
                ) : (
                  ''
                ),
              ],
              ['Outcome', formatEnum(selected.outcome)],
              ['IP address', selected.ip],
              [
                'Details',
                selected.metadata ? (
                  <pre key="m" className="mono small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                    {JSON.stringify(selected.metadata, null, 2)}
                  </pre>
                ) : (
                  ''
                ),
              ],
            ]}
          />
        )}
      </Modal>
    </>
  );
}
