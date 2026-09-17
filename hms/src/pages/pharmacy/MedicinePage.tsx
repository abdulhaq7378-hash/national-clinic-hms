import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PackagePlus, Pencil } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useAction } from '../../hooks/queries';
import { api } from '../../services/api';
import { Badge, DataTable, ErrorState, Loading } from '../../components/data';
import { Modal } from '../../components/overlay';
import { Button, KeyValue, PageHeader, Panel, SelectInput, TextInput } from '../../components/ui';
import { MedicineModal, StockInModal } from '../../features/pharmacy/PharmacyModals';
import { fmtDate, formatEnum, money } from '../../utils/format';
import type { Batch, InventoryTx, MedicineStock } from '../../types';
import { TxTable } from './PharmacyPage';

type MedicineDetail = MedicineStock & { batches: Batch[]; transactions: InventoryTx[] };

export default function MedicinePage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [adjusting, setAdjusting] = useState<Batch | null>(null);
  const [adj, setAdj] = useState({ type: 'adjustment', direction: 'remove', quantity: '', reason: '' });

  const query = useQuery({ queryKey: ['pharmacy', 'medicine', id], queryFn: () => api.get<MedicineDetail>(`/pharmacy/medicines/${id}`) });
  const adjust = useAction(
    () =>
      api.post('/pharmacy/adjustments', {
        batch: adjusting!.id,
        type: adj.type,
        quantityChange: (adj.direction === 'remove' || adj.type === 'write_off' ? -1 : 1) * Number(adj.quantity),
        reason: adj.reason,
      }),
    { success: 'Stock adjusted', invalidate: [['pharmacy']], onSuccess: () => setAdjusting(null) },
  );

  if (query.isLoading) return <Loading />;
  if (query.error || !query.data) return <ErrorState error={query.error} />;
  const m = query.data;
  const now = new Date();

  return (
    <>
      <PageHeader
        title={`${m.name} ${m.strength ?? ''}`}
        description={[m.genericName, m.brand, formatEnum(m.form)].filter(Boolean).join(' · ')}
        actions={
          can('pharmacy:inventory') && (
            <>
              <Button icon={<Pencil size={14} />} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button variant="primary" icon={<PackagePlus size={14} />} onClick={() => setReceiving(true)}>
                Receive stock
              </Button>
            </>
          )
        }
      />
      <div className="grid grid-sidebar-left">
        <Panel title="Details">
          <KeyValue
            items={[
              ['Usable stock', <strong key="s">{m.stock} {m.unit}</strong>],
              ['Reorder level', m.reorderLevel],
              ['Category', m.category],
              ['Manufacturer', m.manufacturer],
              ['HSN code', m.hsnCode],
              ['GST', `${m.taxRate}%`],
              ['Status', m.isActive ? 'Active' : 'Inactive'],
            ]}
          />
        </Panel>
        <div className="stack">
          <Panel title="Batches" flush>
            <DataTable
              rows={m.batches}
              rowKey={(b) => b.id}
              columns={[
                { key: 'no', header: 'Batch', render: (b) => <span className="mono">{b.batchNumber}</span> },
                {
                  key: 'exp',
                  header: 'Expiry',
                  render: (b) => (
                    <>
                      {fmtDate(b.expiryDate)} {new Date(b.expiryDate) <= now && b.quantity > 0 && <Badge tone="danger">Expired</Badge>}
                    </>
                  ),
                },
                { key: 'qty', header: 'In stock', className: 'num', render: (b) => `${b.quantity} / ${b.receivedQuantity}` },
                { key: 'cost', header: 'Cost', className: 'num', render: (b) => money(b.purchasePrice) },
                { key: 'mrp', header: 'Selling', className: 'num', render: (b) => money(b.sellingPrice) },
                { key: 'sup', header: 'Supplier', render: (b) => b.supplier },
                {
                  key: 'act',
                  header: '',
                  className: 'right',
                  render: (b) =>
                    can('pharmacy:inventory') && (
                      <Button
                        size="sm"
                        onClick={() => {
                          const expired = new Date(b.expiryDate) <= now;
                          setAdj({ type: expired ? 'write_off' : 'adjustment', direction: 'remove', quantity: expired ? String(b.quantity) : '', reason: expired ? 'Expired' : '' });
                          setAdjusting(b);
                        }}
                      >
                        Adjust
                      </Button>
                    ),
                },
              ]}
            />
          </Panel>
          <Panel title="Recent movements" flush>
            <TxTable rows={m.transactions} />
          </Panel>
        </div>
      </div>

      <MedicineModal open={editing} medicine={m} onClose={() => setEditing(false)} />
      <StockInModal open={receiving} medicine={m} onClose={() => setReceiving(false)} />
      <Modal
        open={Boolean(adjusting)}
        title={`Adjust batch ${adjusting?.batchNumber ?? ''}`}
        onClose={() => setAdjusting(null)}
        onSubmit={() => Number(adj.quantity) > 0 && adj.reason.trim() && adjust.mutate(undefined)}
        footer={
          <>
            <Button onClick={() => setAdjusting(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={adjust.isPending} disabled={!(Number(adj.quantity) > 0) || !adj.reason.trim()}>
              Save adjustment
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <SelectInput
            label="Type"
            value={adj.type}
            options={[
              { value: 'adjustment', label: 'Stock count correction' },
              { value: 'write_off', label: 'Write-off (damaged or expired)' },
              { value: 'return', label: 'Return' },
            ]}
            onChange={(e) => setAdj({ ...adj, type: e.target.value })}
          />
          {adj.type !== 'write_off' && (
            <SelectInput
              label="Direction"
              value={adj.direction}
              options={[
                { value: 'remove', label: 'Remove from stock' },
                { value: 'add', label: 'Add to stock' },
              ]}
              onChange={(e) => setAdj({ ...adj, direction: e.target.value })}
            />
          )}
          <TextInput
            label="Quantity"
            type="number"
            min={1}
            hint={`Currently ${adjusting?.quantity ?? 0} in this batch`}
            value={adj.quantity}
            onChange={(e) => setAdj({ ...adj, quantity: e.target.value })}
          />
          <TextInput label="Reason" required value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} />
        </div>
      </Modal>
    </>
  );
}
