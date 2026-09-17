import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { APPOINTMENT_SOURCES, APPOINTMENT_TYPES, toHospitalDate } from '@hms/shared';
import { useAction } from '../../hooks/queries';
import { api } from '../../services/api';
import { Modal } from '../../components/overlay';
import { DoctorSelect, PatientPicker } from '../../components/pickers';
import { Loading } from '../../components/data';
import { Button, enumOptions, Field, Notice, SelectInput, TextArea, TextInput } from '../../components/ui';
import { fmtClock, fmtDate } from '../../utils/format';
import type { Appointment, Patient } from '../../types';

interface SlotResponse {
  slotMinutes: number;
  slots: { time: string; endTime: string; available: boolean; past: boolean }[];
}

/**
 * Books a new appointment, or reschedules an existing one when `appointment` is given.
 */
export function BookAppointmentModal({
  open,
  onClose,
  patient: initialPatient,
  appointment,
  defaultDate,
  defaultDoctor,
  onBooked,
}: {
  open: boolean;
  onClose: () => void;
  patient?: Patient | null;
  appointment?: Appointment | null;
  defaultDate?: string;
  defaultDoctor?: string;
  onBooked?: (appointment: Appointment) => void;
}) {
  const rescheduling = Boolean(appointment);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [doctor, setDoctor] = useState('');
  const [date, setDate] = useState(toHospitalDate());
  const [time, setTime] = useState('');
  const [type, setType] = useState('new');
  const [source, setSource] = useState('reception');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    setPatient(appointment?.patient ?? initialPatient ?? null);
    setDoctor(appointment ? appointment.doctor.id : defaultDoctor ?? '');
    setDate(appointment?.date ?? defaultDate ?? toHospitalDate());
    setTime('');
    setType(appointment?.type ?? 'new');
    setSource('reception');
    setNotes('');
  }, [open, appointment, initialPatient, defaultDate, defaultDoctor]);

  const slots = useQuery({
    queryKey: ['appointments', 'slots', doctor, date],
    queryFn: () => api.get<SlotResponse>('/appointments/slots', { doctor, date }),
    enabled: open && Boolean(doctor && date),
  });

  const save = useAction(
    () =>
      rescheduling
        ? api.post<Appointment>(`/appointments/${appointment!.id}/reschedule`, { doctor, date, startTime: time })
        : api.post<Appointment>('/appointments', { patient: patient!.id, doctor, date, startTime: time, type, source, notes }),
    {
      success: (a) => `${rescheduling ? 'Rescheduled' : 'Booked'} for ${fmtDate(a.date)} at ${fmtClock(a.startTime)}`,
      invalidate: [['appointments'], ['dashboard'], ['patients']],
      onSuccess: (a) => {
        onBooked?.(a);
        onClose();
      },
    },
  );

  const available = slots.data?.slots.filter((s) => !s.past) ?? [];
  const canSave = Boolean(patient && doctor && date && time);

  return (
    <Modal
      open={open}
      wide
      title={rescheduling ? 'Reschedule appointment' : 'Book appointment'}
      onClose={onClose}
      onSubmit={() => canSave && save.mutate(undefined)}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!canSave} loading={save.isPending}>
            {rescheduling ? 'Reschedule' : 'Book appointment'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="span-all">
          {rescheduling ? (
            <Field label="Patient">{() => <div className="patient-chip">{appointment!.patient.fullName}</div>}</Field>
          ) : (
            <PatientPicker value={patient} onChange={setPatient} required autoFocus={!initialPatient} />
          )}
        </div>
        <DoctorSelect value={doctor} onChange={(d) => { setDoctor(d); setTime(''); }} required />
        <TextInput
          label="Date"
          type="date"
          required
          min={toHospitalDate()}
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setTime('');
          }}
        />
        {!rescheduling && (
          <>
            <SelectInput label="Visit type" value={type} options={enumOptions(APPOINTMENT_TYPES)} onChange={(e) => setType(e.target.value)} />
            <SelectInput
              label="Booked via"
              value={source}
              options={enumOptions(APPOINTMENT_SOURCES.filter((s) => s !== 'website'))}
              onChange={(e) => setSource(e.target.value)}
            />
          </>
        )}
        <div className="span-all">
          <Field label="Time" required hint={slots.data ? `${slots.data.slotMinutes} minute slots` : undefined}>
            {() =>
              !doctor ? (
                <p className="muted small">Select a doctor to see available times.</p>
              ) : slots.isLoading ? (
                <Loading />
              ) : slots.error ? (
                <Notice tone="danger">Could not load the doctor's schedule.</Notice>
              ) : available.length === 0 ? (
                <Notice tone="warn">
                  No bookable times on this date. The doctor's working hours are set under Users.
                </Notice>
              ) : (
                <div className="slot-grid">
                  {available.map((s) => (
                    <button
                      key={s.time}
                      type="button"
                      className={`slot ${time === s.time ? 'selected' : ''}`}
                      disabled={!s.available}
                      aria-pressed={time === s.time}
                      title={s.available ? `${fmtClock(s.time)} to ${fmtClock(s.endTime)}` : 'Booked'}
                      onClick={() => setTime(s.time)}
                    >
                      {fmtClock(s.time)}
                    </button>
                  ))}
                </div>
              )
            }
          </Field>
        </div>
        {!rescheduling && (
          <TextArea label="Notes" fieldClassName="span-all" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        )}
      </div>
    </Modal>
  );
}
