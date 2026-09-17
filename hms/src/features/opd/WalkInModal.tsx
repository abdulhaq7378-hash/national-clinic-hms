import { useEffect, useState } from 'react';
import { PRIORITIES } from '@hms/shared';
import { useAction } from '../../hooks/queries';
import { api } from '../../services/api';
import { Modal } from '../../components/overlay';
import { DoctorSelect, PatientPicker } from '../../components/pickers';
import { Button, enumOptions, LinkButton, SelectInput, TextInput } from '../../components/ui';
import type { Patient, Token } from '../../types';

export function WalkInModal({
  open,
  onClose,
  patient: initialPatient,
  onIssued,
}: {
  open: boolean;
  onClose: () => void;
  patient?: Patient | null;
  onIssued?: (token: Token) => void;
}) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [doctor, setDoctor] = useState('');
  const [priority, setPriority] = useState('routine');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) {
      setPatient(initialPatient ?? null);
      setPriority('routine');
      setNotes('');
    }
  }, [open, initialPatient]);

  const issue = useAction(
    () => api.post<Token>('/queue/walk-in', { patient: patient!.id, doctor, priority, notes }),
    {
      success: (t) => `Token ${t.number} issued for ${t.patient.fullName}`,
      invalidate: [['queue'], ['dashboard']],
      onSuccess: (t) => {
        onIssued?.(t);
        onClose();
      },
    },
  );

  const canSave = Boolean(patient && doctor);
  return (
    <Modal
      open={open}
      title="Walk-in registration"
      onClose={onClose}
      onSubmit={() => canSave && issue.mutate(undefined)}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!canSave} loading={issue.isPending}>
            Issue token
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        <PatientPicker value={patient} onChange={setPatient} required autoFocus={!initialPatient} />
        {!patient && (
          <p className="small muted">
            New patient? <LinkButton size="sm" to="/patients/new">Register first</LinkButton>
          </p>
        )}
        <DoctorSelect value={doctor} onChange={setDoctor} required />
        <SelectInput label="Priority" value={priority} options={enumOptions(PRIORITIES)} onChange={(e) => setPriority(e.target.value)} />
        <TextInput label="Reason for visit" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}
