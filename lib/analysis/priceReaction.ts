import type { PricePoint, PriceReaction, ReleaseTiming } from '@/lib/types';

/**
 * Post-earnings price reaction over 1, 5, 10, and 20 TRADING days.
 *
 * Horizons count trading sessions present in the price series, not calendar
 * days, so holidays and weekends are handled implicitly.
 *
 * Choosing t=0 is the whole problem. The base is the last close that does NOT
 * yet embed the earnings news:
 *
 *   BMO — released before the open, so the call date's own session is the
 *         reaction. Base is the prior trading day.
 *   AMC — released after the close, so the call date's close is still clean.
 *         Base is the call date itself.
 *   unknown — we assume AMC, because it is the more common convention for the
 *         calls this product covers, and we set `timingKnown: false`. The UI
 *         shows a methodology caveat in that case. We do not silently present
 *         an assumed window as an exact one.
 *
 * Returns are computed on adjusted closes so splits and dividends do not
 * masquerade as reactions.
 */

const HORIZONS = [1, 5, 10, 20] as const;

export function computePriceReaction(
  callDate: string | null,
  releaseTiming: ReleaseTiming,
  prices: PricePoint[],
): PriceReaction {
  const empty: PriceReaction = {
    return1d: null,
    return5d: null,
    return10d: null,
    return20d: null,
    baseDate: null,
    basePrice: null,
    releaseTiming,
    timingKnown: releaseTiming !== 'unknown',
  };

  if (!callDate || prices.length === 0) return empty;

  // Defensive: callers may pass a series in provider order.
  const series = [...prices].sort((a, b) => a.date.localeCompare(b.date));

  // Last session on or before the call date. If the call date is itself a
  // trading day this is that day; otherwise it is the preceding session.
  let onOrBefore = -1;
  for (let i = 0; i < series.length; i += 1) {
    if (series[i].date <= callDate) onOrBefore = i;
    else break;
  }
  if (onOrBefore === -1) return empty;

  // BMO: step back one further session so the base excludes the reaction.
  const baseIndex = releaseTiming === 'bmo' ? onOrBefore - 1 : onOrBefore;
  if (baseIndex < 0) return empty;

  const base = series[baseIndex];
  const basePrice = base.adjClose;
  if (!Number.isFinite(basePrice) || basePrice <= 0) return empty;

  const returns = HORIZONS.map((h) => {
    const target = series[baseIndex + h];
    if (!target) return null;
    return (target.adjClose - basePrice) / basePrice;
  });

  return {
    return1d: returns[0],
    return5d: returns[1],
    return10d: returns[2],
    return20d: returns[3],
    baseDate: base.date,
    basePrice: base.close,
    releaseTiming,
    timingKnown: releaseTiming !== 'unknown',
  };
}
