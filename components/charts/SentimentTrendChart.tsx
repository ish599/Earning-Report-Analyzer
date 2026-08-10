'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHROME, SERIES, SERIES_LABELS } from './palette';
import type { QuarterSummaryRow } from '@/lib/types';

/**
 * Overall, management, and Q&A sentiment across quarters.
 *
 * All three series share one 0-100 scale, so there is a single y-axis — the
 * scores are directly comparable and a second axis would fabricate a
 * relationship between them.
 *
 * Quarters with no analysis are omitted rather than plotted at zero, which
 * would read as a collapse in sentiment instead of an absence of data.
 */

interface Point {
  label: string;
  overall: number | null;
  management: number | null;
  qa: number | null;
}

export function SentimentTrendChart({ quarters }: { quarters: QuarterSummaryRow[] }) {
  // Oldest first so the series reads left to right.
  const data: Point[] = [...quarters]
    .reverse()
    .filter((q) => q.analyzed)
    .map((q) => ({
      label: q.label,
      overall: q.overallSentiment,
      management: q.managementSentiment,
      qa: q.qaSentiment,
    }));

  if (data.length < 2) {
    return (
      <p className="px-4 py-10 text-center text-sm text-ink-muted">
        At least two analyzed quarters are needed to plot a trend.
      </p>
    );
  }

  return (
    <div>
      <Legend />
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 56, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={CHROME.grid} strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="label"
              stroke={CHROME.axis}
              tick={{ fill: CHROME.label, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: CHROME.axis }}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              stroke={CHROME.axis}
              tick={{ fill: CHROME.label, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={32}
            />
            {/* 50 is the neutral anchor; above and below it is the only
                comparison the underlying heuristic reliably supports. */}
            <ReferenceLine y={50} stroke={CHROME.axis} strokeDasharray="3 3" />
            <Tooltip
              cursor={{ stroke: CHROME.axis, strokeWidth: 1 }}
              contentStyle={{
                background: CHROME.surface,
                border: `1px solid ${CHROME.grid}`,
                borderRadius: 3,
                fontSize: 12,
                boxShadow: '0 4px 16px rgba(26,25,23,0.10)',
              }}
              labelStyle={{ color: CHROME.ink, fontWeight: 600, marginBottom: 4 }}
              formatter={(value, name) => [
                typeof value === 'number' ? value.toFixed(0) : '—',
                SERIES_LABELS[name as keyof typeof SERIES_LABELS] ?? String(name),
              ]}
            />
            {(['overall', 'management', 'qa'] as const).map((key) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={key}
                stroke={SERIES[key]}
                strokeWidth={2}
                dot={{ r: 3, strokeWidth: 0, fill: SERIES[key] }}
                activeDot={{ r: 5, strokeWidth: 2, stroke: CHROME.surface }}
                connectNulls
                isAnimationActive={false}
                // Direct end-label: the relief channel required by the aqua
                // slot's sub-3:1 contrast, and it removes a legend round trip.
                label={<EndLabel seriesKey={key} lastIndex={data.length - 1} />}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
      {(['overall', 'management', 'qa'] as const).map((key) => (
        <span key={key} className="flex items-center gap-1.5 text-xs text-ink-secondary">
          <span
            aria-hidden
            className="inline-block h-0.5 w-4"
            style={{ backgroundColor: SERIES[key] }}
          />
          {SERIES_LABELS[key]}
        </span>
      ))}
      <span className="ml-auto text-2xs text-ink-muted">0–100 · 50 = neutral</span>
    </div>
  );
}

interface EndLabelProps {
  seriesKey: keyof typeof SERIES;
  lastIndex: number;
  x?: number;
  y?: number;
  index?: number;
  value?: number | null;
}

/** Labels only the final point of each series, never every point. */
function EndLabel({ seriesKey, lastIndex, x, y, index, value }: EndLabelProps) {
  if (index !== lastIndex || value == null || x == null || y == null) return null;

  return (
    <text
      x={x + 8}
      y={y}
      dy={4}
      fontSize={11}
      fontWeight={600}
      fill={SERIES[seriesKey]}
      className="tabular-nums"
    >
      {value.toFixed(0)}
    </text>
  );
}
