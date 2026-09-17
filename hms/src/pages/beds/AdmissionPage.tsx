import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dischargeSchema, toHospitalDate } from '@hms/shared';
import { useAuth } from '../../contexts/AuthContext';
import { useAction } from '../../hooks/queries';
import { api } from '../../services/api';
import { ErrorState, Loading, StatusBadge } from '../../components/data';
import { Modal } from '../../components/overlay';
import { Button, Notice, SelectInput, TextArea, TextInput } from '../../components/ui';
import { PrintHeader, PrintToolbar } from '../../features/print/PrintHeader';
import { ageLabel, doctorName, fmtDate, fmtDateTime, formatEnum } from '../../utils/format';
import type { Admission, BedBoard } from '../../types';

const CONDITIONS = ['recovered', 'improved', 'unchanged', 'referred', 'lama', 'deceased'];
const CONDITION_LABELS: Record<string, string> = {
  recovered: 'Recovered',
  improved: 'Improved',
  unchanged: 'Unchanged',
  referred: 'Referred to higher centre',
  lama: 'Left against medical advice',
  deceased: 'Deceased',
};

export default function AdmissionPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<'transfer' | 'discharge' | null>(null);
  const [transfer, setTransfer] = useState({ bed: '', reason: '' });
  const [discharge, setDischarge] = useState({
    finalDiagnosis: '',
    treatmentGiven: '',
    conditionAtDischarge: 'recovered',
    advice: '',
    followUpDate: '',
  });
  const [error, setError] = useState('');

  const query = useQuery({ queryKey: ['admissions', id], queryFn: () => api.get<Admission>(`/admissions/${id}`) });
  const board = useQuery({
    queryKey: ['beds', 'board'],
    queryFn: () => api.get<BedBoard>('/beds/board'),
    enabled: modal === 'transfer',
  });
  const onDone = (a: Admission) => {
    queryClient.setQueryData(['admissions', id], a);
    void queryClient.invalidateQueries({ queryKey: ['beds'] });
    void queryClient.invalidateQueries({ queryKey: ['admissions'] });
    setModal(null);
  };
  const doTransfer = useAction(() => api.post<Admission>(`/admissions/${id}/transfer`, transfer), {
    success: 'Patient transferred',
    onSuccess: onDone,
  });
  const doDischarge = useAction(() => api.post<Admission>(`/admissions/${id}/discharge`, discharge), {
    success: 'Patient discharged. Room charges were added to the bill.',
    onSuccess: onDone,
  });

  if (query.isLoading) return <Loading />;
  if (query.error || !query.data) return <ErrorState error={query.error} />;
  const a = query.data;
  const admitted = a.status === 'admitted';
  const ds = a.dischargeSummary;
  const freeBeds = (board.data?.wards ?? []).flatMap((w) =>
    w.beds.filter((b) => ['available', 'reserved'].includes(b.status)).map((b) => ({ value: b.id, label: `${w.name}: ${b.code}` })),
  );

  return (
    <>
      <PrintToolbar>
        <StatusBadge status={a.status} />
        {admitted && can('admission:manage') && (
          <>
            <Button onClick={() => { setTransfer({ bed: '', reason: '' }); setModal('transfer'); }}>Transfer bed</Button>
            <Button
              variant="primary"
              onClick={() => {
                setError('');
                setDischarge((d) => ({ ...d, finalDiagnosis: d.finalDiagnosis || a.provisionalDiagnosis || '' }));
                setModal('discharge');
              }}
            >
              Discharge
            </Button>
          </>
        )}
      </PrintToolbar>

      <article className="print-page">
        <PrintHeader right={<div className="strong">{admitted ? 'Admission record' : 'Discharge summary'}</div>} />
        <div className="grid grid-2" style={{ gap: 12, marginBottom: 12 }}>
          <div>
            <div className="strong">{a.patient.fullName}</div>
            <div>
              UHID <span className="mono">{a.patient.uhid}</span> · {ageLabel(a.patient)} · {formatEnum(a.patient.gender)}
            </div>
            <div className="no-print small">
              <Link to={`/patients/${a.patient.id ?? a.patient._id}`}>Open patient record</Link>
            </div>
          </div>
          <div className="small" style={{ textAlign: 'right' }}>
            <div>
              Admission <span className="mono">{a.admissionNumber}</span>
            </div>
            <div>Admitted: {fmtDateTime(a.admittedAt)}</div>
            {a.dischargedAt && <div>Discharged: {fmtDateTime(a.dischargedAt)}</div>}
            <div>Consultant: {doctorName(a.admittingDoctor)}</div>
            <div>
              Bed: {a.bed?.ward?.name} {a.bed?.code}
            </div>
          </div>
        </div>

        <table className="table" style={{ marginBottom: 12 }}>
          <tbody>
            <tr><td className="strong" style={{ width: 200 }}>Reason for admission</td><td>{a.reason}</td></tr>
            {a.provisionalDiagnosis && <tr><td className="strong">Provisional diagnosis</td><td>{a.provisionalDiagnosis}</td></tr>}
            {a.expectedDischargeDate && admitted && <tr><td className="strong">Expected discharge</td><td>{fmtDate(a.expectedDischargeDate)}</td></tr>}
            {ds?.finalDiagnosis && <tr><td className="strong">Final diagnosis</td><td>{ds.finalDiagnosis}</td></tr>}
            {ds?.treatmentGiven && <tr><td className="strong">Treatment given</td><td style={{ whiteSpace: 'pre-wrap' }}>{ds.treatmentGiven}</td></tr>}
            {ds?.conditionAtDischarge && <tr><td className="strong">Condition at discharge</td><td>{CONDITION_LABELS[ds.conditionAtDischarge] ?? ds.conditionAtDischarge}</td></tr>}
            {ds?.advice && <tr><td className="strong">Advice</td><td style={{ whiteSpace: 'pre-wrap' }}>{ds.advice}</td></tr>}
            {ds?.followUpDate && <tr><td className="strong">Follow-up</td><td>{fmtDate(ds.followUpDate)}</td></tr>}
          </tbody>
        </table>

        <h3 style={{ marginBottom: 6 }}>Bed history</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Bed</th>
              <th>From</th>
              <th>To</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {a.stays.map((s, i) => (
              <tr key={i}>
                <td>{s.bedCode}</td>
                <td>{fmtDateTime(s.from)}</td>
                <td>{s.to ? fmtDateTime(s.to) : 'Current'}</td>
                <td>{s.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="print-footer">
          <div>
            {a.admittedBy && <div>Admitted by {a.admittedBy.name}</div>}
            {a.dischargedBy && <div>Discharged by {a.dischargedBy.name}</div>}
          </div>
          <div className="signature">{doctorName(a.admittingDoctor)}</div>
        </div>
      </article>

      <Modal
        open={modal === 'transfer'}
        title="Transfer to another bed"
        onClose={() => setModal(null)}
        onSubmit={() => transfer.bed && transfer.reason.trim() && doTransfer.mutate(undefined)}
        footer={
          <>
            <Button onClick={() => setModal(null)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!transfer.bed || !transfer.reason.trim()} loading={doTransfer.isPending}>
              Transfer
            </Button>
          </>
        }
      >
        <div className="stack-sm">
          <SelectInput label="New bed" required value={transfer.bed} placeholder={board.isLoading ? 'Loading' : 'Select bed'} options={freeBeds} onChange={(e) => setTransfer({ ...transfer, bed: e.target.value })} />
          <TextInput label="Reason" required value={transfer.reason} onChange={(e) => setTransfer({ ...transfer, reason: e.target.value })} />
          <p className="small muted">The current bed is marked for cleaning.</p>
        </div>
      </Modal>

      <Modal
        open={modal === 'discharge'}
        wide
        title="Discharge patient"
        onClose={() => setModal(null)}
        onSubmit={() => {
          const parsed = dischargeSchema.safeParse(discharge);
          if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Check the form');
            return;
          }
          doDischarge.mutate(undefined);
        }}
        footer={
          <>
            <Button onClick={() => setModal(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={doDischarge.isPending}>
              Discharge
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {error && (
            <div className="span-all">
              <Notice tone="danger">{error}</Notice>
            </div>
          )}
          <TextArea label="Final diagnosis" required fieldClassName="span-all" rows={2} value={discharge.finalDiagnosis} onChange={(e) => setDischarge({ ...discharge, finalDiagnosis: e.target.value })} />
          <TextArea label="Treatment given" fieldClassName="span-all" rows={4} value={discharge.treatmentGiven} onChange={(e) => setDischarge({ ...discharge, treatmentGiven: e.target.value })} />
          <SelectInput
            label="Condition at discharge"
            value={discharge.conditionAtDischarge}
            options={CONDITIONS.map((c) => ({ value: c, label: CONDITION_LABELS[c] }))}
            onChange={(e) => setDischarge({ ...discharge, conditionAtDischarge: e.target.value })}
          />
          <TextInput label="Follow-up date" type="date" min={toHospitalDate()} value={discharge.followUpDate} onChange={(e) => setDischarge({ ...discharge, followUpDate: e.target.value })} />
          <TextArea label="Advice on discharge" fieldClassName="span-all" rows={3} value={discharge.advice} onChange={(e) => setDischarge({ ...discharge, advice: e.target.value })} />
          <p className="small muted span-all">
            Room charges are calculated per calendar day for each bed and added to the patient's bill. The bed is marked for cleaning.
          </p>
        </div>
      </Modal>
    </>
  );
}
