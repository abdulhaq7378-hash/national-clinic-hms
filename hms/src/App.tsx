import { lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Permission } from '@hms/shared';
import { useAuth } from './contexts/AuthContext';
import { AppLayout } from './layouts/AppLayout';
import { EmptyState, Loading } from './components/data';
import { LinkButton } from './components/ui';
import { LoginPage } from './pages/LoginPage';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const PatientListPage = lazy(() => import('./pages/patients/PatientListPage'));
const PatientFormPage = lazy(() => import('./pages/patients/PatientFormPage'));
const PatientProfilePage = lazy(() => import('./pages/patients/PatientProfilePage'));
const AppointmentsPage = lazy(() => import('./pages/AppointmentsPage'));
const ReceptionPage = lazy(() => import('./pages/ReceptionPage'));
const ConsultationsPage = lazy(() => import('./pages/consultations/ConsultationsPage'));
const ConsultationWorkspace = lazy(() => import('./pages/consultations/ConsultationWorkspace'));
const PrescriptionsPage = lazy(() => import('./pages/prescriptions/PrescriptionsPage'));
const PrescriptionPrintPage = lazy(() => import('./pages/prescriptions/PrescriptionPrintPage'));
const ReferralsPage = lazy(() => import('./pages/ReferralsPage'));
const BillingPage = lazy(() => import('./pages/billing/BillingPage'));
const NewInvoicePage = lazy(() => import('./pages/billing/NewInvoicePage'));
const InvoicePage = lazy(() => import('./pages/billing/InvoicePage'));
const PharmacyPage = lazy(() => import('./pages/pharmacy/PharmacyPage'));
const MedicinePage = lazy(() => import('./pages/pharmacy/MedicinePage'));
const DispensePage = lazy(() => import('./pages/pharmacy/DispensePage'));
const LaboratoryPage = lazy(() => import('./pages/laboratory/LaboratoryPage'));
const LabOrderPage = lazy(() => import('./pages/laboratory/LabOrderPage'));
const BedsPage = lazy(() => import('./pages/beds/BedsPage'));
const AdmissionPage = lazy(() => import('./pages/beds/AdmissionPage'));
const OtPage = lazy(() => import('./pages/OtPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const UsersPage = lazy(() => import('./pages/admin/UsersPage'));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage'));
const AuditPage = lazy(() => import('./pages/admin/AuditPage'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading label="Checking session" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

/** Hides pages the user cannot use. The API enforces the same rules independently. */
function Guard({ anyOf, children }: { anyOf: Permission[]; children: ReactNode }) {
  const { canAny } = useAuth();
  if (!canAny(...anyOf)) {
    return (
      <EmptyState title="You do not have access to this page">
        <p>Ask an administrator if your role should include it.</p>
        <div style={{ marginTop: 12 }}>
          <LinkButton to="/">Go to dashboard</LinkButton>
        </div>
      </EmptyState>
    );
  }
  return <>{children}</>;
}

const guarded = (anyOf: Permission[], element: ReactNode) => <Guard anyOf={anyOf}>{element}</Guard>;

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="patients" element={guarded(['patient:read'], <PatientListPage />)} />
        <Route path="patients/new" element={guarded(['patient:create'], <PatientFormPage />)} />
        <Route path="patients/:id" element={guarded(['patient:read'], <PatientProfilePage />)} />
        <Route path="patients/:id/edit" element={guarded(['patient:update'], <PatientFormPage />)} />
        <Route path="appointments" element={guarded(['appointment:read'], <AppointmentsPage />)} />
        <Route path="reception" element={guarded(['queue:read'], <ReceptionPage />)} />
        <Route path="consultations" element={guarded(['consultation:read'], <ConsultationsPage />)} />
        <Route path="consultations/:id" element={guarded(['consultation:read'], <ConsultationWorkspace />)} />
        <Route path="prescriptions" element={guarded(['prescription:read'], <PrescriptionsPage />)} />
        <Route path="prescriptions/:id/print" element={guarded(['prescription:read'], <PrescriptionPrintPage />)} />
        <Route path="referrals" element={guarded(['referral:read'], <ReferralsPage />)} />
        <Route path="billing" element={guarded(['billing:read'], <BillingPage />)} />
        <Route path="billing/new" element={guarded(['billing:manage'], <NewInvoicePage />)} />
        <Route path="billing/invoices/:id" element={guarded(['billing:read'], <InvoicePage />)} />
        <Route path="pharmacy" element={guarded(['pharmacy:read'], <PharmacyPage />)} />
        <Route path="pharmacy/medicines/:id" element={guarded(['pharmacy:read'], <MedicinePage />)} />
        <Route path="pharmacy/dispense" element={guarded(['pharmacy:dispense'], <DispensePage />)} />
        <Route path="laboratory" element={guarded(['lab:read'], <LaboratoryPage />)} />
        <Route path="laboratory/orders/:id" element={guarded(['lab:read'], <LabOrderPage />)} />
        <Route path="beds" element={guarded(['bed:read'], <BedsPage />)} />
        <Route path="beds/admissions/:id" element={guarded(['bed:read'], <AdmissionPage />)} />
        <Route path="ot" element={guarded(['ot:read', 'settings:manage'], <OtPage />)} />
        <Route path="reports" element={guarded(['report:read'], <ReportsPage />)} />
        <Route path="analytics" element={guarded(['analytics:read'], <AnalyticsPage />)} />
        <Route path="users" element={guarded(['user:read'], <UsersPage />)} />
        <Route
          path="settings"
          element={guarded(['settings:manage', 'service:manage', 'lab:catalog', 'ward:configure'], <SettingsPage />)}
        />
        <Route path="audit" element={guarded(['audit:read'], <AuditPage />)} />
        <Route
          path="*"
          element={
            <EmptyState title="Page not found">
              <div style={{ marginTop: 12 }}>
                <LinkButton to="/">Go to dashboard</LinkButton>
              </div>
            </EmptyState>
          }
        />
      </Route>
    </Routes>
  );
}
