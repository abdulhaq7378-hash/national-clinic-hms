import type { Permission, Role } from '@hms/shared';

/** Shapes returned by the API. Only fields used by the UI are listed. */

export interface Ref {
  id: string;
  _id?: string;
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  designation?: string;
  permissions: Permission[];
  doctorId?: string;
}

export interface UserRef {
  _id?: string;
  id?: string;
  name: string;
  role?: string;
}

export interface Patient extends Ref {
  uhid: string;
  fullName: string;
  dateOfBirth: string;
  dobEstimated?: boolean;
  age?: number | null;
  gender: string;
  phone: string;
  alternatePhone?: string;
  email?: string;
  address?: { line?: string; city?: string; district?: string; state?: string; pincode?: string };
  emergencyContact?: { name?: string; relation?: string; phone?: string };
  bloodGroup?: string;
  maritalStatus?: string;
  occupation?: string;
  guardianName?: string;
  notes?: string;
  isActive?: boolean;
  createdAt?: string;
  clinicalAccess?: boolean;
  alerts?: { allergies: HistoryEntry[]; conditions: HistoryEntry[] } | null;
}

export interface Service extends Ref {
  code: string;
  name: string;
  category: string;
  price: number;
  taxRate: number;
  description?: string;
  isActive: boolean;
}

export interface Doctor extends Ref {
  user: { _id: string; id?: string; name: string; email?: string; phone?: string; isActive?: boolean };
  specialization: string;
  qualification?: string;
  registrationNumber?: string;
  department?: string;
  consultationService?: Service | null;
  followUpService?: Service | null;
  slotMinutes: number;
  availability: { day: string; start: string; end: string }[];
  isActive: boolean;
}

export interface StatusEntry {
  status: string;
  at: string;
  by?: UserRef;
  note?: string;
}

export interface Appointment extends Ref {
  patient: Patient;
  doctor: Doctor;
  date: string;
  startTime: string;
  endTime: string;
  type: string;
  source: string;
  status: string;
  notes?: string;
  token?: string;
  consultation?: string;
  statusHistory?: StatusEntry[];
  createdBy?: UserRef;
}

export interface Vitals {
  systolic?: number;
  diastolic?: number;
  pulse?: number;
  temperatureC?: number;
  spo2?: number;
  respiratoryRate?: number;
  weightKg?: number;
  heightCm?: number;
  bmi?: number;
  bloodSugar?: number;
}

export interface Token extends Ref {
  date: string;
  number: number;
  patient: Patient;
  doctor: Doctor;
  appointment?: { _id: string; startTime: string; type: string; status: string } | null;
  visitType: string;
  priority: string;
  status: string;
  checkedInAt: string;
  calledAt?: string;
  completedAt?: string;
  consultation?: { _id: string; status: string } | null;
  vitals?: Vitals;
  notes?: string;
}

export interface QueueData {
  date: string;
  summary: {
    lastIssued: number | null;
    nowServing: number[];
    waiting: number;
    withDoctor: number;
    completed: number;
    skipped: number;
    total: number;
  };
  waiting: Token[];
  withDoctor: Token[];
  completed: Token[];
  other: Token[];
}

export interface Diagnosis {
  description: string;
  code?: string;
  type: 'provisional' | 'final';
}

export interface Consultation extends Ref {
  patient: Patient;
  doctor: Doctor;
  appointment?: { _id: string; date: string; startTime: string; type: string } | null;
  token?: { _id: string; number: number; status: string } | null;
  status: 'draft' | 'completed';
  date: string;
  chiefComplaint?: string;
  symptoms: string[];
  historyOfPresentIllness?: string;
  vitals?: Vitals;
  examination?: string;
  diagnoses: Diagnosis[];
  clinicalNotes?: string;
  treatmentPlan?: string;
  advice?: string;
  followUpDate?: string;
  completedAt?: string;
  createdAt: string;
  addenda: { text: string; by?: UserRef; at: string }[];
}

export interface PrescriptionItem {
  _id: string;
  medicine?: string | null;
  medicineName: string;
  strength?: string;
  form: string;
  dose?: string;
  frequency: string;
  timing?: string;
  durationValue: number;
  durationUnit: string;
  route: string;
  instructions?: string;
  quantity?: number;
  dispensedQuantity: number;
}

export interface Prescription extends Ref {
  number: string;
  patient: Patient;
  doctor: Doctor;
  consultation?: Pick<Consultation, 'date' | 'chiefComplaint' | 'diagnoses' | 'vitals' | 'followUpDate' | 'advice'> & { _id: string };
  date: string;
  items: PrescriptionItem[];
  notes?: string;
  status: string;
  statusHistory?: StatusEntry[];
  createdAt: string;
}

export interface Referral extends Ref {
  number: string;
  patient: Patient;
  referringDoctor: Doctor;
  consultation?: { _id: string; date: string; chiefComplaint?: string; diagnoses: Diagnosis[] } | null;
  referredToDoctor?: string;
  specialty: string;
  hospital?: string;
  reason: string;
  clinicalNotes?: string;
  referralDate: string;
  priority: string;
  status: string;
  statusHistory?: StatusEntry[];
  createdAt: string;
}

export interface HistoryEntry extends Ref {
  type: string;
  title: string;
  details?: string;
  severity?: string | null;
  onsetDate?: string | null;
  status: string;
  recordedBy?: UserRef;
  amendments?: { status: string; reason: string; by?: UserRef; at: string }[];
  createdAt: string;
}

export interface TimelineEvent {
  at: string;
  kind: string;
  title: string;
  detail?: string;
  status?: string;
  refId: string;
  by?: string;
}

export interface Charge extends Ref {
  patient: Patient;
  service?: string;
  category: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  date: string;
  sourceKind: string;
  status: string;
  createdAt: string;
}

export interface InvoiceItem {
  _id: string;
  charge?: string;
  category: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  amount: number;
}

export interface Payment extends Ref {
  receiptNumber: string;
  type: 'payment' | 'refund';
  amount: number;
  method: string;
  reference?: string;
  note?: string;
  date: string;
  receivedBy?: UserRef;
  createdAt: string;
}

export interface Invoice extends Ref {
  invoiceNumber: string;
  patient: Patient;
  date: string;
  items: InvoiceItem[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  amountRefunded: number;
  balance: number;
  status: string;
  notes?: string;
  createdBy?: UserRef;
  cancelReason?: string;
  payments?: Payment[];
  createdAt: string;
}

export interface MedicineStock extends Ref {
  name: string;
  genericName?: string;
  brand?: string;
  manufacturer?: string;
  category?: string;
  form: string;
  strength?: string;
  unit: string;
  reorderLevel: number;
  hsnCode?: string;
  taxRate: number;
  isActive: boolean;
  stock: number;
  expiredStock?: number;
  nearestExpiry?: string | null;
  batchCount?: number;
}

export interface Batch extends Ref {
  medicine: string | { _id: string; name: string; strength?: string; unit?: string };
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  receivedQuantity: number;
  purchasePrice: number;
  sellingPrice: number;
  supplier?: string;
  supplierInvoice?: string;
  createdAt: string;
}

export interface InventoryTx extends Ref {
  medicine: { _id: string; name: string; strength?: string; unit?: string } | string;
  batch: { _id: string; batchNumber: string } | string;
  type: string;
  quantity: number;
  balanceAfter: number;
  unitPrice?: number;
  referenceNumber?: string;
  patient?: Patient | null;
  reason?: string;
  performedBy?: UserRef;
  createdAt: string;
}

export interface LabParameter {
  name: string;
  unit?: string;
  referenceRange?: string;
  refLow?: number;
  refHigh?: number;
}

export interface LabTest extends Ref {
  code: string;
  name: string;
  category?: string;
  sampleType: string;
  price: number;
  taxRate: number;
  turnaroundHours: number;
  parameters: LabParameter[];
  isActive: boolean;
}

export interface LabResultValue {
  parameter: string;
  value: string;
  unit?: string;
  referenceRange?: string;
  flag: string;
}

export interface LabOrder extends Ref {
  orderNumber: string;
  patient: Patient;
  doctor?: Doctor | null;
  orderedBy?: UserRef;
  date: string;
  priority: string;
  clinicalNotes?: string;
  status: string;
  items: {
    _id: string;
    testCode: string;
    testName: string;
    sampleType: string;
    parameters: LabParameter[];
    results: LabResultValue[];
    remarks?: string;
  }[];
  sampleCollectedAt?: string;
  sampleCollectedBy?: UserRef;
  resultEnteredAt?: string;
  resultEnteredBy?: UserRef;
  verifiedAt?: string;
  verifiedBy?: UserRef;
  releasedAt?: string;
  releasedBy?: UserRef;
  revisions?: { items: { testName: string; results: LabResultValue[] }[]; reason: string; by?: UserRef; at: string }[];
  statusHistory?: StatusEntry[];
  resultsHidden?: boolean;
  createdAt: string;
}

export interface Ward extends Ref {
  name: string;
  code: string;
  type: string;
  floor?: string;
  description?: string;
  isActive: boolean;
  rooms: { _id: string; id: string; number: string; ward: string }[];
}

export interface Bed extends Ref {
  code: string;
  ward: string;
  room?: string;
  type: string;
  status: string;
  statusNote?: string;
  statusChangedAt?: string;
  dailyService?: { _id: string; name: string; price: number } | null;
  currentAdmission?: {
    _id: string;
    admissionNumber: string;
    admittedAt: string;
    expectedDischargeDate?: string;
    patient: Patient;
    admittingDoctor: Doctor;
  } | null;
  notes?: string;
}

export interface BedBoard {
  summary: Record<'total' | 'available' | 'occupied' | 'reserved' | 'cleaning' | 'maintenance', number>;
  wards: (Omit<Ward, 'rooms'> & { rooms: { id: string; number: string }[]; beds: Bed[] })[];
}

export interface Admission extends Ref {
  admissionNumber: string;
  patient: Patient;
  bed: { _id: string; code: string; type: string; ward?: { name: string; code: string }; room?: { number: string } };
  admittingDoctor: Doctor;
  admittedAt: string;
  admittedBy?: UserRef;
  reason: string;
  provisionalDiagnosis?: string;
  expectedDischargeDate?: string;
  status: string;
  stays: { bed: string; bedCode: string; from: string; to?: string; reason?: string }[];
  dischargedAt?: string;
  dischargedBy?: UserRef;
  dischargeSummary?: {
    finalDiagnosis?: string;
    treatmentGiven?: string;
    conditionAtDischarge?: string;
    advice?: string;
    followUpDate?: string;
  };
}

export interface OtBooking extends Ref {
  bookingNumber: string;
  patient: Patient;
  admission?: { _id: string; admissionNumber: string } | null;
  procedureName: string;
  surgeon: Doctor;
  assistant?: string;
  anaesthetist?: string;
  anaesthesiaType?: string;
  theatre: string;
  scheduledStart: string;
  scheduledEnd: string;
  estimatedMinutes: number;
  priority: string;
  status: string;
  preOpNotes?: string;
  postOpNotes?: string;
  actualStart?: string;
  actualEnd?: string;
  statusHistory?: StatusEntry[];
}

export interface HospitalSettings {
  id: string;
  hospital: {
    name: string;
    shortName?: string;
    addressLine?: string;
    city?: string;
    state?: string;
    pincode?: string;
    phone?: string;
    email?: string;
    registrationNumber?: string;
    gstin?: string;
    establishedYear?: number;
  };
  opd: {
    sessions: { name: string; start: string; end: string }[];
    tokenReset: 'daily' | 'session';
    tokenPerDoctor: boolean;
    defaultSlotMinutes: number;
  };
  modules: { pharmacy: boolean; laboratory: boolean; beds: boolean; ot: boolean };
  ot: { theatres: string[] };
  billing: { invoicePrefix: string; invoiceFooter?: string };
  clinical: {
    restrictDoctorsToAssignedPatients: boolean;
    prescriptionFooter?: string;
    requireIndependentLabVerification: boolean;
  };
  pharmacy: { expiryAlertDays: number };
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  link?: string;
  severity: 'info' | 'warning' | 'critical';
  read: boolean;
  createdAt: string;
}

export interface AuditEntry extends Ref {
  at: string;
  userName?: string;
  role?: string;
  action: string;
  resource: string;
  resourceId?: string;
  patient?: { _id: string; uhid: string; fullName: string } | null;
  outcome: 'success' | 'failure';
  ip?: string;
  metadata?: Record<string, unknown>;
}

export interface StaffUser extends Ref {
  name: string;
  email: string;
  role: Role;
  phone?: string;
  designation?: string;
  isActive: boolean;
  lastLoginAt?: string;
  hasDoctorProfile?: boolean;
  createdAt: string;
}
