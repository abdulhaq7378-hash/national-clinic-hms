import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Inbox, ShieldAlert } from 'lucide-react';
import { formatEnum } from '@hms/shared';
import type { PageMeta } from '../services/api';
import { errorMessage, ApiError } from '../services/api';
import { Button } from './ui';

const STATUS_TONES: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'neutral'> = {
  // appointments and queue
  scheduled: 'info',
  confirmed: 'info',
  checked_in: 'brand',
  in_consultation: 'warning',
  completed: 'success',
  cancelled: 'neutral',
  no_show: 'danger',
  waiting: 'info',
  with_doctor: 'warning',
  skipped: 'danger',
  // clinical
  draft: 'warning',
  active: 'info',
  partially_dispensed: 'warning',
  dispensed: 'success',
  resolved: 'neutral',
  entered_in_error: 'danger',
  created: 'info',
  sent: 'brand',
  accepted: 'warning',
  // billing
  pending: 'warning',
  billed: 'success',
  void: 'neutral',
  unpaid: 'danger',
  partially_paid: 'warning',
  paid: 'success',
  refunded: 'neutral',
  // lab
  ordered: 'info',
  sample_collected: 'brand',
  processing: 'warning',
  result_entered: 'warning',
  verified: 'success',
  released: 'success',
  // beds
  available: 'success',
  occupied: 'brand',
  reserved: 'info',
  cleaning: 'warning',
  maintenance: 'neutral',
  admitted: 'brand',
  discharged: 'neutral',
  // ot
  pre_op: 'info',
  in_progress: 'warning',
  postponed: 'neutral',
  // priority and flags
  routine: 'neutral',
  urgent: 'warning',
  emergency: 'danger',
  normal: 'success',
  low: 'warning',
  high: 'danger',
  abnormal: 'danger',
  success: 'success',
  failure: 'danger',
};

export function StatusBadge({ status, label }: { status?: string | null; label?: string }) {
  if (!status) return null;
  const tone = STATUS_TONES[status] ?? 'neutral';
  return <span className={`badge ${tone === 'neutral' ? '' : tone}`}>{label ?? formatEnum(status)}</span>;
}

export function Badge({ children, tone }: { children: ReactNode; tone?: 'success' | 'warning' | 'danger' | 'info' | 'brand' }) {
  return <span className={`badge ${tone ?? ''}`}>{children}</span>;
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="loading-block" role="status">
      <span className="spinner" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      {icon ?? <Inbox size={28} />}
      <h3>{title}</h3>
      {children && <div>{children}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const forbidden = error instanceof ApiError && error.status === 403;
  return (
    <div className="empty">
      <ShieldAlert size={28} />
      <h3>{forbidden ? 'Not available' : 'Could not load this information'}</h3>
      <p>{errorMessage(error)}</p>
      {onRetry && !forbidden && (
        <div style={{ marginTop: 10 }}>
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

/** Renders loading, error and empty states around query results. */
export function QueryState<T>({
  query,
  empty,
  children,
}: {
  query: { isLoading: boolean; error: unknown; data: T | undefined; refetch: () => unknown };
  empty?: { when: (data: T) => boolean; title: string; body?: ReactNode };
  children: (data: T) => ReactNode;
}) {
  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (query.data === undefined) return null;
  if (empty?.when(query.data)) return <EmptyState title={empty.title}>{empty.body}</EmptyState>;
  return <>{children(query.data)}</>;
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  footer,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  footer?: ReactNode;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.className}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? 'clickable' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={c.className}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer}
      </table>
    </div>
  );
}

export function Pagination({ meta, onPage }: { meta?: PageMeta; onPage: (page: number) => void }) {
  if (!meta || meta.total === 0) return null;
  const start = (meta.page - 1) * meta.limit + 1;
  const end = Math.min(meta.page * meta.limit, meta.total);
  return (
    <div className="pagination">
      <span>
        {start} to {end} of {meta.total}
      </span>
      <div className="row">
        <Button
          size="sm"
          iconOnly
          aria-label="Previous page"
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
          icon={<ChevronLeft size={14} />}
        />
        <span>
          Page {meta.page} of {meta.pages}
        </span>
        <Button
          size="sm"
          iconOnly
          aria-label="Next page"
          disabled={meta.page >= meta.pages}
          onClick={() => onPage(meta.page + 1)}
          icon={<ChevronRight size={14} />}
        />
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  note,
  noteTone,
  icon,
  href,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  noteTone?: 'warn' | 'bad';
  icon?: ReactNode;
  href?: string;
}) {
  const content = (
    <>
      <span className="stat-label">
        {icon}
        {label}
      </span>
      <span className="stat-value">{value}</span>
      {note !== undefined && <span className={`stat-note ${noteTone ?? ''}`}>{note}</span>}
    </>
  );
  return href ? (
    <Link className="stat panel" to={href}>
      {content}
    </Link>
  ) : (
    <div className="stat panel">{content}</div>
  );
}
