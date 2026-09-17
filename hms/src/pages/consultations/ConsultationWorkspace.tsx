import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FlaskConical, Lock, Pill, Plus, Printer, Save, Send, Trash2 } from 'lucide-react';
import { consultationUpdateSchema, DIAGNOSIS_TYPES, toHospitalDate } from '@hms/shared';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useAction, useSettings } from '../../hooks/queries';
import { api } from '../../services/api';
import { Badge, EmptyState, ErrorState, Loading, StatusBadge } from '../../components/data';
import { ConfirmDialog, Modal } from '../../components/overlay';
import { Button, enumOptions, KeyValue, LinkButton, Panel, SelectInput, TextArea, TextInput } from '../../components/ui';
import { LabOrderModal } from '../../features/clinical/LabOrderModal';
import { PrescriptionEditor } from '../../features/clinical/PrescriptionEditor';
import { ReferralModal } from '../../features/clinical/ReferralModal';
import { VitalsFields, vitalsToForm } from '../../features/opd/VitalsModal';
import { ageLabel, doctorName, fmtDate, fmtDateTime, formatEnum, vitalsSummary } from '../../utils/format';
import type {
  Admission,
  Consultation,
  Diagnosis,
  HistoryEntry,
  LabOrder,
  Prescription,
  Referral,
} from '../../types';

interface ClinicalSummary {
  allergies: HistoryEntry[];
  conditions: HistoryEntry[];
  medications: HistoryEntry[];
  otherHistory: HistoryEntry[];
  recentConsultations: Consultation[];
  recentPrescriptions: Prescription[];
  diagnoses: (Diagnosis & { date: string })[];
  labOrders: LabOrder[];
  referrals: Referral[];
  admissions: Admission[];
}

interface FormState {
  chiefComplaint: string;
  symptoms: string;
  historyOfPresentIllness: string;
  vitals: Record<string, string>;
  examination: string;
  diagnoses: Diagnosis[];
  clinicalNotes: string;
  treatmentPlan: string;
  advice: string;
  followUpDate: string;
}

function toForm(c: Consultation): FormState {
  return {
    chiefComplaint: c.chiefComplaint ?? '',
    symptoms: c.symptoms.join(', '),
    historyOfPresentIllness: c.historyOfPresentIllness ?? '',
    vitals: vitalsToForm(c.vitals),
    examination: c.examination ?? '',
    diagnoses: c.diagnoses.length ? c.diagnoses : [],
    clinicalNotes: c.clinicalNotes ?? '',
    treatmentPlan: c.treatmentPlan ?? '',
    advice: c.advice ?? '',
    followUpDate: c.followUpDate ?? '',
  };
}

function toPayload(f: FormState) {
  return {
    chiefComplaint: f.chiefComplaint,
    symptoms: f.symptoms
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    historyOfPresentIllness: f.historyOfPresentIllness,
    vitals: f.vitals,
    examination: f.examination,
    diagnoses: f.diagnoses.filter((d) => d.description.trim()),
    clinicalNotes: f.clinicalNotes,
    treatmentPlan: f.treatmentPlan,
    advice: f.advice,
    followUpDate: f.followUpDate,
  };
}

function SummarySidebar({ patientId, consultationId }: { patientId: string; consultationId: string }) {
  const query = useQuery({
    queryKey: ['patients', patientId, 'clinical-summary'],
    queryFn: () => api.get<ClinicalSummary>(`/patients/${patientId}/clinical-summary`),
  });
  if (query.isLoading) return <Loading />;
  if (query.error || !query.data) return <ErrorState error={query.error} />;
  const s = query.data;
  const previous = s.recentConsultations.filter((c) => c.id !== consultationId);

  const section = (title: string, children: React.ReactNode, empty: boolean) => (
    <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
      <div className="small strong muted" style={{ marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {title}
      </div>
      {empty ? <div className="small subtle">None recorded</div> : children}
    </div>
  );

  return (
    <Panel title="Patient record" flush actions={<LinkButton size="sm" to={`/patients/${patientId}?tab=timeline`}>Timeline</LinkButton>}>
      {section(
        'Allergies',
        <div className="alert-strip">
          {s.allergies.map((a) => (
            <Badge key={a.id} tone="danger">
              <AlertTriangle size={12} /> {a.title}
              {a.severity ? ` (${a.severity})` : ''}
            </Badge>
          ))}
        </div>,
        s.allergies.length === 0,
      )}
      {section(
        'Active conditions',
        <ul className="list small">{s.conditions.map((c) => <li key={c.id}>{c.title}</li>)}</ul>,
        s.conditions.length === 0,
      )}
      {section(
        'Current medications',
        <ul className="list small">
          {s.medications.map((m) => (
            <li key={m.id}>{m.title}</li>
          ))}
          {s.recentPrescriptions
            .filter((p) => ['active', 'partially_dispensed', 'dispensed'].includes(p.status))
            .slice(0, 3)
            .flatMap((p) =>
              p.items.map((i) => (
                <li key={`${p.id}-${i._id}`}>
                  {i.medicineName} {i.strength} {i.frequency} × {i.durationValue} {i.durationUnit}{' '}
                  <span className="subtle">({fmtDate(p.date)})</span>
                </li>
              )),
            )}
        </ul>,
        s.medications.length === 0 && s.recentPrescriptions.length === 0,
      )}
      {section(
        'Previous diagnoses',
        <ul className="list small">
          {s.diagnoses.slice(0, 8).map((d, i) => (
            <li key={i}>
              {d.description} <span className="subtle">({fmtDate(d.date)})</span>
            </li>
          ))}
        </ul>,
        s.diagnoses.length === 0,
      )}
      {section(
        'Previous visits',
        <ul className="list small">
          {previous.slice(0, 5).map((c) => (
            <li key={c.id} style={{ marginBottom: 4 }}>
              <Link to={`/consultations/${c.id}`}>{fmtDate(c.date)}</Link> · {doctorName(c.doctor)}
              <div className="muted">{c.chiefComplaint}</div>
            </li>
          ))}
        </ul>,
        previous.length === 0,
      )}
      {section(
        'Lab reports',
        <ul className="list small">
          {s.labOrders.map((o) => (
            <li key={o.id} style={{ marginBottom: 4 }}>
              <Link to={`/laboratory/orders/${o.id}`}>{fmtDate(o.date)}</Link>
              {o.items.map((i) => (
                <div key={i._id} className="muted">
                  {i.testName}:{' '}
                  {i.results.map((r) => (
                    <span key={r.parameter} className={r.flag !== 'normal' ? 'danger-text' : undefined}>
                      {r.parameter} {r.value} {r.unit}{' '}
                    </span>
                  ))}
                </div>
              ))}
            </li>
          ))}
        </ul>,
        s.labOrders.length === 0,
      )}
      {section(
        'Referrals',
        <ul className="list small">
          {s.referrals.map((r) => (
            <li key={r.id}>
              {r.specialty} ({formatEnum(r.status)}), {fmtDate(r.referralDate)}
            </li>
          ))}
        </ul>,
        s.referrals.length === 0,
      )}
      {section(
        'Admissions',
        <ul className="list small">
          {s.admissions.map((a) => (
            <li key={a.id}>
              {fmtDate(a.admittedAt)}: {a.reason} ({formatEnum(a.status)})
            </li>
          ))}
        </ul>,
        s.admissions.length === 0,
      )}
      {s.otherHistory.length > 0 &&
        section(
          'Other history',
          <ul className="list small">
            {s.otherHistory.map((h) => (
              <li key={h.id}>
                {formatEnum(h.type)}: {h.title}
              </li>
            ))}
          </ul>,
          false,
        )}
    </Panel>
  );
}

function ReadOnlyConsultation({ c }: { c: Consultation }) {
  return (
    <Panel title="Consultation record">
      <KeyValue
        items={[
          ['Chief complaint', c.chiefComplaint],
          ['Symptoms', c.symptoms.join(', ')],
          ['History', c.historyOfPresentIllness],
          ['Vitals', vitalsSummary(c.vitals as Record<string, number>)],
          ['Examination', c.examination],
          [
            'Diagnosis',
            c.diagnoses.map((d) => `${d.description}${d.code ? ` [${d.code}]` : ''} (${d.type})`).join('; '),
          ],
          ['Clinical notes', c.clinicalNotes],
          ['Treatment plan', c.treatmentPlan],
          ['Advice', c.advice],
          ['Follow-up', fmtDate(c.followUpDate)],
        ]}
      />
    </Panel>
  );
}

export default function ConsultationWorkspace() {
  const { id = '' } = useParams();
  const { user, can } = useAuth();
  const toast = useToast();
  const settings = useSettings();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [modal, setModal] = useState<'rx' | 'lab' | 'referral' | 'complete' | 'addendum' | null>(null);
  const [addendum, setAddendum] = useState('');

  const query = useQuery({ queryKey: ['consultations', id], queryFn: () => api.get<Consultation>(`/consultations/${id}`) });
  const c = query.data;
  const patientId = c ? (c.patient.id ?? c.patient._id)! : '';

  useEffect(() => {
    if (c && !dirty) setForm(toForm(c));
  }, [c, dirty]);

  const prescriptions = useQuery({
    queryKey: ['prescriptions', { patient: patientId, consultation: id }],
    queryFn: () =>
      api
        .page<Prescription>('/prescriptions', { patient: patientId, limit: 50 })
        .then((r) => r.data.filter((p) => (p.consultation?._id ?? p.consultation) === id)),
    enabled: Boolean(patientId) && can('prescription:read'),
  });
  const labOrders = useQuery({
    queryKey: ['lab', 'orders', { patient: patientId, consultation: id }],
    queryFn: () =>
      api
        .page<LabOrder & { consultation?: string }>('/laboratory/orders', { patient: patientId, limit: 50 })
        .then((r) => r.data.filter((o) => o.consultation === id)),
    enabled: Boolean(patientId) && can('lab:read') && settings.data?.modules.laboratory !== false,
  });

  const validate = (f: FormState) => {
    const parsed = consultationUpdateSchema.safeParse(toPayload(f));
    if (!parsed.success) {
      toast.error(new Error(`${parsed.error.issues[0]?.path.join(' ')}: ${parsed.error.issues[0]?.message}`));
      return false;
    }
    return true;
  };

  const saveDraft = useAction(() => api.patch<Consultation>(`/consultations/${id}`, toPayload(form!)), {
    success: 'Draft saved',
    onSuccess: (updated) => {
      setDirty(false);
      queryClient.setQueryData(['consultations', id], updated);
    },
  });
  const complete = useAction(() => api.post<Consultation>(`/consultations/${id}/complete`, toPayload(form!)), {
    success: 'Consultation completed and locked',
    invalidate: [['queue'], ['dashboard'], ['consultations']],
    onSuccess: (updated) => {
      setDirty(false);
      setModal(null);
      queryClient.setQueryData(['consultations', id], updated);
    },
  });
  const addAddendum = useAction(() => api.post<Consultation>(`/consultations/${id}/addenda`, { text: addendum }), {
    success: 'Addendum added',
    onSuccess: (updated) => {
      setModal(null);
      setAddendum('');
      queryClient.setQueryData(['consultations', id], updated);
    },
  });

  if (query.isLoading) return <Loading />;
  if (query.error || !c) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const own = Boolean(user?.doctorId && user.doctorId === (c.doctor.id ?? c.doctor._id));
  const editable = own && c.status === 'draft';
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setDirty(true);
  };

  return (
    <>
      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="patient-banner">
          <div>
            <div className="name">
              <Link to={`/patients/${patientId}`} style={{ color: 'inherit' }}>
                {c.patient.fullName}
              </Link>
            </div>
            <div className="muted">
              <span className="mono">{c.patient.uhid}</span> · {ageLabel(c.patient)} · {formatEnum(c.patient.gender)}
              {c.patient.bloodGroup && c.patient.bloodGroup !== 'unknown' ? ` · ${c.patient.bloodGroup}` : ''}
            </div>
          </div>
          <div className="muted small">
            {fmtDate(c.date)} · {doctorName(c.doctor)}
            {c.token ? ` · Token ${c.token.number}` : ''}
          </div>
          <div className="row" style={{ marginLeft: 'auto' }}>
            <StatusBadge status={c.status} />
            {editable && (
              <>
                <Button icon={<Save size={14} />} loading={saveDraft.isPending} disabled={!dirty} onClick={() => form && validate(form) && saveDraft.mutate(undefined)}>
                  Save draft
                </Button>
                <Button variant="primary" icon={<Lock size={14} />} onClick={() => form && validate(form) && setModal('complete')}>
                  Complete
                </Button>
              </>
            )}
            {own && c.status === 'completed' && <Button onClick={() => setModal('addendum')}>Add addendum</Button>}
          </div>
        </div>
      </section>

      <div className="grid grid-sidebar">
        <div className="stack">
          {editable && form ? (
            <Panel title="Consultation">
              <div className="form-grid">
                <TextInput
                  label="Chief complaint"
                  required
                  fieldClassName="span-all"
                  autoFocus
                  value={form.chiefComplaint}
                  onChange={(e) => set('chiefComplaint', e.target.value)}
                />
                <TextInput
                  label="Symptoms"
                  hint="Separate with commas"
                  fieldClassName="span-all"
                  value={form.symptoms}
                  onChange={(e) => set('symptoms', e.target.value)}
                />
                <TextArea
                  label="History of present illness"
                  fieldClassName="span-all"
                  rows={3}
                  value={form.historyOfPresentIllness}
                  onChange={(e) => set('historyOfPresentIllness', e.target.value)}
                />
                <div className="form-section-title">Vitals</div>
                <div className="span-all">
                  <VitalsFields value={form.vitals} onChange={(v) => set('vitals', v)} />
                </div>
                <div className="form-section-title">Examination and diagnosis</div>
                <TextArea
                  label="Examination findings"
                  fieldClassName="span-all"
                  rows={3}
                  value={form.examination}
                  onChange={(e) => set('examination', e.target.value)}
                />
                <div className="span-all stack-sm">
                  {form.diagnoses.map((d, i) => (
                    <div key={i} className="row" style={{ alignItems: 'flex-end' }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <TextInput
                          label={i === 0 ? 'Diagnosis' : undefined}
                          aria-label="Diagnosis"
                          value={d.description}
                          onChange={(e) => set('diagnoses', form.diagnoses.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                        />
                      </div>
                      <div style={{ width: 110 }}>
                        <TextInput
                          label={i === 0 ? 'ICD-10' : undefined}
                          aria-label="ICD-10 code"
                          value={d.code ?? ''}
                          onChange={(e) => set('diagnoses', form.diagnoses.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))}
                        />
                      </div>
                      <div style={{ width: 140 }}>
                        <SelectInput
                          label={i === 0 ? 'Type' : undefined}
                          aria-label="Diagnosis type"
                          value={d.type}
                          options={enumOptions(DIAGNOSIS_TYPES)}
                          onChange={(e) =>
                            set('diagnoses', form.diagnoses.map((x, j) => (j === i ? { ...x, type: e.target.value as Diagnosis['type'] } : x)))
                          }
                        />
                      </div>
                      <Button
                        iconOnly
                        variant="ghost"
                        aria-label="Remove diagnosis"
                        icon={<Trash2 size={14} />}
                        onClick={() => set('diagnoses', form.diagnoses.filter((_, j) => j !== i))}
                      />
                    </div>
                  ))}
                  <div>
                    <Button
                      size="sm"
                      icon={<Plus size={13} />}
                      onClick={() => set('diagnoses', [...form.diagnoses, { description: '', type: 'provisional' }])}
                    >
                      Add diagnosis
                    </Button>
                  </div>
                </div>
                <TextArea label="Clinical notes" fieldClassName="span-all" rows={3} value={form.clinicalNotes} onChange={(e) => set('clinicalNotes', e.target.value)} />
                <TextArea label="Treatment plan" rows={3} value={form.treatmentPlan} onChange={(e) => set('treatmentPlan', e.target.value)} />
                <TextArea label="Advice to patient" rows={3} value={form.advice} onChange={(e) => set('advice', e.target.value)} />
                <TextInput
                  label="Follow-up date"
                  type="date"
                  min={toHospitalDate()}
                  value={form.followUpDate}
                  onChange={(e) => set('followUpDate', e.target.value)}
                />
              </div>
            </Panel>
          ) : (
            <>
              {c.status === 'draft' && !own && (
                <EmptyState title="Consultation in progress">Only the treating doctor can edit this draft.</EmptyState>
              )}
              <ReadOnlyConsultation c={c} />
            </>
          )}

          {c.addenda.length > 0 && (
            <Panel title="Addenda">
              <ul className="list">
                {c.addenda.map((a, i) => (
                  <li key={i} className="list-item">
                    <div>{a.text}</div>
                    <div className="small subtle">
                      {a.by?.name}, {fmtDateTime(a.at)}
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel
            title="Prescriptions"
            flush
            actions={
              own && can('prescription:write') && (
                <Button size="sm" variant="primary" icon={<Pill size={13} />} onClick={() => setModal('rx')}>
                  Prescribe
                </Button>
              )
            }
          >
            {!prescriptions.data?.length ? (
              <EmptyState title="No prescription for this visit" />
            ) : (
              <ul className="list">
                {prescriptions.data.map((p) => (
                  <li key={p.id} className="list-item">
                    <div className="row-between">
                      <span>
                        <span className="mono">{p.number}</span> <StatusBadge status={p.status} />
                      </span>
                      <LinkButton size="sm" to={`/prescriptions/${p.id}/print`} icon={<Printer size={13} />}>
                        Print
                      </LinkButton>
                    </div>
                    <ol style={{ margin: '6px 0 0', paddingLeft: 18 }} className="small">
                      {p.items.map((i) => (
                        <li key={i._id}>
                          {i.medicineName} {i.strength} · {i.dose} · {i.frequency} · {i.durationValue} {i.durationUnit}
                          {i.instructions ? ` · ${i.instructions}` : ''}
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {settings.data?.modules.laboratory !== false && (
            <Panel
              title="Lab orders"
              flush
              actions={
                can('lab:order') && (
                  <Button size="sm" icon={<FlaskConical size={13} />} onClick={() => setModal('lab')}>
                    Order tests
                  </Button>
                )
              }
            >
              {!labOrders.data?.length ? (
                <EmptyState title="No tests ordered for this visit" />
              ) : (
                <ul className="list">
                  {labOrders.data.map((o) => (
                    <li key={o.id} className="list-item row-between">
                      <Link to={`/laboratory/orders/${o.id}`}>
                        {o.orderNumber}: {o.items.map((i) => i.testName).join(', ')}
                      </Link>
                      <StatusBadge status={o.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {own && can('referral:write') && (
            <div>
              <Button icon={<Send size={14} />} onClick={() => setModal('referral')}>
                Refer patient
              </Button>
            </div>
          )}
        </div>

        <SummarySidebar patientId={patientId} consultationId={id} />
      </div>

      <PrescriptionEditor open={modal === 'rx'} consultationId={id} onClose={() => setModal(null)} />
      <LabOrderModal open={modal === 'lab'} patientId={patientId} consultationId={id} onClose={() => setModal(null)} />
      <ReferralModal open={modal === 'referral'} patientId={patientId} consultationId={id} onClose={() => setModal(null)} />
      <ConfirmDialog
        open={modal === 'complete'}
        title="Complete consultation"
        message="The record will be locked. Later additions can only be made as addenda. The consultation fee is added to the patient's bill."
        confirmLabel="Complete"
        loading={complete.isPending}
        onConfirm={() => complete.mutate(undefined)}
        onClose={() => setModal(null)}
      />
      <Modal
        open={modal === 'addendum'}
        title="Add addendum"
        onClose={() => setModal(null)}
        footer={
          <>
            <Button onClick={() => setModal(null)}>Cancel</Button>
            <Button variant="primary" disabled={!addendum.trim()} loading={addAddendum.isPending} onClick={() => addAddendum.mutate(undefined)}>
              Save addendum
            </Button>
          </>
        }
      >
        <TextArea label="Addendum" rows={5} value={addendum} onChange={(e) => setAddendum(e.target.value)} />
      </Modal>
    </>
  );
}
