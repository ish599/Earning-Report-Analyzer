/**
 * Display formatting.
 *
 * Shared by server and client components, so this module must stay free of
 * `server-only` and of any Node API.
 *
 * The governing rule: absent data renders as an em dash, never as zero and
 * never as an interpolated guess. A blank cell is information — it tells the
 * analyst the figure was not reported.
 */

export const EM_DASH = '—';

export function formatCurrency(value: number | null | undefined, currency = 'USD'): string {
  if (value == null || !Number.isFinite(value)) return EM_DASH;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Compact magnitude for large financials: 1.23B, 456.7M. */
export function formatCompact(value: number | null | undefined, currency?: string): string {
  if (value == null || !Number.isFinite(value)) return EM_DASH;

  const abs = Math.abs(value);
  const prefix = currency === 'USD' ? '$' : '';
  const sign = value < 0 ? '-' : '';

  if (abs >= 1e12) return `${sign}${prefix}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${prefix}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${prefix}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}${prefix}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${prefix}${abs.toFixed(2)}`;
}

/** `value` is a fraction: 0.123 renders as +12.3%. */
export function formatPercent(
  value: number | null | undefined,
  options: { digits?: number; signed?: boolean } = {},
): string {
  if (value == null || !Number.isFinite(value)) return EM_DASH;
  const { digits = 1, signed = true } = options;
  const pct = value * 100;
  const sign = signed && pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(digits)}%`;
}

/** `value` is already in percentage points: 12.3 renders as +12.3%. */
export function formatPercentPoints(
  value: number | null | undefined,
  options: { digits?: number; signed?: boolean } = {},
): string {
  if (value == null || !Number.isFinite(value)) return EM_DASH;
  const { digits = 2, signed = true } = options;
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return EM_DASH;
  return value.toFixed(digits);
}

export function formatScore(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return EM_DASH;
  return value.toFixed(0);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return EM_DASH;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return EM_DASH;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

/** Tailwind text colour encoding sign. Zero is neutral, not positive. */
export function directionClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return 'text-ink-secondary';
  return value > 0 ? 'text-positive' : 'text-negative';
}

/**
 * Colour for a 0-100 score.
 *
 * Deliberately muted and banded widely: the score is a heuristic, and a
 * high-contrast gradient would imply a precision it does not have.
 */
export function scoreClass(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return 'text-ink-muted';
  if (score >= 60) return 'text-positive';
  if (score <= 40) return 'text-negative';
  return 'text-ink-secondary';
}

export function scoreBarClass(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return 'bg-line-strong';
  if (score >= 60) return 'bg-positive';
  if (score <= 40) return 'bg-negative';
  return 'bg-ink-muted';
}
