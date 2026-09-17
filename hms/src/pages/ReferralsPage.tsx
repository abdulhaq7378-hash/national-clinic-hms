import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { PRIORITIES, REFERRAL_STATUSES, REFERRAL_TRANSITIONS, type ReferralStatus } from '@hms/shared';
import { useAuth } from '../contexts/AuthContext';
import { useAction } from '../hooks/queries';
import { api } from '../services/api';
import { DataTable, Loading, Pagination, QueryState, StatusBadge } from '../components/data';
import { Modal } from '../components/overlay';
import { Button, enumOptions, KeyValue, PageHeader, Panel, SelectInput, TextInput } from '../components/ui';
import { doctorName, fmtDate, fmtDateTime, formatEnum } from '../utils/format';
import type { Referral } from '../types';

function ReferralDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can } = useAuth();
  const [note, setNote] = useState('');
  const query = useQuery({
    queryKey: ['referrals', id],
    queryFn: () => api.get<Referral>(`/referrals/${id}`),
    enabled: Boolean(id),
  });
  const update = useAction(
    (status: ReferralStatus) => api.post<Referral>(`/referrals/${id}/status`, { status, note }),
    { success: 'Referral updated', invalidate: [['referrals']], onSuccess: () => setNote('') },
  );
  const r = query.data;
  const next = r ? REFERRAL_TRANSITIONS[r.status as ReferralStatus] : [];

  return (
    <Modal open={Boolean(id)} variant="drawer" title={r ? `Referral ${r.number}` : 'Referral'} onClose={onClose}>
      {!r ? (
        <Loading />
      ) : (
        <div className="stack">
          <KeyValue
            items={[
              ['Patient', <Link key="p" to={`/patients/${r.patient.id ?? r.patient._id}`}>{r.patient.fullName} ({r.patient.uhid})</Link>],
              ['Status', <StatusBadge key="s" status={r.status} />],
              ['Priority', <StatusBadge key="pr" status={r.priority} />],
              ['Specialty', r.specialty],
              ['Referred to', r.referredToDoctor],
              ['Hospital', r.hospital],
              ['Referral date', fmtDate(r.referralDate)],
              ['Referred by', doctorName(r.referringDoctor)],
              ['Reason', r.reason],
              ...(r.clinicalNotes !== undefined ? ([['Clinical notes', r.clinicalNotes]] as [string, string][]) : []),
              ...(r.consultation?.diagnoses?.length
                ? ([['Diagnosis', r.consultation.diagnoses.map((d) => d.description).join(', ')]] as [string, string][])
                : []),
            ]}
          />
          {can('referral:write') && next.length > 0 && (
            <div className="panel">
              <div className="panel-body stack-sm">
                <TextInput label="Note (required to cancel)" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="row">
                  {next.map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={s === 'cancelled' ? 'danger' : 'primary'}
                      disabled={s === 'cancelled' && !note.trim()}
                      loading={update.isPending && update.variables === s}
                      onClick={() => update.mutate(s)}
                    >
                      Mark {formatEnum(s).toLowerCase()}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div>
            <h3 style={{ marginBottom: 6 }}>History</h3>
            <ul className="list">
              {r.statusHistory?.map((h, i) => (
                <li key={i} className="list-item">
                  <StatusBadge status={h.status} /> <span className="small muted">{fmtDateTime(h.at)} · {h.by?.name}</span>
                  {h.note && <div className="small">{h.note}</div>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function ReferralsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const priority = params.get('priority') ?? '';
  const page = Number(params.get('page') ?? 1);
  const [selected, setSelected] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['referrals', { status, priority, page }],
    queryFn: () => api.page<Referral>('/referrals', { status, priority, page, limit: 25 }),
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
      <PageHeader title="Referrals" description="Referrals are created from a consultation and tracked here until completed." />
      <Panel
        flush
        title={
          <div className="row">
            <div style={{ width: 170 }}>
              <SelectInput aria-label="Status" value={status} placeholder="All statuses" options={enumOptions(REFERRAL_STATUSES)} onChange={(e) => set('status', e.target.value)} />
            </div>
            <div style={{ width: 170 }}>
              <SelectInput aria-label="Priority" value={priority} placeholder="All priorities" options={enumOptions(PRIORITIES)} onChange={(e) => set('priority', e.target.value)} />
            </div>
          </div>
        }
      >
        <QueryState query={query} empty={{ when: (r) => r.data.length === 0, title: 'No referrals found' }}>
          {(r) => (
            <>
              <DataTable
                rows={r.data}
                rowKey={(x) => x.id}
                onRowClick={(x) => setSelected(x.id)}
                columns={[
                  { key: 'no', header: 'Number', render: (x) => <span className="mono">{x.number}</span> },
                  { key: 'date', header: 'Date', render: (x) => fmtDate(x.referralDate) },
                  { key: 'patient', header: 'Patient', render: (x) => x.patient.fullName },
                  { key: 'spec', header: 'Specialty', render: (x) => x.specialty },
                  { key: 'to', header: 'Referred to', render: (x) => [x.referredToDoctor, x.hospital].filter(Boolean).join(', ') },
                  { key: 'by', header: 'Referred by', render: (x) => doctorName(x.referringDoctor) },
                  { key: 'priority', header: 'Priority', render: (x) => <StatusBadge status={x.priority} /> },
                  { key: 'status', header: 'Status', render: (x) => <StatusBadge status={x.status} /> },
                ]}
              />
              <Pagination meta={r.meta} onPage={(n) => { const next = new URLSearchParams(params); next.set('page', String(n)); setParams(next); }} />
            </>
          )}
        </QueryState>
      </Panel>
      <ReferralDetail id={selected} onClose={() => setSelected(null)} />
    </>
  );
}
