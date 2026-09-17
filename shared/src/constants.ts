export const HOSPITAL_TIMEZONE = 'Asia/Kolkata';

export const GENDERS = ['male', 'female', 'other'] as const;
export type Gender = (typeof GENDERS)[number];

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export const MARITAL_STATUSES = ['single', 'married', 'widowed', 'divorced', 'unknown'] as const;

export const MEDICAL_HISTORY_TYPES = [
  'condition',
  'allergy',
  'surgery',
  'medication',
  'family',
  'social',
  'immunization',
  'note',
] as const;
export type MedicalHistoryType = (typeof MEDICAL_HISTORY_TYPES)[number];

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'checked_in',
  'in_consultation',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Statuses that still hold the doctor's time slot. */
export const APPOINTMENT_ACTIVE_STATUSES: AppointmentStatus[] = [
  'scheduled',
  'confirmed',
  'checked_in',
  'in_consultation',
  'completed',
];

/** Allowed manual transitions. Check-in and consultation transitions happen through their own workflows. */
export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ['confirmed', 'checked_in', 'cancelled', 'no_show'],
  confirmed: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['in_consultation', 'cancelled'],
  in_consultation: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
};

export const APPOINTMENT_TYPES = ['new', 'follow_up', 'review', 'procedure'] as const;
export const APPOINTMENT_SOURCES = ['reception', 'phone', 'website', 'doctor'] as const;

export const TOKEN_STATUSES = ['waiting', 'with_doctor', 'completed', 'skipped', 'cancelled'] as const;
export type TokenStatus = (typeof TOKEN_STATUSES)[number];
export const VISIT_TYPES = ['appointment', 'walk_in'] as const;

export const CONSULTATION_STATUSES = ['draft', 'completed'] as const;
export const DIAGNOSIS_TYPES = ['provisional', 'final'] as const;

export const PRESCRIPTION_STATUSES = ['active', 'partially_dispensed', 'dispensed', 'cancelled'] as const;
export type PrescriptionStatus = (typeof PRESCRIPTION_STATUSES)[number];

export const MEDICINE_ROUTES = [
  'oral',
  'sublingual',
  'topical',
  'inhalation',
  'intravenous',
  'intramuscular',
  'subcutaneous',
  'rectal',
  'ophthalmic',
  'otic',
  'nasal',
  'other',
] as const;

export const DURATION_UNITS = ['days', 'weeks', 'months'] as const;

export const REFERRAL_STATUSES = ['created', 'sent', 'accepted', 'completed', 'cancelled'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];
export const REFERRAL_TRANSITIONS: Record<ReferralStatus, ReferralStatus[]> = {
  created: ['sent', 'cancelled'],
  sent: ['accepted', 'cancelled'],
  accepted: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};
export const PRIORITIES = ['routine', 'urgent', 'emergency'] as const;

export const SERVICE_CATEGORIES = ['consultation', 'procedure', 'room', 'lab', 'pharmacy', 'other'] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const INVOICE_STATUSES = ['unpaid', 'partially_paid', 'paid', 'refunded', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ['cash', 'card', 'upi', 'bank_transfer', 'insurance', 'other'] as const;
export const PAYMENT_TYPES = ['payment', 'refund'] as const;

export const INVENTORY_TX_TYPES = ['stock_in', 'dispense', 'adjustment', 'return', 'write_off'] as const;
export type InventoryTxType = (typeof INVENTORY_TX_TYPES)[number];

export const MEDICINE_FORMS = [
  'tablet',
  'capsule',
  'syrup',
  'suspension',
  'injection',
  'ointment',
  'cream',
  'drops',
  'inhaler',
  'powder',
  'gel',
  'other',
] as const;

export const LAB_ORDER_STATUSES = [
  'ordered',
  'sample_collected',
  'processing',
  'result_entered',
  'verified',
  'released',
  'cancelled',
] as const;
export type LabOrderStatus = (typeof LAB_ORDER_STATUSES)[number];
export const LAB_TRANSITIONS: Record<LabOrderStatus, LabOrderStatus[]> = {
  ordered: ['sample_collected', 'cancelled'],
  sample_collected: ['processing', 'cancelled'],
  processing: ['result_entered'],
  result_entered: ['verified', 'result_entered'],
  verified: ['released', 'result_entered'],
  released: [],
  cancelled: [],
};
export const SAMPLE_TYPES = ['blood', 'serum', 'plasma', 'urine', 'stool', 'sputum', 'swab', 'csf', 'other'] as const;
export const RESULT_FLAGS = ['normal', 'low', 'high', 'abnormal'] as const;

export const WARD_TYPES = ['general', 'private', 'semi_private', 'icu', 'day_care', 'other'] as const;
export const BED_STATUSES = ['available', 'occupied', 'reserved', 'cleaning', 'maintenance'] as const;
export type BedStatus = (typeof BED_STATUSES)[number];
/** Statuses staff may set directly. "occupied" is only set by admitting a patient. */
export const BED_MANUAL_STATUSES: BedStatus[] = ['available', 'reserved', 'cleaning', 'maintenance'];

export const ADMISSION_STATUSES = ['admitted', 'discharged'] as const;

export const OT_STATUSES = ['scheduled', 'pre_op', 'in_progress', 'completed', 'postponed', 'cancelled'] as const;
export type OtStatus = (typeof OT_STATUSES)[number];
export const OT_TRANSITIONS: Record<OtStatus, OtStatus[]> = {
  scheduled: ['pre_op', 'postponed', 'cancelled'],
  pre_op: ['in_progress', 'postponed', 'cancelled'],
  in_progress: ['completed'],
  completed: [],
  postponed: ['scheduled', 'cancelled'],
  cancelled: [],
};

export const TOKEN_RESET_POLICIES = ['daily', 'session'] as const;

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Human readable labels for snake_case enum values. */
export function formatEnum(value: string | null | undefined): string {
  if (!value) return '';
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Server-sent event names shared by server and client. */
export const REALTIME_EVENTS = {
  appointmentChanged: 'appointment.changed',
  queueChanged: 'queue.changed',
  labOrderChanged: 'lab.changed',
  prescriptionChanged: 'prescription.changed',
  bedChanged: 'bed.changed',
  notification: 'notification',
} as const;
