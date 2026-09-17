import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileUp } from 'lucide-react';
import { MEDICAL_HISTORY_TYPES } from '@hms/shared';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useAction } from '../../hooks/queries';
import { api, errorMessage, openFile, request } from '../../services/api';
import { DataTable, EmptyState, QueryState, StatusBadge } from '../../components/data';
import { ConfirmDialog, Modal } from '../../components/overlay';
import { Button, enumOptions, Panel, SelectInput, TextArea, TextInput } from '../../components/ui';
import { doctorName, fmtDate, fmtDateTime, formatEnum, money } from '../../utils/format';
import type {
  Consultation,
  HistoryEntry,
  Invoice,
  LabOrder,
  Prescription,
  Referral,
  TimelineEvent,
  Token,
} from '../../types';

const KIND_LINKS: Record<string, (id: string) => string> = {
  consultation: (id) => `/consultations/${id}`,
  prescription: (id) => `/prescriptions/${id}/print`,
  lab: (id) => `/laboratory/orders/${id}`,
  admission: (id) => `/beds/admissions/${id}`,
  discharge: (id) => `/beds/admissions/${id}`,
  invoice: (id) => `/billing/invoices/${id}`,
};

export function TimelineTab({ patientId }: { patientId: string }) {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['patients', patientId, 'timeline'],
    queryFn: () => api.get<TimelineEvent[]>(`/patients/${patientId}/timeline`),
  });
  return (
    <Panel title="Timeline" flush>
      <QueryState query={query} empty={{ when: (d) => d.length === 0, title: 'Nothing recorded yet' }}>
        {(events) => (
          <ul className="timeline" style={{ padding: 16 }}>
            {events.map((e, i) => {
              const link = KIND_LINKS[e.kind]?.(e.refId);
              return (
                <li key={`${e.refId}-${e.kind}-${i}`} className="timeline-item">
                  <div className="timeline-date">
                    {fmtDateTime(e.at)} · {formatEnum(e.kind)}
                    {e.by ? ` · ${e.by}` : ''}
                  </div>
                  <div className="row">
                    {link ? (
                      <a
                        href={link}
                        onClick={(ev) => {
                          ev.preventDefault();
                          navigate(link);
                        }}
                        className="strong"
                      >
                        {e.title}
                      </a>
                    ) : (
                      <span className="strong">{e.title}</span>
                    )}
                    <StatusBadge status={e.status} />
                  </div>
                  {e.detail && <div className="small muted">{e.detail}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </Panel>
  );
}

export function HistoryTab({ patientId }: { patientId: string }) {
  const { can } = useAuth();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ type: 'condition', title: '', details: '', severity: '', onsetDate: '' });
  const [amending, setAmending] = useState<{ entry: HistoryEntry; status: 'resolved' | 'entered_in_error' } | null>(null);
  const query = useQuery({
    queryKey: ['patients', patientId, 'history'],
    queryFn: () => api.get<HistoryEntry[]>(`/patients/${patientId}/history`),
  });
  const add = useAction(
    () =>
      api.post(`/patients/${patientId}/history`, {
        ...form,
        severity: form.type === 'allergy' && form.severity ? form.severity : null,
      }),
    {
      success: 'History entry added',
      invalidate: [['patients', patientId]],
      onSuccess: () => {
        setAdding(false);
        setForm({ type: 'condition', title: '', details: '', severity: '', onsetDate: '' });
      },
    },
  );
  const amend = useAction(
    (reason: string) =>
      api.post(`/patients/${patientId}/history/${amending!.entry.id}/amend`, { status: amending!.status, reason }),
    { success: 'Entry updated', invalidate: [['patients', patientId]], onSuccess: () => setAmending(null) },
  );

  return (
    <Panel
      title="Medical history"
      flush
      actions={
        can('medical:write') && (
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            Add entry
          </Button>
        )
      }
    >
      <QueryState query={query} empty={{ when: (d) => d.length === 0, title: 'No history recorded' }}>
        {(rows) => (
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            columns={[
              { key: 'type', header: 'Type', render: (r) => formatEnum(r.type) },
              {
                key: 'title',
                header: 'Entry',
                render: (r) => (
                  <>
                    <div className="cell-title" style={r.status === 'entered_in_error' ? { textDecoration: 'line-through' } : undefined}>
                      {r.title}
                      {r.severity ? ` (${r.severity})` : ''}
                    </div>
                    {r.details && <div className="cell-sub">{r.details}</div>}
                    {r.amendments?.map((a, i) => (
                      <div key={i} className="cell-sub">
                        {formatEnum(a.status)} by {a.by?.name} on {fmtDate(a.at)}: {a.reason}
                      </div>
                    ))}
                  </>
                ),
              },
              { key: 'onset', header: 'Since', render: (r) => fmtDate(r.onsetDate) },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              {
                key: 'by',
                header: 'Recorded',
                render: (r) => (
                  <span className="small">
                    {r.recordedBy?.name}
                    <br />
                    {fmtDate(r.createdAt)}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: '',
                render: (r) =>
                  can('medical:write') &&
                  r.status === 'active' && (
                    <div className="row">
                      <Button size="sm" onClick={() => setAmending({ entry: r, status: 'resolved' })}>
                        Resolve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAmending({ entry: r, status: 'entered_in_error' })}>
                        Entered in error
                      </Button>
                    </div>
                  ),
              },
            ]}
          />
        )}
      </QueryState>

      <Modal
        open={adding}
        title="Add history entry"
        onClose={() => setAdding(false)}
        onSubmit={() => form.title.trim() && add.mutate(undefined)}
        footer={
          <>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={add.isPending} disabled={!form.title.trim()}>
              Save
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <SelectInput
            label="Type"
            value={form.type}
            options={enumOptions(MEDICAL_HISTORY_TYPES)}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          />
          {form.type === 'allergy' ? (
            <SelectInput
              label="Severity"
              value={form.severity}
              placeholder="Not specified"
              options={enumOptions(['mild', 'moderate', 'severe'])}
              onChange={(e) => setForm({ ...form, severity: e.target.value })}
            />
          ) : (
            <TextInput label="Since" type="date" value={form.onsetDate} onChange={(e) => setForm({ ...form, onsetDate: e.target.value })} />
          )}
          <TextInput
            label={form.type === 'allergy' ? 'Allergen' : 'Title'}
            required
            fieldClassName="span-all"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <TextArea label="Details" fieldClassName="span-all" rows={3} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} />
        </div>
      </Modal>
      <ConfirmDialog
        open={Boolean(amending)}
        title={amending?.status === 'resolved' ? 'Mark as resolved' : 'Mark as entered in error'}
        message="The original entry is kept on record together with this change."
        requireReason
        loading={amend.isPending}
        onConfirm={(reason) => amend.mutate(reason)}
        onClose={() => setAmending(null)}
      />
    </Panel>
  );
}

export function VisitsTab({ patientId }: { patientId: string }) {
  const query = useQuery({
    queryKey: ['patients', patientId, 'visits'],
    queryFn: () => api.get<Token[]>(`/patients/${patientId}/visits`),
  });
  return (
    <Panel title="OPD visits" flush>
      <QueryState query={query} empty={{ when: (d) => d.length === 0, title: 'No visits yet' }}>
        {(rows) => (
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            columns={[
              { key: 'date', header: 'Date', render: (r) => fmtDate(r.date) },
              { key: 'token', header: 'Token', render: (r) => <span className="token-number">{r.number}</span> },
              { key: 'doctor', header: 'Doctor', render: (r) => doctorName(r.doctor) },
              { key: 'type', header: 'Visit', render: (r) => formatEnum(r.visitType) },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
        )}
      </QueryState>
    </Panel>
  );
}

export function ConsultationsTab({ patientId }: { patientId: string }) {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['consultations', { patient: patientId }],
    queryFn: () => api.page<Consultation>('/consultations', { patient: patientId, limit: 100 }).then((r) => r.data),
  });
  return (
    <Panel title="Consultations and diagnoses" flush>
      <QueryState query={query} empty={{ when: (d) => d.length === 0, title: 'No consultations yet' }}>
        {(rows) => (
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/consultations/${r.id}`)}
            columns={[
              { key: 'date', header: 'Date', render: (r) => fmtDate(r.date) },
              { key: 'doctor', header: 'Doctor', render: (r) => doctorName(r.doctor) },
              { key: 'complaint', header: 'Chief complaint', render: (r) => r.chiefComplaint },
              {
                key: 'dx',
                header: 'Diagnoses',
                render: (r) => r.diagnoses.map((d) => `${d.description}${d.type === 'provisional' ? ' (provisional)' : ''}`).join(', '),
              },
              { key: 'fu', header: 'Follow-up', render: (r) => fmtDate(r.followUpDate) },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
        )}
      </QueryState>
    </Panel>
  );
}

export function PrescriptionsTab({ patientId }: { patientId: string }) {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['prescriptions', { patient: patientId }],
    queryFn: () => api.page<Prescription>('/prescriptions', { patient: patientId, limit: 100 }).then((r) => r.data),
  });
  return (
    <Panel title="Prescriptions" flush>
      <QueryState query={query} empty={{ when: (d) => d.length === 0, title: 'No prescriptions yet' }}>
        {(rows) => (
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/prescriptions/${r.id}/print`)}
            columns={[
              { key: 'no', header: 'Number', render: (r) => <span className="mono">{r.number}</span> },
              { key: 'date', header: 'Date', render: (r) => fmtDate(r.date) },
              { key: 'doctor', header: 'Doctor', render: (r) => doctorName(r.doctor) },
              {
                key: 'items',
                header: 'Medicines',
                render: (r) => r.items.map((i) => `${i.medicineName} ${i.strength ?? ''} ${i.frequency}`.trim()).join('; '),
              },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
        )}
      </QueryState>
    </Panel>
  );
}

export function LabTab({ patientId }: { patientId: string }) {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['lab', 'orders', { patient: patientId }],
    queryFn: () => api.page<LabOrder>('/laboratory/orders', { patient: patientId, limit: 100 }).then((r) => r.data),
  });
  return (
    <Panel title="Lab reports" flush>
      <QueryState query={query} empty={{ when: (d) => d.length === 0, title: 'No lab orders yet' }}>
        {(rows) => (
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/laboratory/orders/${r.id}`)}
            columns={[
              { key: 'no', header: 'Order', render: (r) => <span className="mono">{r.orderNumber}</span> },
              { key: 'date', header: 'Date', render: (r) => fmtDate(r.date) },
              { key: 'tests', header: 'Tests', render: (r) => r.items.map((i) => i.testName).join(', ') },
              {
                key: 'flags',
                header: 'Abnormal',
                render: (r) =>
                  r.items.some((i) => i.results.some((v) => v.flag !== 'normal')) ? <StatusBadge status="abnormal" /> : null,
              },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
        )}
      </QueryState>
    </Panel>
  );
}

export function ReferralsTab({ patientId }: { patientId: string }) {
  const query = useQuery({
    queryKey: ['referrals', { patient: patientId }],
    queryFn: () => api.page<Referral>('/referrals', { patient: patientId, limit: 100 }).then((r) => r.data),
  });
  return (
    <Panel title="Referrals" flush>
      <QueryState query={query} empty={{ when: (d) => d.length === 0, title: 'No referrals' }}>
        {(rows) => (
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            columns={[
              { key: 'date', header: 'Date', render: (r) => fmtDate(r.referralDate) },
              { key: 'spec', header: 'Specialty', render: (r) => r.specialty },
              { key: 'to', header: 'Referred to', render: (r) => [r.referredToDoctor, r.hospital].filter(Boolean).join(', ') },
              { key: 'by', header: 'Referred by', render: (r) => doctorName(r.referringDoctor) },
              { key: 'priority', header: 'Priority', render: (r) => <StatusBadge status={r.priority} /> },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
        )}
      </QueryState>
    </Panel>
  );
}

export function BillingTab({ patientId }: { patientId: string }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const query = useQuery({
    queryKey: ['billing', 'invoices', { patient: patientId }],
    queryFn: () => api.page<Invoice>('/billing/invoices', { patient: patientId, limit: 100 }).then((r) => r.data),
  });
  return (
    <Panel
      title="Invoices"
      flush
      actions={
        can('billing:manage') && (
          <Button size="sm" variant="primary" onClick={() => navigate(`/billing/new?patient=${patientId}`)}>
            New invoice
          </Button>
        )
      }
    >
      <QueryState query={query} empty={{ when: (d) => d.length === 0, title: 'No invoices' }}>
        {(rows) => (
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/billing/invoices/${r.id}`)}
            columns={[
              { key: 'no', header: 'Invoice', render: (r) => <span className="mono">{r.invoiceNumber}</span> },
              { key: 'date', header: 'Date', render: (r) => fmtDate(r.date) },
              { key: 'total', header: 'Total', className: 'num', render: (r) => money(r.total) },
              { key: 'bal', header: 'Balance', className: 'num', render: (r) => money(r.balance) },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
        )}
      </QueryState>
    </Panel>
  );
}

interface PatientDocument {
  id: string;
  title: string;
  category: string;
  originalName: string;
  size: number;
  uploadedAt: string;
  uploadedByName: string;
  voided?: boolean;
  voidReason?: string;
}

const DOCUMENT_CATEGORIES = ['lab_report', 'imaging', 'discharge_summary', 'referral_letter', 'prescription', 'consent', 'other'];

export function DocumentsTab({ patientId, canView }: { patientId: string; canView: boolean }) {
  const { can, canAny } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState({ open: false, title: '', category: 'other', file: null as File | null, saving: false });
  const [voiding, setVoiding] = useState<PatientDocument | null>(null);
  const query = useQuery({
    queryKey: ['patients', patientId, 'documents'],
    queryFn: () => api.get<PatientDocument[]>(`/patients/${patientId}/documents`),
    enabled: canView,
  });
  const voidDoc = useAction(
    (reason: string) => api.post(`/patients/${patientId}/documents/${voiding!.id}/void`, { reason }),
    { success: 'Document voided', invalidate: [['patients', patientId, 'documents']], onSuccess: () => setVoiding(null) },
  );

  const submit = async () => {
    if (!upload.file || !upload.title.trim()) return;
    const body = new FormData();
    body.append('title', upload.title.trim());
    body.append('category', upload.category);
    body.append('file', upload.file);
    setUpload((u) => ({ ...u, saving: true }));
    try {
      await request(`/patients/${patientId}/documents`, { method: 'POST', body });
      toast.success('Document uploaded');
      setUpload({ open: false, title: '', category: 'other', file: null, saving: false });
      void query.refetch();
    } catch (err) {
      toast.error(err);
      setUpload((u) => ({ ...u, saving: false }));
    }
  };

  return (
    <Panel
      title="Documents"
      flush
      actions={
        canAny('medical:write', 'patient:update') && (
          <Button size="sm" variant="primary" icon={<FileUp size={14} />} onClick={() => setUpload((u) => ({ ...u, open: true }))}>
            Upload
          </Button>
        )
      }
    >
      {!canView ? (
        <EmptyState title="Documents are part of the clinical record">You can upload documents, but not view them.</EmptyState>
      ) : (
        <QueryState query={query} empty={{ when: (d) => d.length === 0, title: 'No documents uploaded' }}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              columns={[
                {
                  key: 'title',
                  header: 'Title',
                  render: (r) => (
                    <>
                      <div className="cell-title" style={r.voided ? { textDecoration: 'line-through' } : undefined}>
                        {r.title}
                      </div>
                      <div className="cell-sub">
                        {r.originalName} · {Math.ceil(r.size / 1024)} KB
                        {r.voided ? ` · Voided: ${r.voidReason}` : ''}
                      </div>
                    </>
                  ),
                },
                { key: 'cat', header: 'Category', render: (r) => formatEnum(r.category) },
                { key: 'by', header: 'Uploaded', render: (r) => <span className="small">{r.uploadedByName}, {fmtDate(r.uploadedAt)}</span> },
                {
                  key: 'actions',
                  header: '',
                  render: (r) => (
                    <div className="row">
                      <Button
                        size="sm"
                        onClick={() => openFile(`/patients/${patientId}/documents/${r.id}`).catch((e) => toast.error(errorMessage(e)))}
                      >
                        Open
                      </Button>
                      {can('medical:write') && !r.voided && (
                        <Button size="sm" variant="ghost" onClick={() => setVoiding(r)}>
                          Void
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </QueryState>
      )}

      <Modal
        open={upload.open}
        title="Upload document"
        onClose={() => setUpload((u) => ({ ...u, open: false }))}
        onSubmit={submit}
        footer={
          <>
            <Button onClick={() => setUpload((u) => ({ ...u, open: false }))}>Cancel</Button>
            <Button type="submit" variant="primary" loading={upload.saving} disabled={!upload.file || !upload.title.trim()}>
              Upload
            </Button>
          </>
        }
      >
        <div className="stack-sm">
          <TextInput label="Title" required value={upload.title} onChange={(e) => setUpload((u) => ({ ...u, title: e.target.value }))} />
          <SelectInput
            label="Category"
            value={upload.category}
            options={enumOptions(DOCUMENT_CATEGORIES)}
            onChange={(e) => setUpload((u) => ({ ...u, category: e.target.value }))}
          />
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => setUpload((u) => ({ ...u, file: e.target.files?.[0] ?? null }))}
          />
          <p className="small muted">PDF, PNG or JPEG, up to 10 MB.</p>
        </div>
      </Modal>
      <ConfirmDialog
        open={Boolean(voiding)}
        title="Void document"
        message="The file stays on record and is marked as void."
        requireReason
        danger
        confirmLabel="Void"
        loading={voidDoc.isPending}
        onConfirm={(reason) => voidDoc.mutate(reason)}
        onClose={() => setVoiding(null)}
      />
    </Panel>
  );
}
