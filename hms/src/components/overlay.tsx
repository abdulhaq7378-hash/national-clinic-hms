import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button, TextArea } from './ui';

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
}

interface ModalProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  variant?: 'modal' | 'drawer';
  /** When provided, the body is wrapped in a form and Enter submits it. */
  onSubmit?: () => void;
}

export function Modal({ open, title, onClose, children, footer, wide, variant = 'modal', onSubmit }: ModalProps) {
  if (!open) return null;
  return <ModalInner {...{ title, onClose, children, footer, wide, variant, onSubmit }} />;
}

function ModalInner({ title, onClose, children, footer, wide, variant, onSubmit }: Omit<ModalProps, 'open'>) {
  useEscape(onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([aria-label="Close"])');
    first?.focus();
    return () => previous?.focus();
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit?.();
  };

  const body = (
    <>
      <div className="modal-header">
        <h2>{title}</h2>
        <Button variant="ghost" size="sm" iconOnly aria-label="Close" onClick={onClose} icon={<X size={16} />} />
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </>
  );

  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={variant === 'drawer' ? 'drawer' : `modal ${wide ? 'wide' : ''}`}
      >
        {onSubmit ? (
          <form onSubmit={handleSubmit} style={{ display: 'contents' }} noValidate>
            {body}
          </form>
        ) : (
          body
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Confirmation dialog, optionally asking for a reason that is stored with the action. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  requireReason,
  reasonLabel = 'Reason',
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  loading?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  const disabled = requireReason && !reason.trim();
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      onSubmit={() => !disabled && onConfirm(reason.trim())}
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={disabled} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        {message && <div>{message}</div>}
        {requireReason && (
          <TextArea label={reasonLabel} required value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        )}
      </div>
    </Modal>
  );
}
