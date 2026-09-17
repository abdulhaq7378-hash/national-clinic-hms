import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BLOOD_GROUPS,
  GENDERS,
  MARITAL_STATUSES,
  patientCreateSchema,
  patientUpdateSchema,
  toHospitalDate,
} from '@hms/shared';
import { useToast } from '../../contexts/ToastContext';
import { api, ApiError } from '../../services/api';
import { Loading } from '../../components/data';
import { Button, enumOptions, Notice, PageHeader, Panel, SelectInput, Segmented, TextArea, TextInput } from '../../components/ui';
import { patientLine } from '../../utils/format';
import type { Patient } from '../../types';

interface FormState {
  fullName: string;
  dobMode: 'dob' | 'age';
  dateOfBirth: string;
  ageYears: string;
  gender: string;
  phone: string;
  alternatePhone: string;
  email: string;
  bloodGroup: string;
  maritalStatus: string;
  occupation: string;
  guardianName: string;
  addressLine: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
  ecName: string;
  ecRelation: string;
  ecPhone: string;
  notes: string;
}

const EMPTY: FormState = {
  fullName: '',
  dobMode: 'dob',
  dateOfBirth: '',
  ageYears: '',
  gender: '',
  phone: '',
  alternatePhone: '',
  email: '',
  bloodGroup: 'unknown',
  maritalStatus: 'unknown',
  occupation: '',
  guardianName: '',
  addressLine: '',
  city: 'Aurangabad',
  district: '',
  state: 'Maharashtra',
  pincode: '',
  ecName: '',
  ecRelation: '',
  ecPhone: '',
  notes: '',
};

function fromPatient(p: Patient): FormState {
  return {
    ...EMPTY,
    fullName: p.fullName,
    dobMode: p.dobEstimated ? 'age' : 'dob',
    dateOfBirth: p.dobEstimated ? '' : p.dateOfBirth.slice(0, 10),
    ageYears: p.dobEstimated && p.age != null ? String(p.age) : '',
    gender: p.gender,
    phone: p.phone,
    alternatePhone: p.alternatePhone ?? '',
    email: p.email ?? '',
    bloodGroup: p.bloodGroup ?? 'unknown',
    maritalStatus: p.maritalStatus ?? 'unknown',
    occupation: p.occupation ?? '',
    guardianName: p.guardianName ?? '',
    addressLine: p.address?.line ?? '',
    city: p.address?.city ?? '',
    district: p.address?.district ?? '',
    state: p.address?.state ?? '',
    pincode: p.address?.pincode ?? '',
    ecName: p.emergencyContact?.name ?? '',
    ecRelation: p.emergencyContact?.relation ?? '',
    ecPhone: p.emergencyContact?.phone ?? '',
    notes: p.notes ?? '',
  };
}

function toPayload(f: FormState) {
  return {
    fullName: f.fullName,
    ...(f.dobMode === 'dob'
      ? { dateOfBirth: f.dateOfBirth || undefined }
      : { ageYears: f.ageYears === '' ? undefined : Number(f.ageYears) }),
    gender: f.gender || undefined,
    phone: f.phone.replace(/\s/g, ''),
    alternatePhone: f.alternatePhone.replace(/\s/g, ''),
    email: f.email,
    bloodGroup: f.bloodGroup,
    maritalStatus: f.maritalStatus,
    occupation: f.occupation,
    guardianName: f.guardianName,
    notes: f.notes,
    address: { line: f.addressLine, city: f.city, district: f.district, state: f.state, pincode: f.pincode },
    emergencyContact: { name: f.ecName, relation: f.ecRelation, phone: f.ecPhone.replace(/\s/g, '') },
  };
}

/** Maps schema paths such as "address.pincode" to form field names. */
const PATH_TO_FIELD: Record<string, keyof FormState> = {
  'address.line': 'addressLine',
  'address.city': 'city',
  'address.district': 'district',
  'address.state': 'state',
  'address.pincode': 'pincode',
  'emergencyContact.name': 'ecName',
  'emergencyContact.relation': 'ecRelation',
  'emergencyContact.phone': 'ecPhone',
};

export default function PatientFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState<{ patientId: string; uhid: string } | null>(null);

  const existing = useQuery({
    queryKey: ['patients', id],
    queryFn: () => api.get<Patient>(`/patients/${id}`),
    enabled: editing,
  });
  useEffect(() => {
    if (existing.data) setForm(fromPatient(existing.data));
  }, [existing.data]);

  const phone = form.phone.replace(/\s/g, '');
  const matches = useQuery({
    queryKey: ['patients', 'duplicates', phone],
    queryFn: () => api.get<Patient[]>('/patients/duplicates', { phone, name: form.fullName }),
    enabled: !editing && /^\+?\d{10,13}$/.test(phone),
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = async () => {
    const payload = toPayload(form);
    const schema = editing ? patientUpdateSchema : patientCreateSchema;
    const parsed = schema.safeParse(payload);
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.');
        const field = PATH_TO_FIELD[path] ?? (path === 'ageYears' ? 'ageYears' : (path as keyof FormState));
        next[form.dobMode === 'age' && field === 'dateOfBirth' ? 'ageYears' : field] ??= issue.message;
      }
    }
    if (!form.gender) next.gender = 'Select a gender';
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    setDuplicate(null);
    try {
      const saved = editing
        ? await api.patch<Patient>(`/patients/${id}`, payload)
        : await api.post<Patient>('/patients', payload);
      await queryClient.invalidateQueries({ queryKey: ['patients'] });
      toast.success(editing ? 'Patient details updated' : `Registered ${saved.fullName} (${saved.uhid})`);
      navigate(`/patients/${saved.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.details) {
        setDuplicate(err.details as { patientId: string; uhid: string });
      } else if (err instanceof ApiError && err.status === 400) {
        const fieldErrors = err.fieldErrors();
        setErrors(
          Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [PATH_TO_FIELD[k] ?? k, v])) as typeof errors,
        );
        toast.error(err);
      } else {
        toast.error(err);
      }
    } finally {
      setSaving(false);
    }
  };

  if (editing && existing.isLoading) return <Loading />;

  return (
    <>
      <PageHeader
        title={editing ? `Edit ${existing.data?.fullName ?? 'patient'}` : 'Register patient'}
        description={editing ? <span className="mono">{existing.data?.uhid}</span> : 'A UHID is assigned automatically.'}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
      >
        <div className="grid grid-sidebar">
          <Panel
            footer={
              <>
                <Button onClick={() => navigate(-1)}>Cancel</Button>
                <Button type="submit" variant="primary" loading={saving}>
                  {editing ? 'Save changes' : 'Register patient'}
                </Button>
              </>
            }
          >
            <div className="form-grid">
              {duplicate && (
                <div className="span-all">
                  <Notice tone="warn">
                    This patient is already registered as{' '}
                    <Link to={`/patients/${duplicate.patientId}`}>{duplicate.uhid}</Link>. Use the existing record.
                  </Notice>
                </div>
              )}
              <div className="form-section-title">Identity</div>
              <TextInput
                label="Full name"
                required
                autoFocus
                fieldClassName="span-all"
                value={form.fullName}
                error={errors.fullName}
                onChange={(e) => set('fullName', e.target.value)}
              />
              <div className="field">
                <span className="field-label">
                  Date of birth or age<span className="req">*</span>
                </span>
                <Segmented
                  value={form.dobMode}
                  onChange={(v) => set('dobMode', v)}
                  options={[
                    { value: 'dob', label: 'Date of birth' },
                    { value: 'age', label: 'Age only' },
                  ]}
                />
              </div>
              {form.dobMode === 'dob' ? (
                <TextInput
                  label="Date of birth"
                  type="date"
                  max={toHospitalDate()}
                  value={form.dateOfBirth}
                  error={errors.dateOfBirth}
                  onChange={(e) => set('dateOfBirth', e.target.value)}
                />
              ) : (
                <TextInput
                  label="Age in years"
                  type="number"
                  min={0}
                  max={130}
                  value={form.ageYears}
                  error={errors.ageYears ?? errors.dateOfBirth}
                  hint="Recorded as an approximate date of birth"
                  onChange={(e) => set('ageYears', e.target.value)}
                />
              )}
              <SelectInput
                label="Gender"
                required
                value={form.gender}
                error={errors.gender}
                placeholder="Select"
                options={enumOptions(GENDERS)}
                onChange={(e) => set('gender', e.target.value)}
              />
              <SelectInput
                label="Blood group"
                value={form.bloodGroup}
                options={BLOOD_GROUPS.map((b) => ({ value: b, label: b === 'unknown' ? 'Not known' : b }))}
                onChange={(e) => set('bloodGroup', e.target.value)}
              />
              <SelectInput
                label="Marital status"
                value={form.maritalStatus}
                options={enumOptions(MARITAL_STATUSES).map((o) => (o.value === 'unknown' ? { ...o, label: 'Not recorded' } : o))}
                onChange={(e) => set('maritalStatus', e.target.value)}
              />
              <TextInput label="Occupation" value={form.occupation} onChange={(e) => set('occupation', e.target.value)} />
              <TextInput
                label="Guardian name"
                hint="For minors or dependent patients"
                value={form.guardianName}
                onChange={(e) => set('guardianName', e.target.value)}
              />

              <div className="form-section-title">Contact</div>
              <TextInput
                label="Mobile number"
                required
                type="tel"
                inputMode="tel"
                value={form.phone}
                error={errors.phone}
                onChange={(e) => set('phone', e.target.value)}
              />
              <TextInput
                label="Alternate phone"
                type="tel"
                value={form.alternatePhone}
                error={errors.alternatePhone}
                onChange={(e) => set('alternatePhone', e.target.value)}
              />
              <TextInput
                label="Email"
                type="email"
                fieldClassName="span-all"
                value={form.email}
                error={errors.email}
                onChange={(e) => set('email', e.target.value)}
              />
              <TextInput
                label="Address"
                fieldClassName="span-all"
                value={form.addressLine}
                onChange={(e) => set('addressLine', e.target.value)}
              />
              <TextInput label="City / village" value={form.city} onChange={(e) => set('city', e.target.value)} />
              <TextInput label="District" value={form.district} onChange={(e) => set('district', e.target.value)} />
              <TextInput label="State" value={form.state} onChange={(e) => set('state', e.target.value)} />
              <TextInput
                label="PIN code"
                inputMode="numeric"
                maxLength={6}
                value={form.pincode}
                error={errors.pincode}
                onChange={(e) => set('pincode', e.target.value)}
              />

              <div className="form-section-title">Emergency contact</div>
              <TextInput label="Name" value={form.ecName} onChange={(e) => set('ecName', e.target.value)} />
              <TextInput label="Relation" value={form.ecRelation} onChange={(e) => set('ecRelation', e.target.value)} />
              <TextInput
                label="Phone"
                type="tel"
                value={form.ecPhone}
                error={errors.ecPhone}
                onChange={(e) => set('ecPhone', e.target.value)}
              />
              <TextArea
                label="Administrative notes"
                hint="Not for clinical information"
                fieldClassName="span-all"
                rows={2}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </div>
          </Panel>

          {!editing && (
            <Panel title="Records with this phone number">
              {!matches.data?.length ? (
                <p className="muted small">
                  Enter the mobile number to check for existing registrations before creating a new record.
                </p>
              ) : (
                <div className="stack-sm">
                  <Notice tone="warn">Check whether the patient is already registered.</Notice>
                  {matches.data.map((p) => (
                    <Link key={p.id} to={`/patients/${p.id}`} className="patient-chip" style={{ color: 'inherit' }}>
                      <div>
                        <div className="cell-title">{p.fullName}</div>
                        <div className="cell-sub">
                          <span className="mono">{p.uhid}</span> · {patientLine(p)}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>
          )}
        </div>
      </form>
    </>
  );
}
