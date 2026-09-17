import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RESULT_FLAGS } from '@hms/shared';
import { useAuth } from '../../contexts/AuthContext';
import { useAction } from '../../hooks/queries';
import { api } from '../../services/api';
import { ErrorState, Loading, StatusBadge } from '../../components/data';
import { ConfirmDialog } from '../../components/overlay';
import { Button, Notice, Panel, TextInput } from '../../components/ui';
import { PrintHeader, PrintToolbar } from '../../features/print/PrintHeader';
import { ageLabel, doctorName, fmtDate, fmtDateTime, formatEnum } from '../../utils/format';
import type { LabOrder } from '../../types';

type Values = Record<string, Record<string, { value: string; flag: string }>>;
type Remarks = Record<string, string>;

function initialValues(order: LabOrder): Values {
  return Object.fromEntries(
    order.items.map((item) => [
      item._id,
      Object.fromEntries(
        item.parameters.map((p) => {
          const existing = item.results.find((r) => r.parameter === p.name);
          // Parameters with numeric ranges start on automatic flagging so an edited value is re-evaluated.
          const automatic = p.refLow != null || p.refHigh != null;
          return [p.name, { value: existing?.value ?? '', flag: automatic ? '' : existing?.flag ?? '' }];
        }),
      ),
    ]),
  );
}

export default function LabOrderPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Values>({});
  const [remarks, setRemarks] = useState<Remarks>({});
  const [amending, setAmending] = useState(false);
  const [confirm, setConfirm] = useState<'cancel' | 'amend' | null>(null);

  const query = useQuery({ queryKey: ['lab', 'order', id], queryFn: () => api.get<LabOrder>(`/laboratory/orders/${id}`) });
  const order = query.data;
  useEffect(() => {
    if (order) {
      setValues(initialValues(order));
      setRemarks(Object.fromEntries(order.items.map((i) => [i._id, i.remarks ?? ''])));
    }
  }, [order]);

  const onUpdated = (updated: LabOrder) => {
    queryClient.setQueryData(['lab', 'order', id], updated);
    void queryClient.invalidateQueries({ queryKey: ['lab', 'orders'] });
    setAmending(false);
    setConfirm(null);
  };
  const step = useAction(
    ({ path, body }: { path: string; body?: unknown }) => api.post<LabOrder>(`/laboratory/orders/${id}/${path}`, body ?? {}),
    { success: 'Order updated', onSuccess: onUpdated },
  );

  const resultPayload = () => ({
    items: (order?.items ?? [])
      .map((item) => ({
        item: item._id,
        values: Object.entries(values[item._id] ?? {})
          .filter(([, v]) => v.value.trim() !== '')
          .map(([parameter, v]) => ({ parameter, value: v.value.trim(), ...(v.flag ? { flag: v.flag } : {}) })),
        remarks: remarks[item._id] ?? '',
      }))
      .filter((i) => i.values.length > 0),
  });
  const saveResults = useAction(() => api.put<LabOrder>(`/laboratory/orders/${id}/results`, resultPayload()), {
    success: 'Results saved',
    onSuccess: onUpdated,
  });

  if (query.isLoading) return <Loading />;
  if (query.error || !order) return <ErrorState error={query.error} />;

  const s = order.status;
  const entering = can('lab:process') && (['processing', 'result_entered'].includes(s) || amending);
  const hasEntries = resultPayload().items.length > 0;

  return (
    <>
      <PrintToolbar>
        <StatusBadge status={s} />
        {can('lab:process') && s === 'ordered' && (
          <Button variant="primary" loading={step.isPending} onClick={() => step.mutate({ path: 'collect' })}>
            Sample collected
          </Button>
        )}
        {can('lab:process') && s === 'sample_collected' && (
          <Button variant="primary" loading={step.isPending} onClick={() => step.mutate({ path: 'process' })}>
            Start processing
          </Button>
        )}
        {can('lab:verify') && s === 'result_entered' && !amending && (
          <Button variant="primary" loading={step.isPending} onClick={() => step.mutate({ path: 'verify' })}>
            Verify results
          </Button>
        )}
        {can('lab:verify') && s === 'verified' && (
          <Button variant="primary" loading={step.isPending} onClick={() => step.mutate({ path: 'release' })}>
            Release report
          </Button>
        )}
        {can('lab:verify') && ['verified', 'released'].includes(s) && !amending && (
          <Button onClick={() => setAmending(true)}>Correct results</Button>
        )}
        {(can('lab:order') || can('lab:process')) && ['ordered', 'sample_collected'].includes(s) && (
          <Button variant="danger" onClick={() => setConfirm('cancel')}>
            Cancel order
          </Button>
        )}
      </PrintToolbar>

      {order.resultsHidden && (
        <div className="print-toolbar no-print">
          <Notice>Results become visible here once the laboratory has verified them.</Notice>
        </div>
      )}

      {entering ? (
        <div style={{ maxWidth: 800, margin: '0 auto' }} className="stack">
          <Panel
            title={amending ? 'Correct results' : 'Enter results'}
            footer={
              amending ? (
                <>
                  <Button onClick={() => setAmending(false)}>Cancel</Button>
                  <Button variant="primary" disabled={!hasEntries} onClick={() => setConfirm('amend')}>
                    Save correction
                  </Button>
                </>
              ) : (
                <Button variant="primary" disabled={!hasEntries} loading={saveResults.isPending} onClick={() => saveResults.mutate(undefined)}>
                  Save results
                </Button>
              )
            }
          >
            <div className="stack">
              <div className="small muted">
                {order.patient.fullName} ({order.patient.uhid}) · {ageLabel(order.patient)} · {formatEnum(order.patient.gender)}
                {order.clinicalNotes ? ` · Notes: ${order.clinicalNotes}` : ''}
              </div>
              {order.items.map((item) => (
                <div key={item._id}>
                  <h3 style={{ marginBottom: 6 }}>
                    {item.testName} <span className="small muted">({item.sampleType})</span>
                  </h3>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Parameter</th>
                        <th style={{ width: 160 }}>Result</th>
                        <th>Unit</th>
                        <th>Reference</th>
                        <th style={{ width: 140 }}>Flag</th>
                      </tr>
                    </thead>
                    <tbody>
                      {item.parameters.map((p) => {
                        const v = values[item._id]?.[p.name] ?? { value: '', flag: '' };
                        const set = (patch: Partial<typeof v>) =>
                          setValues((all) => ({ ...all, [item._id]: { ...all[item._id], [p.name]: { ...v, ...patch } } }));
                        return (
                          <tr key={p.name}>
                            <td>{p.name}</td>
                            <td>
                              <input className="input" aria-label={p.name} value={v.value} onChange={(e) => set({ value: e.target.value })} />
                            </td>
                            <td>{p.unit}</td>
                            <td>{p.referenceRange}</td>
                            <td>
                              <select className="select" aria-label={`${p.name} flag`} value={v.flag} onChange={(e) => set({ flag: e.target.value })}>
                                <option value="">{p.refLow != null || p.refHigh != null ? 'Automatic' : 'Normal'}</option>
                                {RESULT_FLAGS.map((f) => (
                                  <option key={f} value={f}>
                                    {formatEnum(f)}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div style={{ marginTop: 6 }}>
                    <TextInput
                      aria-label="Remarks"
                      placeholder="Remarks"
                      value={remarks[item._id] ?? ''}
                      onChange={(e) => setRemarks((r) => ({ ...r, [item._id]: e.target.value }))}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      ) : (
        <article className="print-page">
          <PrintHeader
            right={
              <>
                <div className="strong">Laboratory report</div>
                <div>
                  Order <span className="mono">{order.orderNumber}</span>
                </div>
              </>
            }
          />
          <div className="row-between" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
            <div>
              <div className="strong">{order.patient.fullName}</div>
              <div>
                UHID <span className="mono">{order.patient.uhid}</span> · {ageLabel(order.patient)} · {formatEnum(order.patient.gender)}
              </div>
              <div className="no-print small">
                <Link to={`/patients/${order.patient.id ?? order.patient._id}`}>Open patient record</Link>
              </div>
            </div>
            <div style={{ textAlign: 'right' }} className="small">
              <div>Referred by: {doctorName(order.doctor) || order.orderedBy?.name}</div>
              <div>Ordered: {fmtDateTime(order.createdAt)}</div>
              {order.sampleCollectedAt && <div>Sample: {fmtDateTime(order.sampleCollectedAt)}</div>}
              {order.releasedAt && <div>Reported: {fmtDateTime(order.releasedAt)}</div>}
              <div>
                Priority: {formatEnum(order.priority)} · Status: {formatEnum(s)}
              </div>
            </div>
          </div>
          {s !== 'released' && (
            <div className="notice warn" style={{ marginBottom: 12 }}>
              This report has not been released and must not be issued to the patient.
            </div>
          )}
          {order.items.map((item) => (
            <div key={item._id} style={{ marginBottom: 16 }}>
              <h3 style={{ marginBottom: 6 }}>{item.testName}</h3>
              {item.results.length === 0 ? (
                <p className="muted small">{order.resultsHidden ? 'Awaiting verification.' : 'Results not entered yet.'}</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Parameter</th>
                      <th>Result</th>
                      <th>Unit</th>
                      <th>Reference range</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.results.map((r) => (
                      <tr key={r.parameter}>
                        <td>{r.parameter}</td>
                        <td className={r.flag !== 'normal' ? 'strong danger-text' : 'strong'}>
                          {r.value} {r.flag !== 'normal' && <span className="small">({formatEnum(r.flag)})</span>}
                        </td>
                        <td>{r.unit}</td>
                        <td>{r.referenceRange}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {item.remarks && <p className="small" style={{ marginTop: 4 }}>Remarks: {item.remarks}</p>}
            </div>
          ))}
          <div className="print-footer">
            <div>
              {order.resultEnteredBy && <div>Entered by {order.resultEnteredBy.name}</div>}
              {order.verifiedBy && (
                <div>
                  Verified by {order.verifiedBy.name}, {fmtDate(order.verifiedAt)}
                </div>
              )}
            </div>
            <div className="signature">Laboratory in-charge</div>
          </div>
          {!order.resultsHidden && order.revisions && order.revisions.length > 0 && (
            <div className="no-print" style={{ marginTop: 24 }}>
              <h3>Correction history</h3>
              <ul className="list small">
                {order.revisions.map((r, i) => (
                  <li key={i} className="list-item">
                    {fmtDateTime(r.at)} by {r.by?.name}: {r.reason}
                    <div className="muted">
                      Previous:{' '}
                      {r.items.map((it) => `${it.testName} ${it.results.map((x) => `${x.parameter} ${x.value}`).join(', ')}`).join('; ')}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>
      )}

      <ConfirmDialog
        open={confirm === 'cancel'}
        title="Cancel lab order"
        message="Unbilled charges for this order are voided."
        requireReason
        danger
        confirmLabel="Cancel order"
        loading={step.isPending}
        onConfirm={(reason) => step.mutate({ path: 'cancel', body: { reason } })}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'amend'}
        title="Correct released results"
        message="The previous values are kept in the correction history and the report must be verified again."
        requireReason
        confirmLabel="Save correction"
        loading={step.isPending}
        onConfirm={(reason) => step.mutate({ path: 'amend', body: { reason, ...resultPayload() } })}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
