import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { PackagePlus, Plus, Search, ShoppingBag } from 'lucide-react';
import { INVENTORY_TX_TYPES } from '@hms/shared';
import { useAuth } from '../../contexts/AuthContext';
import { useDebounce } from '../../hooks/useDebounce';
import { api } from '../../services/api';
import { Badge, DataTable, Pagination, QueryState, Stat } from '../../components/data';
import { Button, enumOptions, LinkButton, PageHeader, Panel, Segmented, SelectInput, Tabs } from '../../components/ui';
import { MedicineModal, StockInModal } from '../../features/pharmacy/PharmacyModals';
import { fmtDate, fmtDateTime, formatEnum } from '../../utils/format';
import type { Batch, InventoryTx, MedicineStock } from '../../types';

interface Alerts {
  counts: { lowStock: number; outOfStock: number; expiring: number; expired: number };
  expiryAlertDays: number;
  expiring: Batch[];
  expired: Batch[];
}

type Filter = 'all' | 'low_stock' | 'out_of_stock' | 'expiring' | 'expired';

function Inventory({ filter, setFilter }: { filter: Filter; setFilter: (f: Filter) => void }) {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounce(term.trim(), 300);
  const query = useQuery({
    queryKey: ['pharmacy', 'medicines', { q, filter, page }],
    queryFn: () => api.page<MedicineStock>('/pharmacy/medicines', { q, filter, page, limit: 25 }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <div className="row" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
        <div className="input-group" style={{ width: 260 }}>
          <Search size={15} />
          <input className="input" placeholder="Medicine, generic or brand" value={term} onChange={(e) => { setTerm(e.target.value); setPage(1); }} />
        </div>
        <Segmented
          value={filter}
          onChange={(f) => { setFilter(f); setPage(1); }}
          options={[
            { value: 'all', label: 'All' },
            { value: 'low_stock', label: 'Low stock' },
            { value: 'out_of_stock', label: 'Out of stock' },
            { value: 'expiring', label: 'Expiring' },
            { value: 'expired', label: 'Expired' },
          ]}
        />
      </div>
      <QueryState query={query} empty={{ when: (r) => r.data.length === 0, title: 'No medicines match' }}>
        {(r) => (
          <>
            <DataTable
              rows={r.data}
              rowKey={(m) => m.id}
              onRowClick={(m) => navigate(`/pharmacy/medicines/${m.id}`)}
              columns={[
                {
                  key: 'name',
                  header: 'Medicine',
                  render: (m) => (
                    <>
                      <div className="cell-title">
                        {m.name} {m.strength}
                      </div>
                      <div className="cell-sub">{[m.genericName, m.brand, formatEnum(m.form)].filter(Boolean).join(' · ')}</div>
                    </>
                  ),
                },
                { key: 'cat', header: 'Category', render: (m) => m.category },
                {
                  key: 'stock',
                  header: 'Stock',
                  className: 'num',
                  render: (m) => (
                    <span className={m.stock === 0 ? 'danger-text strong' : m.stock <= m.reorderLevel ? 'strong' : undefined}>
                      {m.stock} {m.unit}
                    </span>
                  ),
                },
                { key: 'reorder', header: 'Reorder at', className: 'num', render: (m) => m.reorderLevel },
                { key: 'expiry', header: 'Nearest expiry', render: (m) => fmtDate(m.nearestExpiry) },
                {
                  key: 'flags',
                  header: '',
                  render: (m) => (
                    <div className="row">
                      {!m.isActive && <Badge>Inactive</Badge>}
                      {m.stock === 0 && m.isActive && <Badge tone="danger">Out of stock</Badge>}
                      {m.stock > 0 && m.stock <= m.reorderLevel && <Badge tone="warning">Low</Badge>}
                      {(m.expiredStock ?? 0) > 0 && <Badge tone="danger">{m.expiredStock} expired</Badge>}
                    </div>
                  ),
                },
              ]}
            />
            <Pagination meta={r.meta} onPage={setPage} />
          </>
        )}
      </QueryState>
    </>
  );
}

function Movements() {
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['pharmacy', 'transactions', { type, page }],
    queryFn: () => api.page<InventoryTx>('/pharmacy/transactions', { type, page, limit: 30 }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <div className="row" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ width: 200 }}>
          <SelectInput aria-label="Type" value={type} placeholder="All movements" options={enumOptions(INVENTORY_TX_TYPES)} onChange={(e) => { setType(e.target.value); setPage(1); }} />
        </div>
      </div>
      <QueryState query={query} empty={{ when: (r) => r.data.length === 0, title: 'No stock movements yet' }}>
        {(r) => (
          <>
            <TxTable rows={r.data} showMedicine />
            <Pagination meta={r.meta} onPage={setPage} />
          </>
        )}
      </QueryState>
    </>
  );
}

export function TxTable({ rows, showMedicine }: { rows: InventoryTx[]; showMedicine?: boolean }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(t) => t.id}
      columns={[
        { key: 'at', header: 'When', render: (t) => <span className="nowrap">{fmtDateTime(t.createdAt)}</span> },
        ...(showMedicine
          ? [
              {
                key: 'med',
                header: 'Medicine',
                render: (t: InventoryTx) => (typeof t.medicine === 'object' ? `${t.medicine.name} ${t.medicine.strength ?? ''}` : ''),
              },
            ]
          : []),
        { key: 'batch', header: 'Batch', render: (t) => <span className="mono">{typeof t.batch === 'object' ? t.batch.batchNumber : ''}</span> },
        { key: 'type', header: 'Type', render: (t) => formatEnum(t.type) },
        {
          key: 'qty',
          header: 'Change',
          className: 'num',
          render: (t) => <span className={t.quantity < 0 ? 'danger-text' : 'success-text'}>{t.quantity > 0 ? `+${t.quantity}` : t.quantity}</span>,
        },
        { key: 'bal', header: 'Batch balance', className: 'num', render: (t) => t.balanceAfter },
        {
          key: 'ref',
          header: 'Reference',
          render: (t) => (
            <>
              <div className="mono small">{t.referenceNumber}</div>
              {t.patient && <div className="cell-sub">{t.patient.fullName}</div>}
              {t.reason && <div className="cell-sub">{t.reason}</div>}
            </>
          ),
        },
        { key: 'by', header: 'By', render: (t) => t.performedBy?.name },
      ]}
    />
  );
}

export default function PharmacyPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'inventory' | 'movements') ?? 'inventory';
  const filter = (params.get('filter') as Filter) ?? 'all';
  const [adding, setAdding] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const alerts = useQuery({ queryKey: ['pharmacy', 'alerts'], queryFn: () => api.get<Alerts>('/pharmacy/alerts') });
  const c = alerts.data?.counts;

  return (
    <>
      <PageHeader
        title="Pharmacy"
        description="Stock is tracked per batch and every movement is recorded."
        actions={
          <>
            {can('pharmacy:dispense') && (
              <LinkButton to="/pharmacy/dispense" icon={<ShoppingBag size={15} />}>
                Dispense
              </LinkButton>
            )}
            {can('pharmacy:inventory') && (
              <>
                <Button icon={<Plus size={15} />} onClick={() => setAdding(true)}>
                  Add medicine
                </Button>
                <Button variant="primary" icon={<PackagePlus size={15} />} onClick={() => setReceiving(true)}>
                  Receive stock
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Low stock" value={c?.lowStock ?? '0'} href="/pharmacy?filter=low_stock" noteTone={c?.lowStock ? 'warn' : undefined} note="At or below reorder level" />
        <Stat label="Out of stock" value={c?.outOfStock ?? '0'} href="/pharmacy?filter=out_of_stock" noteTone={c?.outOfStock ? 'bad' : undefined} note="Active medicines" />
        <Stat label="Expiring soon" value={c?.expiring ?? '0'} href="/pharmacy?filter=expiring" note={`Within ${alerts.data?.expiryAlertDays ?? 90} days`} />
        <Stat label="Expired stock" value={c?.expired ?? '0'} href="/pharmacy?filter=expired" noteTone={c?.expired ? 'bad' : undefined} note="Write off from the medicine page" />
      </div>
      <Panel flush>
        <div style={{ padding: '0 16px' }}>
          <Tabs
            active={tab}
            onChange={(k) => setParams({ tab: k }, { replace: true })}
            tabs={[
              { key: 'inventory', label: 'Inventory' },
              { key: 'movements', label: 'Stock movements' },
            ]}
          />
        </div>
        {tab === 'inventory' ? (
          <Inventory filter={filter} setFilter={(f) => setParams(f === 'all' ? {} : { filter: f }, { replace: true })} />
        ) : (
          <Movements />
        )}
      </Panel>
      <MedicineModal open={adding} onClose={() => setAdding(false)} />
      <StockInModal open={receiving} onClose={() => setReceiving(false)} />
    </>
  );
}
