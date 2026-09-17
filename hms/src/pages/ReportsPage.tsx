import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { addDays, toHospitalDate } from '@hms/shared';
import { useToast } from '../contexts/ToastContext';
import { api, downloadFile } from '../services/api';
import { EmptyState, Loading, QueryState } from '../components/data';
import { Button, PageHeader, Panel, TextInput } from '../components/ui';
import { PrintHeader } from '../features/print/PrintHeader';
import { fmtDate, money } from '../utils/format';

interface ReportInfo {
  key: string;
  title: string;
  description: string;
  needsRange: boolean;
}

interface ReportColumn {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'currency' | 'date' | 'datetime';
}

interface ReportResult {
  key: string;
  title: string;
  range?: { from: string; to: string };
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  summary?: { label: string; value: string | number; type?: ReportColumn['type'] }[];
}

function cell(value: unknown, type?: ReportColumn['type']) {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'currency') return money(Number(value));
  if (type === 'date') return fmtDate(String(value));
  return String(value);
}

export default function ReportsPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const selected = params.get('report');
  const today = toHospitalDate();
  const [from, setFrom] = useState(params.get('from') ?? addDays(today, -6));
  const [to, setTo] = useState(params.get('to') ?? today);
  const [run, setRun] = useState<{ key: string; from: string; to: string } | null>(null);
  const [downloading, setDownloading] = useState(false);

  const list = useQuery({ queryKey: ['reports'], queryFn: () => api.get<ReportInfo[]>('/reports') });
  const info = list.data?.find((r) => r.key === selected);
  const result = useQuery({
    queryKey: ['reports', run],
    queryFn: () => api.get<ReportResult>(`/reports/${run!.key}`, info?.needsRange ? { from: run!.from, to: run!.to } : {}),
    enabled: Boolean(run && run.key === selected),
  });

  const select = (key: string) => {
    setParams({ report: key }, { replace: true });
    const r = list.data?.find((x) => x.key === key);
    setRun(r && !r.needsRange ? { key, from: '', to: '' } : null);
  };

  const download = async () => {
    if (!selected) return;
    setDownloading(true);
    try {
      await downloadFile(`/reports/${selected}`, { format: 'csv', ...(info?.needsRange ? { from, to } : {}) });
    } catch (err) {
      toast.error(err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <PageHeader title="Reports" description="Use Print and choose Save as PDF for a PDF copy." />
      <div className="grid grid-sidebar-left">
        <Panel title="Available reports" flush className="no-print">
          <QueryState query={list} empty={{ when: (d) => d.length === 0, title: 'No reports available for your role' }}>
            {(reports) => (
              <ul className="list">
                {reports.map((r) => (
                  <li
                    key={r.key}
                    className={`list-item clickable ${selected === r.key ? 'selected' : ''}`}
                    onClick={() => select(r.key)}
                  >
                    <div className="strong">{r.title}</div>
                    <div className="small muted">{r.description}</div>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </Panel>

        <div className="stack">
          {!info ? (
            <Panel>
              <EmptyState title="Select a report" />
            </Panel>
          ) : (
            <>
              <Panel className="no-print">
                <div className="row" style={{ alignItems: 'flex-end' }}>
                  {info.needsRange && (
                    <>
                      <TextInput label="From" type="date" max={to} value={from} onChange={(e) => setFrom(e.target.value)} />
                      <TextInput label="To" type="date" min={from} max={today} value={to} onChange={(e) => setTo(e.target.value)} />
                      <Button variant="primary" onClick={() => setRun({ key: info.key, from, to })}>
                        Run report
                      </Button>
                    </>
                  )}
                  {!info.needsRange && (
                    <Button variant="primary" onClick={() => { setRun({ key: info.key, from: '', to: '' }); void result.refetch(); }}>
                      Refresh
                    </Button>
                  )}
                  <Button icon={<Download size={14} />} loading={downloading} onClick={download}>
                    Export CSV
                  </Button>
                  <Button icon={<Printer size={14} />} disabled={!result.data} onClick={() => window.print()}>
                    Print
                  </Button>
                </div>
              </Panel>

              {!run ? (
                <Panel>
                  <EmptyState title="Choose the period and run the report" />
                </Panel>
              ) : result.isLoading ? (
                <Loading />
              ) : result.error ? (
                <Panel>
                  <EmptyState title="Could not run the report">{(result.error as Error).message}</EmptyState>
                </Panel>
              ) : (
                result.data && (
                  <article className="print-page" style={{ maxWidth: 'none' }}>
                    <div className="only-print">
                      <PrintHeader />
                    </div>
                    <div className="row-between" style={{ marginBottom: 12 }}>
                      <h2>{result.data.title}</h2>
                      <span className="muted">
                        {result.data.range
                          ? `${fmtDate(result.data.range.from)} to ${fmtDate(result.data.range.to)}`
                          : `As of ${fmtDate(today)}`}
                      </span>
                    </div>
                    {result.data.summary && result.data.summary.length > 0 && (
                      <div className="row" style={{ gap: 24, marginBottom: 12 }}>
                        {result.data.summary.map((s) => (
                          <div key={s.label}>
                            <div className="small muted">{s.label}</div>
                            <div className="strong">{cell(s.value, s.type)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {result.data.rows.length === 0 ? (
                      <EmptyState title="No data for this period" />
                    ) : (
                      <div className="table-wrap">
                        <table className="table">
                          <thead>
                            <tr>
                              {result.data.columns.map((c) => (
                                <th key={c.key} className={['number', 'currency'].includes(c.type ?? '') ? 'num' : undefined}>
                                  {c.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {result.data.rows.map((row, i) => (
                              <tr key={i}>
                                {result.data!.columns.map((c) => (
                                  <td key={c.key} className={['number', 'currency'].includes(c.type ?? '') ? 'num' : undefined}>
                                    {cell(row[c.key], c.type)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </article>
                )
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
