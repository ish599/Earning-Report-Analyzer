import { directionClass, formatDate, formatPercent } from '@/lib/format';
import type { QuarterSummaryRow } from '@/lib/types';

/**
 * Historical market reaction following each call.
 *
 * Presented strictly as an observation. Nothing here claims the sentiment
 * analysis caused, predicted, or explains the move — earnings reactions are
 * driven by results versus expectations, positioning, and the broader tape far
 * more than by tone. The caption says so, and it is not optional decoration.
 */
export function PriceReactionTable({ quarters }: { quarters: QuarterSummaryRow[] }) {
  const withReactions = quarters.filter((q) => q.priceReaction);

  if (withReactions.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-muted">
        No price history is available for these call dates.
      </p>
    );
  }

  const anyUnknownTiming = withReactions.some((q) => q.priceReaction && !q.priceReaction.timingKnown);

  return (
    <div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="data-table">
          <thead>
            <tr>
              <th>Quarter</th>
              <th>Base date (t=0)</th>
              <th>Release</th>
              <th className="num">1D</th>
              <th className="num">5D</th>
              <th className="num">10D</th>
              <th className="num">20D</th>
            </tr>
          </thead>
          <tbody>
            {withReactions.map((q) => {
              const r = q.priceReaction!;
              return (
                <tr key={q.callId}>
                  <td className="whitespace-nowrap font-medium">{q.label}</td>
                  <td className="whitespace-nowrap text-ink-secondary">{formatDate(r.baseDate)}</td>
                  <td>
                    <span className={`chip ${r.timingKnown ? 'chip-neutral' : 'chip-caution'}`}>
                      {r.releaseTiming === 'bmo'
                        ? 'Before open'
                        : r.releaseTiming === 'amc'
                          ? 'After close'
                          : 'Assumed'}
                    </span>
                  </td>
                  <td className={`num ${directionClass(r.return1d)}`}>{formatPercent(r.return1d)}</td>
                  <td className={`num ${directionClass(r.return5d)}`}>{formatPercent(r.return5d)}</td>
                  <td className={`num ${directionClass(r.return10d)}`}>{formatPercent(r.return10d)}</td>
                  <td className={`num ${directionClass(r.return20d)}`}>{formatPercent(r.return20d)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="border-t border-line px-4 py-2.5 text-2xs leading-relaxed text-ink-muted">
        Historical market reaction, shown for context only. Returns are measured over trading days
        from the last close that did not yet reflect the release, using adjusted closes.
        {anyUnknownTiming && (
          <>
            {' '}
            Rows marked <span className="font-medium text-caution">Assumed</span> are cases where
            the provider did not report whether results were released before the open or after the
            close; those windows assume an after-close release and may be shifted by one session.
          </>
        )}{' '}
        These moves reflect results versus expectations, positioning, and market conditions. This
        product does not claim that call sentiment predicts or explains them.
      </p>
    </div>
  );
}
