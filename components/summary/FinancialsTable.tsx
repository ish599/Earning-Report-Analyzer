import { directionClass, formatCompact, formatNumber, formatPercent, EM_DASH } from '@/lib/format';
import type { QuarterSummaryRow } from '@/lib/types';

/**
 * Reported quarterly results.
 *
 * Every figure comes from the data provider. Missing values render as an em
 * dash — they are never carried forward from an adjacent quarter or estimated,
 * because a fabricated financial is worse than a blank one.
 */
export function FinancialsTable({ quarters }: { quarters: QuarterSummaryRow[] }) {
  const hasAny = quarters.some((q) => q.financials);

  if (!hasAny) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-muted">
        No financial results are available for this company from the configured data provider.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="data-table">
        <thead>
          <tr>
            <th>Quarter</th>
            <th className="num">Revenue</th>
            <th className="num">Rev. YoY</th>
            <th className="num">EPS</th>
            <th className="num">Consensus</th>
            <th className="num">Surprise</th>
            <th className="num">Gross margin</th>
            <th className="num">Op. margin</th>
            <th>Guidance</th>
          </tr>
        </thead>
        <tbody>
          {quarters.map((q) => {
            const f = q.financials;
            return (
              <tr key={q.callId}>
                <td className="whitespace-nowrap font-medium">{q.label}</td>
                <td className="num">{formatCompact(f?.revenue ?? null, 'USD')}</td>
                <td className={`num ${directionClass(f?.revenueGrowth)}`}>
                  {formatPercent(f?.revenueGrowth ?? null)}
                </td>
                <td className="num">{formatNumber(f?.eps ?? null, 2)}</td>
                <td className="num text-ink-secondary">
                  {formatNumber(f?.epsEstimate ?? null, 2)}
                </td>
                <td className={`num ${directionClass(f?.epsSurprise)}`}>
                  {f?.epsSurprise == null
                    ? EM_DASH
                    : `${f.epsSurprise > 0 ? '+' : ''}${f.epsSurprise.toFixed(2)}`}
                </td>
                <td className="num">
                  {formatPercent(f?.grossMargin ?? null, { signed: false })}
                </td>
                <td className="num">
                  {formatPercent(f?.operatingMargin ?? null, { signed: false })}
                </td>
                <td className="max-w-xs text-xs text-ink-secondary">
                  {f?.guidance?.commentary ?? EM_DASH}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
