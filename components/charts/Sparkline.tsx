import { SERIES } from './palette';

/**
 * Inline sentiment sparkline for a topic row.
 *
 * A single series, so no legend — the row's topic name identifies it. The
 * numeric scores sit beside it in the table, which is what carries precision;
 * the sparkline only conveys shape.
 */
export function Sparkline({
  values,
  width = 64,
  height = 18,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) {
    return <span className="text-2xs text-ink-muted">—</span>;
  }

  // Fixed 0-100 domain so sparklines are comparable between rows. A per-row
  // domain would make a flat topic look as volatile as a swinging one.
  const pad = 2;
  const stepX = (width - pad * 2) / (values.length - 1);
  const toY = (v: number) => pad + (1 - Math.max(0, Math.min(100, v)) / 100) * (height - pad * 2);

  const points = values.map((v, i) => `${pad + i * stepX},${toY(v)}`).join(' ');
  const last = values[values.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Sentiment trend, ending at ${last.toFixed(0)} out of 100`}
      className="overflow-visible"
    >
      <line
        x1={pad}
        x2={width - pad}
        y1={toY(50)}
        y2={toY(50)}
        stroke="#e3e0da"
        strokeWidth={1}
      />
      <polyline
        points={points}
        fill="none"
        stroke={SERIES.overall}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={pad + (values.length - 1) * stepX} cy={toY(last)} r={2} fill={SERIES.overall} />
    </svg>
  );
}
