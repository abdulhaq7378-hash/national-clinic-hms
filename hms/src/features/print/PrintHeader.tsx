import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { useSettings } from '../../hooks/queries';
import { Button } from '../../components/ui';

/** Letterhead built from the hospital settings. */
export function PrintHeader({ right }: { right?: ReactNode }) {
  const settings = useSettings();
  const h = settings.data?.hospital;
  const address = [h?.addressLine, h?.city, h?.state, h?.pincode].filter(Boolean).join(', ');
  return (
    <div className="print-header">
      <div>
        <div className="print-hospital">{h?.name ?? 'National Clinic'}</div>
        {address && <div>{address}</div>}
        <div className="small muted">
          {[h?.phone && `Phone ${h.phone}`, h?.email, h?.registrationNumber && `Reg. No. ${h.registrationNumber}`, h?.gstin && `GSTIN ${h.gstin}`]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
      {right && <div style={{ textAlign: 'right' }}>{right}</div>}
    </div>
  );
}

export function PrintToolbar({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="print-toolbar no-print">
      <Button icon={<ArrowLeft size={14} />} onClick={() => navigate(-1)}>
        Back
      </Button>
      <div className="row">
        {children}
        <Button variant="primary" icon={<Printer size={14} />} onClick={() => window.print()}>
          Print
        </Button>
      </div>
    </div>
  );
}
