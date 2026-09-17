import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_METHODS } from '@hms/shared';
import { useAuth } from '../../contexts/AuthContext';
import { useAction, useSettings } from '../../hooks/queries';
import { api } from '../../services/api';
import { ErrorState, Loading, StatusBadge } from '../../components/data';
import { ConfirmDialog, Modal } from '../../components/overlay';
import { Button, enumOptions, SelectInput, TextInput } from '../../components/ui';
import { PrintHeader, PrintToolbar } from '../../features/print/PrintHeader';
import { ageLabel, fmtDate, fmtDateTime, formatEnum, money } from '../../utils/format';
import type { Invoice } from '../../types';

type Mode = 'payment' | 'refund' | null;

export default function InvoicePage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const settings = useSettings();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>(null);
  const [cancelling, setCancelling] = useState(false);
  const [form, setForm] = useState({ amount: '', method: 'cash', reference: '', note: '' });

  const query = useQuery({ queryKey: ['billing', 'invoice', id], queryFn: () => api.get<Invoice>(`/billing/invoices/${id}`) });
  const done = (inv: Invoice) => {
    queryClient.setQueryData(['billing', 'invoice', id], inv);
    void queryClient.invalidateQueries({ queryKey: ['billing'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    setMode(null);
    setCancelling(false);
  };
  const pay = useAction(
    () =>
      api.post<Invoice>(`/billing/invoices/${id}/${mode === 'refund' ? 'refunds' : 'payments'}`, {
        ...form,
        amount: Number(form.amount),
      }),
    { success: mode === 'refund' ? 'Refund recorded' : 'Payment recorded', onSuccess: done },
  );
  const cancel = useAction((reason: string) => api.post<Invoice>(`/billing/invoices/${id}/cancel`, { reason }), {
    success: 'Invoice cancelled',
    onSuccess: done,
  });

  if (query.isLoading) return <Loading />;
  if (query.error || !query.data) return <ErrorState error={query.error} />;
  const inv = query.data;
  const refundable = inv.amountPaid - inv.amountRefunded;
  const open = (m: Mode) => {
    setForm({ amount: String(m === 'refund' ? refundable : inv.balance), method: 'cash', reference: '', note: '' });
    setMode(m);
  };
  const amount = Number(form.amount);
  const limit = mode === 'refund' ? refundable : inv.balance;
  const amountInvalid = !(amount > 0) || amount > limit + 0.001;

  return (
    <>
      <PrintToolbar>
        <StatusBadge status={inv.status} />
        {can('billing:manage') && inv.balance > 0 && !['cancelled', 'refunded'].includes(inv.status) && (
          <Button variant="primary" onClick={() => open('payment')}>
            Record payment
          </Button>
        )}
        {can('billing:refund') && refundable > 0 && <Button onClick={() => open('refund')}>Refund</Button>}
        {can('billing:manage') && inv.amountPaid === 0 && inv.status !== 'cancelled' && (
          <Button variant="danger" onClick={() => setCancelling(true)}>
            Cancel invoice
          </Button>
        )}
      </PrintToolbar>

      <article className="print-page">
        <PrintHeader
          right={
            <>
              <div className="strong">Invoice {inv.invoiceNumber}</div>
              <div>Date: {fmtDate(inv.date)}</div>
            </>
          }
        />
        {inv.status === 'cancelled' && (
          <div className="notice danger" style={{ marginBottom: 12 }}>
            Cancelled: {inv.cancelReason}
          </div>
        )}
        <div className="row-between" style={{ marginBottom: 12 }}>
          <div>
            <div className="small muted">Billed to</div>
            <div className="strong">{inv.patient.fullName}</div>
            <div>
              UHID <span className="mono">{inv.patient.uhid}</span> · {ageLabel(inv.patient)} · {inv.patient.phone}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="small muted">Status</div>
            <div className="strong">{formatEnum(inv.status)}</div>
          </div>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Description</th>
              <th className="num">Qty</th>
              <th className="num">Rate</th>
              <th className="num">Discount</th>
              <th className="num">Tax</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((i, index) => (
              <tr key={i._id}>
                <td>{index + 1}</td>
                <td>
                  {i.description}
                  <div className="small muted">{formatEnum(i.category)}</div>
                </td>
                <td className="num">{i.quantity}</td>
                <td className="num">{money(i.unitPrice)}</td>
                <td className="num">{i.discount ? money(i.discount) : ''}</td>
                <td className="num">{i.taxAmount ? `${money(i.taxAmount)} (${i.taxRate}%)` : ''}</td>
                <td className="num">{money(i.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <table className="table" style={{ width: 300 }}>
            <tbody>
              <tr><td>Subtotal</td><td className="num">{money(inv.subtotal)}</td></tr>
              {inv.discountTotal > 0 && <tr><td>Discount</td><td className="num">- {money(inv.discountTotal)}</td></tr>}
              {inv.taxTotal > 0 && <tr><td>Tax</td><td className="num">{money(inv.taxTotal)}</td></tr>}
              <tr className="strong"><td>Total</td><td className="num">{money(inv.total)}</td></tr>
              <tr><td>Paid</td><td className="num">{money(inv.amountPaid)}</td></tr>
              {inv.amountRefunded > 0 && <tr><td>Refunded</td><td className="num">- {money(inv.amountRefunded)}</td></tr>}
              <tr className="strong"><td>Balance due</td><td className="num">{money(inv.balance)}</td></tr>
            </tbody>
          </table>
        </div>

        {inv.payments && inv.payments.length > 0 && (
          <>
            <h3 style={{ margin: '16px 0 6px' }}>Payments</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {inv.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.receiptNumber}</td>
                    <td>{fmtDateTime(p.createdAt)}</td>
                    <td>{formatEnum(p.type)}</td>
                    <td>{formatEnum(p.method)}</td>
                    <td>
                      {p.reference}
                      {p.note && <div className="small muted">{p.note}</div>}
                    </td>
                    <td className="num">{p.type === 'refund' ? `- ${money(p.amount)}` : money(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {inv.notes && <p style={{ marginTop: 12 }}>Notes: {inv.notes}</p>}
        <div className="print-footer">
          <div>{settings.data?.billing.invoiceFooter ?? 'This is a computer generated invoice.'}</div>
          <div className="signature">Authorised signatory</div>
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>
          Prepared by {inv.createdBy?.name}
        </div>
      </article>

      <Modal
        open={Boolean(mode)}
        title={mode === 'refund' ? 'Record refund' : 'Record payment'}
        onClose={() => setMode(null)}
        onSubmit={() => !amountInvalid && pay.mutate(undefined)}
        footer={
          <>
            <Button onClick={() => setMode(null)}>Cancel</Button>
            <Button
              type="submit"
              variant="primary"
              loading={pay.isPending}
              disabled={amountInvalid || (mode === 'refund' && !form.note.trim())}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <TextInput
            label="Amount"
            type="number"
            min={0}
            step="0.01"
            required
            value={form.amount}
            error={form.amount && amountInvalid ? `Enter an amount up to ${money(limit)}` : undefined}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
          <SelectInput label="Method" value={form.method} options={enumOptions(PAYMENT_METHODS)} onChange={(e) => setForm({ ...form, method: e.target.value })} />
          <TextInput
            label="Reference"
            hint="Transaction ID, card slip or cheque number"
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
          />
          <TextInput
            label={mode === 'refund' ? 'Reason' : 'Note'}
            required={mode === 'refund'}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </div>
      </Modal>
      <ConfirmDialog
        open={cancelling}
        title="Cancel invoice"
        message="Charges on this invoice return to the patient's unbilled list."
        requireReason
        danger
        confirmLabel="Cancel invoice"
        loading={cancel.isPending}
        onConfirm={(reason) => cancel.mutate(reason)}
        onClose={() => setCancelling(false)}
      />
    </>
  );
}
