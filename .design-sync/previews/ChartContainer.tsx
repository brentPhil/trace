import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  LineChart,
  Line,
} from 'chroneli';


/* `isAnimationActive={false}` throughout: an animating chart screenshots
 * mid-transition and the card renders a half-drawn plot. The app disables it
 * for the same reason. */

const WEEK = [
  { day: 'Mon', billable: 6.5, internal: 1.0 },
  { day: 'Tue', billable: 7.25, internal: 0.5 },
  { day: 'Wed', billable: 5.0, internal: 2.0 },
  { day: 'Thu', billable: 7.75, internal: 0.25 },
  { day: 'Fri', billable: 4.5, internal: 1.5 },
];

const CONFIG = {
  billable: { label: 'Billable', color: 'var(--foreground)' },
  internal: { label: 'Internal', color: 'var(--muted-foreground)' },
};

export function StackedBars() {
  return (
    <ChartContainer config={CONFIG} className="aspect-auto h-56 w-[420px]">
      <BarChart data={WEEK} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={32} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar
          dataKey="billable"
          stackId="tracked"
          fill="var(--color-billable)"
          isAnimationActive={false}
        />
        <Bar
          dataKey="internal"
          stackId="tracked"
          fill="var(--color-internal)"
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  );
}

export function WithLegend() {
  return (
    <ChartContainer config={CONFIG} className="aspect-auto h-56 w-[420px]">
      <BarChart data={WEEK} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={32} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="billable" fill="var(--color-billable)" isAnimationActive={false} />
        <Bar dataKey="internal" fill="var(--color-internal)" isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}

export function Trend() {
  return (
    <ChartContainer config={CONFIG} className="aspect-auto h-56 w-[420px]">
      <LineChart data={WEEK} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={32} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line
          dataKey="billable"
          stroke="var(--color-billable)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
