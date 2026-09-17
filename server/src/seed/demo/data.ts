/**
 * DEVELOPMENT DEMO DATA ONLY.
 *
 * Everything in this folder exists so the system can be explored locally.
 * Names are deliberately labelled "Demo", phone numbers are not real, and
 * prices are placeholders. None of it is loaded into a production database.
 */

export const DEMO_EMAIL_DOMAIN = 'demo.nationalclinic.local';

export const DEMO_USERS = [
  { key: 'admin', name: 'Demo Administrator', role: 'admin', designation: 'System administrator' },
  { key: 'doctor1', name: 'Demo Doctor One', role: 'doctor', designation: 'Consultant physician' },
  { key: 'doctor2', name: 'Demo Doctor Two', role: 'doctor', designation: 'Physician' },
  { key: 'reception', name: 'Demo Receptionist', role: 'receptionist', designation: 'Front desk' },
  { key: 'nurse', name: 'Demo Nurse', role: 'nurse', designation: 'Staff nurse' },
  { key: 'pharmacy', name: 'Demo Pharmacist', role: 'pharmacist', designation: 'Pharmacist' },
  { key: 'lab', name: 'Demo Lab Technician', role: 'lab_staff', designation: 'Lab technician' },
  { key: 'billing', name: 'Demo Billing Officer', role: 'billing_staff', designation: 'Billing' },
  { key: 'management', name: 'Demo Manager', role: 'management', designation: 'Hospital management' },
] as const;

export const DEMO_SERVICES = [
  { code: 'CONS-GEN', name: 'General consultation', category: 'consultation', price: 300 },
  { code: 'CONS-FU', name: 'Follow-up consultation', category: 'consultation', price: 150 },
  { code: 'ROOM-PVT', name: 'Private room (per day)', category: 'room', price: 2000 },
  { code: 'ROOM-GEN', name: 'General ward bed (per day)', category: 'room', price: 600 },
  { code: 'PROC-DRS', name: 'Wound dressing', category: 'procedure', price: 200 },
  { code: 'PROC-INJ', name: 'Injection administration', category: 'procedure', price: 50 },
  { code: 'PROC-ECG', name: 'ECG', category: 'procedure', price: 250 },
  { code: 'OTH-CERT', name: 'Medical certificate', category: 'other', price: 100 },
] as const;

export const DEMO_MEDICINES = [
  { name: 'Paracetamol', genericName: 'Paracetamol', strength: '500 mg', form: 'tablet', unit: 'tablet', category: 'Analgesic', reorderLevel: 100, batches: [{ qty: 500, months: 18, cost: 0.8, mrp: 1.5 }] },
  { name: 'Amoxicillin', genericName: 'Amoxicillin', strength: '500 mg', form: 'capsule', unit: 'capsule', category: 'Antibiotic', reorderLevel: 60, batches: [{ qty: 200, months: 12, cost: 3.5, mrp: 6 }] },
  { name: 'Azithromycin', genericName: 'Azithromycin', strength: '500 mg', form: 'tablet', unit: 'tablet', category: 'Antibiotic', reorderLevel: 30, batches: [{ qty: 25, months: 10, cost: 12, mrp: 20 }] },
  { name: 'Cetirizine', genericName: 'Cetirizine', strength: '10 mg', form: 'tablet', unit: 'tablet', category: 'Antihistamine', reorderLevel: 50, batches: [{ qty: 300, months: 20, cost: 0.6, mrp: 1.2 }] },
  { name: 'Pantoprazole', genericName: 'Pantoprazole', strength: '40 mg', form: 'tablet', unit: 'tablet', category: 'Antacid', reorderLevel: 60, batches: [{ qty: 90, months: 2, cost: 2.5, mrp: 5 }, { qty: 150, months: 16, cost: 2.5, mrp: 5 }] },
  { name: 'Metformin', genericName: 'Metformin', strength: '500 mg', form: 'tablet', unit: 'tablet', category: 'Antidiabetic', reorderLevel: 100, batches: [{ qty: 400, months: 14, cost: 1, mrp: 2 }] },
  { name: 'Oral rehydration salts', genericName: 'ORS', strength: '21 g', form: 'powder', unit: 'sachet', category: 'Electrolyte', reorderLevel: 40, batches: [{ qty: 0, months: 0, cost: 0, mrp: 0 }] },
  { name: 'Ibuprofen', genericName: 'Ibuprofen', strength: '400 mg', form: 'tablet', unit: 'tablet', category: 'Analgesic', reorderLevel: 50, batches: [{ qty: 120, months: 15, cost: 1.2, mrp: 2.5 }] },
] as const;

// Reference ranges are typical adult values for demonstration and must be
// replaced with the ranges validated by the hospital laboratory.
export const DEMO_LAB_TESTS = [
  {
    code: 'CBC',
    name: 'Complete blood count',
    category: 'Haematology',
    sampleType: 'blood',
    price: 350,
    turnaroundHours: 6,
    parameters: [
      { name: 'Haemoglobin', unit: 'g/dL', referenceRange: 'M 13.0-17.0, F 12.0-15.0' },
      { name: 'Total WBC count', unit: 'cells/cumm', referenceRange: '4000-11000', refLow: 4000, refHigh: 11000 },
      { name: 'Platelet count', unit: 'lakh/cumm', referenceRange: '1.5-4.5', refLow: 1.5, refHigh: 4.5 },
    ],
  },
  {
    code: 'FBS',
    name: 'Blood sugar (fasting)',
    category: 'Biochemistry',
    sampleType: 'plasma',
    price: 80,
    turnaroundHours: 4,
    parameters: [{ name: 'Glucose, fasting', unit: 'mg/dL', referenceRange: '70-100', refLow: 70, refHigh: 100 }],
  },
  {
    code: 'CREAT',
    name: 'Serum creatinine',
    category: 'Biochemistry',
    sampleType: 'serum',
    price: 150,
    turnaroundHours: 6,
    parameters: [{ name: 'Creatinine', unit: 'mg/dL', referenceRange: '0.6-1.3', refLow: 0.6, refHigh: 1.3 }],
  },
  {
    code: 'URINE-R',
    name: 'Urine routine examination',
    category: 'Clinical pathology',
    sampleType: 'urine',
    price: 120,
    turnaroundHours: 4,
    parameters: [
      { name: 'Colour' },
      { name: 'Albumin' },
      { name: 'Sugar' },
      { name: 'Pus cells', unit: '/hpf', referenceRange: '0-5', refLow: 0, refHigh: 5 },
    ],
  },
] as const;

export const DEMO_PATIENTS = [
  { fullName: 'Demo Patient One', gender: 'male', dateOfBirth: '1978-03-12', phone: '9000000001', bloodGroup: 'B+' },
  { fullName: 'Demo Patient Two', gender: 'female', dateOfBirth: '1991-07-25', phone: '9000000002', bloodGroup: 'O+' },
  { fullName: 'Demo Patient Three', gender: 'female', dateOfBirth: '1965-11-02', phone: '9000000003', bloodGroup: 'A+' },
  { fullName: 'Demo Patient Four', gender: 'male', dateOfBirth: '2012-01-18', phone: '9000000004', bloodGroup: 'unknown' },
  { fullName: 'Demo Patient Five', gender: 'male', dateOfBirth: '1984-09-30', phone: '9000000005', bloodGroup: 'AB+' },
] as const;
