import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { api } from '../services/api';
import { useDebounce } from '../hooks/useDebounce';
import { useDoctors } from '../hooks/queries';
import { doctorName, patientLine } from '../utils/format';
import type { Patient } from '../types';
import { Button, Field, SelectInput } from './ui';

export function usePatientSearch(term: string, limit = 8) {
  const q = useDebounce(term.trim(), 250);
  return useQuery({
    queryKey: ['patients', 'search', q, limit],
    queryFn: () => api.page<Patient>('/patients', { q, limit }).then((r) => r.data),
    enabled: q.length >= 2,
    staleTime: 15_000,
  });
}

export function PatientSummary({ patient }: { patient: Patient }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="cell-title">{patient.fullName}</div>
      <div className="cell-sub">
        <span className="mono">{patient.uhid}</span> · {patientLine(patient)} · {patient.phone}
      </div>
    </div>
  );
}

/** Search by name, phone or UHID and pick one patient. */
export function PatientPicker({
  value,
  onChange,
  label = 'Patient',
  required,
  error,
  autoFocus,
}: {
  value: Patient | null;
  onChange: (patient: Patient | null) => void;
  label?: string;
  required?: boolean;
  error?: string;
  autoFocus?: boolean;
}) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const results = usePatientSearch(term);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  if (value) {
    return (
      <Field label={label} required={required} error={error}>
        {() => (
          <div className="patient-chip">
            <PatientSummary patient={value} />
            <Button size="sm" variant="ghost" iconOnly aria-label="Change patient" icon={<X size={14} />} onClick={() => onChange(null)} />
          </div>
        )}
      </Field>
    );
  }

  return (
    <Field label={label} required={required} error={error} hint="Search by name, phone number or UHID">
      {(id) => (
        <div className="input-group" ref={wrapper}>
          <Search size={15} />
          <input
            id={id}
            className="input"
            autoComplete="off"
            autoFocus={autoFocus}
            value={term}
            aria-invalid={error ? true : undefined}
            placeholder="Type at least 2 characters"
            onChange={(e) => {
              setTerm(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
          {open && term.trim().length >= 2 && (
            <div className="search-results" role="listbox">
              {results.isLoading && <div className="list-item muted">Searching</div>}
              {results.data?.length === 0 && <div className="list-item muted">No matching patients</div>}
              {results.data?.map((p) => (
                <div
                  key={p.id}
                  role="option"
                  aria-selected={false}
                  className="list-item clickable"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(p);
                    setTerm('');
                    setOpen(false);
                  }}
                >
                  <PatientSummary patient={p} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Field>
  );
}

export function DoctorSelect({
  value,
  onChange,
  label = 'Doctor',
  required,
  error,
  placeholder = 'Select doctor',
  allowAll,
}: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
  required?: boolean;
  error?: string;
  placeholder?: string;
  allowAll?: boolean;
}) {
  const doctors = useDoctors();
  const options = (doctors.data ?? []).map((d) => ({
    value: d.id,
    label: `${doctorName(d)} (${d.specialization})`,
  }));
  return (
    <SelectInput
      label={label}
      required={required}
      error={error}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={allowAll ? 'All doctors' : placeholder}
      options={options}
      disabled={doctors.isLoading}
    />
  );
}
