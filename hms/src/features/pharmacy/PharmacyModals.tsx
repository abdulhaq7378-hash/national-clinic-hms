import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MEDICINE_FORMS, medicineCreateSchema, stockInSchema, toHospitalDate } from '@hms/shared';
import { useAction } from '../../hooks/queries';
import { useDebounce } from '../../hooks/useDebounce';
import { api } from '../../services/api';
import { Modal } from '../../components/overlay';
import { Button, Checkbox, enumOptions, Field, Notice, SelectInput, TextInput } from '../../components/ui';
import type { MedicineStock } from '../../types';

const EMPTY_MEDICINE = {
  name: '',
  genericName: '',
  brand: '',
  manufacturer: '',
  category: '',
  form: 'tablet',
  strength: '',
  unit: 'tablet',
  reorderLevel: '10',
  hsnCode: '',
  taxRate: '0',
  isActive: true,
};

export function MedicineModal({
  open,
  medicine,
  onClose,
}: {
  open: boolean;
  medicine?: MedicineStock | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState(EMPTY_MEDICINE);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(
      medicine
        ? {
            name: medicine.name,
            genericName: medicine.genericName ?? '',
            brand: medicine.brand ?? '',
            manufacturer: medicine.manufacturer ?? '',
            category: medicine.category ?? '',
            form: medicine.form,
            strength: medicine.strength ?? '',
            unit: medicine.unit,
            reorderLevel: String(medicine.reorderLevel),
            hsnCode: medicine.hsnCode ?? '',
            taxRate: String(medicine.taxRate ?? 0),
            isActive: medicine.isActive,
          }
        : EMPTY_MEDICINE,
    );
  }, [open, medicine]);

  const save = useAction(
    (body: unknown) =>
      medicine ? api.patch(`/pharmacy/medicines/${medicine.id}`, body) : api.post('/pharmacy/medicines', body),
    { success: medicine ? 'Medicine updated' : 'Medicine added', invalidate: [['pharmacy']], onSuccess: onClose },
  );
  const submit = () => {
    const parsed = medicineCreateSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form');
      return;
    }
    save.mutate(form);
  };
  const set = (k: keyof typeof EMPTY_MEDICINE, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal
      open={open}
      wide
      title={medicine ? `Edit ${medicine.name}` : 'Add medicine'}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <div className="form-grid form-grid-3">
        {error && (
          <div className="span-all">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
        <TextInput label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} />
        <TextInput label="Generic name" value={form.genericName} onChange={(e) => set('genericName', e.target.value)} />
        <TextInput label="Brand" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
        <SelectInput label="Form" value={form.form} options={enumOptions(MEDICINE_FORMS)} onChange={(e) => set('form', e.target.value)} />
        <TextInput label="Strength" placeholder="500 mg" value={form.strength} onChange={(e) => set('strength', e.target.value)} />
        <TextInput label="Stock unit" required hint="tablet, strip, bottle, vial" value={form.unit} onChange={(e) => set('unit', e.target.value)} />
        <TextInput label="Category" value={form.category} onChange={(e) => set('category', e.target.value)} />
        <TextInput label="Manufacturer" value={form.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} />
        <TextInput label="Reorder level" type="number" min={0} value={form.reorderLevel} onChange={(e) => set('reorderLevel', e.target.value)} />
        <TextInput label="HSN code" value={form.hsnCode} onChange={(e) => set('hsnCode', e.target.value)} />
        <TextInput label="GST %" type="number" min={0} max={100} value={form.taxRate} onChange={(e) => set('taxRate', e.target.value)} />
        <Field label="Status">{() => <Checkbox label="Active" checked={form.isActive} onChange={(v) => set('isActive', v)} />}</Field>
      </div>
    </Modal>
  );
}

export function StockInModal({
  open,
  medicine,
  onClose,
}: {
  open: boolean;
  medicine?: MedicineStock | null;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<MedicineStock | null>(null);
  const [term, setTerm] = useState('');
  const [form, setForm] = useState({
    batchNumber: '',
    expiryDate: '',
    quantity: '',
    purchasePrice: '',
    sellingPrice: '',
    supplier: '',
    supplierInvoice: '',
  });
  const [error, setError] = useState('');
  const q = useDebounce(term.trim(), 250);
  const search = useQuery({
    queryKey: ['pharmacy', 'medicines', 'pick', q],
    queryFn: () => api.page<MedicineStock>('/pharmacy/medicines', { q, limit: 8 }).then((r) => r.data),
    enabled: open && !picked && q.length >= 2,
  });

  useEffect(() => {
    if (!open) return;
    setPicked(medicine ?? null);
    setTerm('');
    setError('');
    setForm({ batchNumber: '', expiryDate: '', quantity: '', purchasePrice: '', sellingPrice: '', supplier: '', supplierInvoice: '' });
  }, [open, medicine]);

  const save = useAction((body: unknown) => api.post('/pharmacy/stock-in', body), {
    success: 'Stock received',
    invalidate: [['pharmacy'], ['dashboard']],
    onSuccess: onClose,
  });
  const submit = () => {
    const body = { ...form, medicine: picked?.id };
    const parsed = stockInSchema.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form');
      return;
    }
    save.mutate(body);
  };
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal
      open={open}
      wide
      title="Receive stock"
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!picked}>
            Receive
          </Button>
        </>
      }
    >
      <div className="form-grid form-grid-3">
        {error && (
          <div className="span-all">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
        <div className="span-all">
          {picked ? (
            <div className="patient-chip">
              <span>
                <strong>{picked.name}</strong> {picked.strength} ({picked.form}), current stock {picked.stock} {picked.unit}
              </span>
              {!medicine && (
                <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
                  Change
                </Button>
              )}
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <TextInput label="Medicine" required autoFocus value={term} onChange={(e) => setTerm(e.target.value)} />
              {search.data && search.data.length > 0 && (
                <div className="search-results">
                  {search.data.map((m) => (
                    <div key={m.id} className="list-item clickable" onMouseDown={() => setPicked(m)}>
                      {m.name} {m.strength} <span className="muted">({m.form})</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <TextInput label="Batch number" required value={form.batchNumber} onChange={(e) => set('batchNumber', e.target.value)} />
        <TextInput label="Expiry date" type="date" required min={toHospitalDate()} value={form.expiryDate} onChange={(e) => set('expiryDate', e.target.value)} />
        <TextInput label={`Quantity${picked ? ` (${picked.unit})` : ''}`} type="number" min={1} required value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
        <TextInput label="Purchase price per unit" type="number" min={0} step="0.01" required value={form.purchasePrice} onChange={(e) => set('purchasePrice', e.target.value)} />
        <TextInput label="Selling price per unit" type="number" min={0} step="0.01" required value={form.sellingPrice} onChange={(e) => set('sellingPrice', e.target.value)} />
        <TextInput label="Supplier" value={form.supplier} onChange={(e) => set('supplier', e.target.value)} />
        <TextInput label="Supplier invoice" value={form.supplierInvoice} onChange={(e) => set('supplierInvoice', e.target.value)} />
      </div>
    </Modal>
  );
}
