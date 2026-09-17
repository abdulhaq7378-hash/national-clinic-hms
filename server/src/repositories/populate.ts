/** Populate options that resolve a Doctor reference to its display name. */
export function doctorPopulate(path: string) {
  return {
    path,
    select: 'user specialization department qualification registrationNumber',
    populate: { path: 'user', select: 'name' },
  };
}

export const patientPopulate = {
  path: 'patient',
  select: 'uhid fullName gender dateOfBirth phone',
};

export const userNamePopulate = (path: string) => ({ path, select: 'name role' });

interface PopulatedDoctor {
  _id: unknown;
  specialization?: string;
  user?: { name?: string } | null;
}

/** Flattens a populated doctor into `{ id, name, specialization }`. */
export function doctorSummary(doctor: unknown) {
  if (!doctor || typeof doctor !== 'object' || !('user' in doctor)) return null;
  const d = doctor as PopulatedDoctor;
  return { id: String(d._id), name: d.user?.name ?? 'Unknown', specialization: d.specialization };
}
