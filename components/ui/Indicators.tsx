import {
  CLASSIFICATION_LABELS,
  SIGNAL_LABELS,
  type Classification,
  type SentimentLabel,
  type Signal,
  type TopicDirection,
} from '@/lib/types';
import { formatScore, scoreBarClass, scoreClass } from '@/lib/format';

/**
 * Direction and score indicators.
 *
 * These deliberately never render Buy/Sell/Hold. The product describes how
 * language changed; converting that into a trade recommendation is the
 * analyst's job, not the tool's.
 */

export function ClassificationChip({ value }: { value: Classification | null }) {
  if (!value) return <span className="chip chip-neutral">Not analyzed</span>;

  const tone =
    value === 'very_bullish' || value === 'bullish'
      ? 'chip-positive'
      : value === 'very_bearish' || value === 'bearish'
        ? 'chip-negative'
        : 'chip-neutral';

  return <span className={`chip ${tone}`}>{CLASSIFICATION_LABELS[value]}</span>;
}

export function SignalChip({ value }: { value: Signal }) {
  const tone =
    value === 'improving'
      ? 'chip-positive'
      : value === 'deteriorating'
        ? 'chip-negative'
        : 'chip-neutral';

  return <span className={`chip ${tone}`}>{SIGNAL_LABELS[value]}</span>;
}

export function DirectionChip({ value }: { value: TopicDirection }) {
  const tone =
    value === 'improving'
      ? 'chip-positive'
      : value === 'deteriorating'
        ? 'chip-negative'
        : value === 'new'
          ? 'chip-accent'
          : 'chip-neutral';

  const label = value === 'new' ? 'New' : SIGNAL_LABELS[value as Signal] ?? value;
  return <span className={`chip ${tone}`}>{label}</span>;
}

export function SentimentChip({ value }: { value: SentimentLabel }) {
  const tone =
    value === 'positive'
      ? 'chip-positive'
      : value === 'negative'
        ? 'chip-negative'
        : value === 'mixed'
          ? 'chip-caution'
          : 'chip-neutral';

  return <span className={`chip ${tone}`}>{value}</span>;
}

/**
 * A 0-100 score as a number plus a proportional bar.
 *
 * The bar carries a 50 tick because "above or below neutral" is the only
 * comparison the underlying heuristic reliably supports.
 */
export function ScoreBar({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | null;
  hint?: string;
}) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="field-label">{label}</span>
        <span className={`text-sm font-semibold tabular-nums ${scoreClass(value)}`}>
          {formatScore(value)}
        </span>
      </div>
      <div className="relative mt-1.5 h-1.5 w-full bg-raised" role="presentation">
        <div
          className={`h-full ${scoreBarClass(value)}`}
          style={{ width: `${pct}%` }}
        />
        <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
      </div>
      {hint && <p className="mt-1 text-2xs leading-snug text-ink-muted">{hint}</p>}
    </div>
  );
}

/** Compact inline score for dense table cells. */
export function ScoreCell({ value }: { value: number | null }) {
  return (
    <span className={`tabular-nums font-medium ${scoreClass(value)}`}>{formatScore(value)}</span>
  );
}
