import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { useAction, useSettings } from '../../hooks/queries';
import { api } from '../../services/api';
import { ErrorState, Loading, StatusBadge } from '../../components/data';
import { ConfirmDialog } from '../../components/overlay';
import { Button, LinkButton } from '../../components/ui';
import { PrintHeader, PrintToolbar } from '../../features/print/PrintHeader';
import { ageLabel, doctorName, fmtDate, formatEnum, vitalsSummary } from '../../utils/format';
import type { Prescription } from '../../types';

export default function PrescriptionPrintPage() {
  const { id = '' } = useParams();
  const { can, user } = useAuth();
  const settings = useSettings();
  const [cancelling, setCancelling] = useState(false);
  const query = useQuery({ queryKey: ['prescriptions', id], queryFn: () => api.get<Prescription>(`/prescriptions/${id}`) });
  const cancel = useAction((reason: string) => api.post(`/prescriptions/${id}/cancel`, { reason }), {
    success: 'Prescription cancelled',
    invalidate: [['prescriptions']],
    onSuccess: () => setCancelling(false),
  });

  if (query.isLoading) return <Loading />;
  if (query.error || !query.data) return <ErrorState error={query.error} />;
  const p = query.data;
  const c = p.consultation;
  const pending = ['active', 'partially_dispensed'].includes(p.status);
  const isPrescriber = user?.doctorId && user.doctorId === (p.doctor.id ?? p.doctor._id);

  return (
    <>
      <PrintToolbar>
        <StatusBadge status={p.status} />
        {can('pharmacy:dispense') && pending && (
          <LinkButton to={`/pharmacy/dispense?prescription=${p.id}`}>Dispense</LinkButton>
        )}
        {(isPrescriber || user?.role === 'admin') && p.status === 'active' && (
          <Button variant="danger" onClick={() => setCancelling(true)}>
            Cancel prescription
          </Button>
        )}
      </PrintToolbar>
      <article className="print-page">
        <PrintHeader
          right={
            <>
              <div className="strong">{doctorName(p.doctor)}</div>
              <div>{p.doctor.specialization}</div>
              {p.doctor.qualification && <div>{p.doctor.qualification}</div>}
              {p.doctor.registrationNumber && <div className="small">Reg. No. {p.doctor.registrationNumber}</div>}
            </>
          }
        />
        <div className="row-between" style={{ marginBottom: 12 }}>
          <div>
            <div className="strong">
              {p.patient.fullName}{' '}
              <span className="muted" style={{ fontWeight: 400 }}>
                ({ageLabel(p.patient)}, {formatEnum(p.patient.gender)})
              </span>
            </div>
            <div>
              UHID <span className="mono">{p.patient.uhid}</span> · {p.patient.phone}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div>
              Rx No. <span className="mono">{p.number}</span>
            </div>
            <div>Date: {fmtDate(p.date)}</div>
          </div>
        </div>

        {c && (
          <div style={{ marginBottom: 12 }}>
            {c.chiefComplaint && (
              <div>
                <span className="strong">Complaint:</span> {c.chiefComplaint}
              </div>
            )}
            {c.vitals && vitalsSummary(c.vitals as Record<string, number>) && (
              <div>
                <span className="strong">Vitals:</span> {vitalsSummary(c.vitals as Record<string, number>)}
              </div>
            )}
            {c.diagnoses?.length > 0 && (
              <div>
                <span className="strong">Diagnosis:</span> {c.diagnoses.map((d) => d.description).join(', ')}
              </div>
            )}
          </div>
        )}

        <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'Georgia, serif', marginBottom: 4 }}>Rx</div>
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Medicine</th>
              <th>Dose</th>
              <th>Frequency</th>
              <th>Duration</th>
              <th>Instructions</th>
              <th className="num">Qty</th>
            </tr>
          </thead>
          <tbody>
            {p.items.map((i, index) => (
              <tr key={i._id}>
                <td>{index + 1}</td>
                <td>
                  <div className="strong">
                    {formatEnum(i.form)} {i.medicineName} {i.strength}
                  </div>
                  <div className="small muted">{formatEnum(i.route)}</div>
                </td>
                <td>{i.dose}</td>
                <td className="nowrap">
                  <span className="strong">{i.frequency}</span>
                  {i.timing && i.timing !== 'any' && <div className="small">{formatEnum(i.timing)}</div>}
                </td>
                <td className="nowrap">
                  {i.durationValue} {i.durationUnit}
                </td>
                <td>{i.instructions}</td>
                <td className="num">{i.quantity ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted" style={{ marginTop: 6 }}>
          Frequency is written as morning-afternoon-night. For example, 1-0-1 means one dose in the morning and one at night.
        </p>

        {(p.notes || c?.advice) && (
          <div style={{ marginTop: 12 }}>
            <span className="strong">Advice:</span> {[c?.advice, p.notes].filter(Boolean).join(' ')}
          </div>
        )}
        {c?.followUpDate && (
          <div style={{ marginTop: 6 }}>
            <span className="strong">Follow-up on:</span> {fmtDate(c.followUpDate)}
          </div>
        )}

        <div className="print-footer">
          <div>{settings.data?.clinical.prescriptionFooter}</div>
          <div className="signature">{doctorName(p.doctor)}</div>
        </div>
        <div className="no-print small muted" style={{ marginTop: 16 }}>
          <Link to={`/patients/${p.patient.id ?? p.patient._id}`}>Open patient record</Link>
        </div>
      </article>
      <ConfirmDialog
        open={cancelling}
        title="Cancel prescription"
        requireReason
        danger
        confirmLabel="Cancel prescription"
        loading={cancel.isPending}
        onConfirm={(reason) => cancel.mutate(reason)}
        onClose={() => setCancelling(false)}
      />
    </>
  );
}
