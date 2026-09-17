import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { addDays, toHospitalDate } from '@hms/shared';
import { api } from '../services/api';
import { QueryState, Stat } from '../components/data';
import { PageHeader, Panel, Segmented, TextInput } from '../components/ui';
import { fmtDate, money } from '../utils/format';

interface Analytics {
  from: string;
  to: string;
  totalBeds: number;
  totals: {
    newPatients: number;
    visits: number;
    appointmentsBooked: number;
    appointmentsCompleted: number;
    appointmentsMissed: number;
    consultationsCompleted: number;
    billed: number;
    collected: number;
    unitsDispensed: number;
    averageOccupancy: number;
  };
  series: {
    date: string;
    newPatients: number;
    visits: number;
    appointmentsBooked: number;
    appointmentsCompleted: number;
    appointmentsMissed: number;
    consultationsCompleted: number;
    billed: number;
    collected: number;
    unitsDispensed: number;
    unitsReceived: number;
    bedsOccupied: number;
    occupancyPercent: number;
  }[];
}

const BRAND = '#9b3426';
const GREY = '#6b7280';
const MUTED = '#c9a39c';

const axisDate = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`;

function Chart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel title={title}>
      <div style={{ height: 240 }}>
        <ResponsiveContainer>{children as React.ReactElement}</ResponsiveContainer>
      </div>
    </Panel>
  );
}

export default function AnalyticsPage() {
  const today = toHospitalDate();
  const [preset, setPreset] = useState('30');
  const [range, setRange] = useState({ from: addDays(today, -29), to: today });

  const query = useQuery({
    queryKey: ['analytics', range.from, range.to],
    queryFn: () => api.get<Analytics>('/analytics', range),
  });

  const choose = (days: string) => {
    setPreset(days);
    if (days !== 'custom') setRange({ from: addDays(today, -(Number(days) - 1)), to: today });
  };

  const tooltip = { labelFormatter: (d: unknown) => fmtDate(String(d)) };

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Every figure is calculated from recorded transactions."
        actions={
          <div className="row">
            <Segmented
              value={preset}
              onChange={choose}
              options={[
                { value: '7', label: '7 days' },
                { value: '30', label: '30 days' },
                { value: '90', label: '90 days' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
            {preset === 'custom' && (
              <>
                <TextInput aria-label="From" type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} />
                <TextInput aria-label="To" type="date" value={range.to} min={range.from} max={today} onChange={(e) => setRange({ ...range, to: e.target.value })} />
              </>
            )}
          </div>
        }
      />
      <QueryState query={query}>
        {(d) => (
          <div className="stack">
            <div className="grid grid-4">
              <Stat label="OPD visits" value={d.totals.visits} note={`${d.totals.newPatients} new patients`} />
              <Stat
                label="Consultations completed"
                value={d.totals.consultationsCompleted}
                note={`${d.totals.appointmentsCompleted} of ${d.totals.appointmentsBooked} appointments completed`}
              />
              <Stat label="Collected" value={money(d.totals.collected)} note={`${money(d.totals.billed)} billed`} />
              <Stat
                label="Average bed occupancy"
                value={`${d.totals.averageOccupancy}%`}
                note={`${d.totalBeds} beds, ${d.totals.unitsDispensed} medicine units dispensed`}
              />
            </div>
            <div className="grid grid-2">
              <Chart title="Patients per day">
                <LineChart data={d.series} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="#eceded" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={axisDate} tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip {...tooltip} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="visits" name="OPD visits" stroke={BRAND} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="newPatients" name="New registrations" stroke={GREY} strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="consultationsCompleted" name="Consultations" stroke={MUTED} strokeWidth={1.5} dot={false} />
                </LineChart>
              </Chart>
              <Chart title="Appointments">
                <BarChart data={d.series} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="#eceded" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={axisDate} tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip {...tooltip} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="appointmentsCompleted" name="Completed" stackId="a" fill={BRAND} />
                  <Bar dataKey="appointmentsMissed" name="Cancelled or missed" stackId="a" fill={MUTED} />
                </BarChart>
              </Chart>
              <Chart title="Revenue">
                <BarChart data={d.series} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke="#eceded" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={axisDate} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                  <Tooltip {...tooltip} formatter={(v) => money(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="billed" name="Billed" fill={MUTED} />
                  <Bar dataKey="collected" name="Collected (net)" fill={BRAND} />
                </BarChart>
              </Chart>
              <Chart title="Pharmacy movement (units)">
                <BarChart data={d.series} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="#eceded" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={axisDate} tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip {...tooltip} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="unitsDispensed" name="Dispensed" fill={BRAND} />
                  <Bar dataKey="unitsReceived" name="Received" fill={GREY} />
                </BarChart>
              </Chart>
              <div className="span-all">
                <Chart title="Bed occupancy (end of day)">
                  <LineChart data={d.series} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid stroke="#eceded" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={axisDate} tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                    <Tooltip {...tooltip} formatter={(v, _n, item) => [`${v}% (${(item.payload as { bedsOccupied: number }).bedsOccupied} beds)`, 'Occupancy']} />
                    <Line type="stepAfter" dataKey="occupancyPercent" name="Occupancy" stroke={BRAND} strokeWidth={2} dot={false} />
                  </LineChart>
                </Chart>
              </div>
            </div>
          </div>
        )}
      </QueryState>
    </>
  );
}
