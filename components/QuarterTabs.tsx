import Link from 'next/link';
import type { QuarterSummaryRow } from '@/lib/types';

/**
 * Summary + per-quarter navigation, newest quarter first.
 *
 * Unanalyzed quarters remain navigable and are marked, rather than hidden —
 * an analyst should be able to see that a quarter exists and has not been
 * processed yet.
 */
export function QuarterTabs({
  ticker,
  quarters,
  active,
}: {
  ticker: string;
  quarters: QuarterSummaryRow[];
  /** 'summary' or `${fiscalYear}-${fiscalQuarter}`. */
  active: string;
}) {
  return (
    <nav className="border-b border-line bg-surface" aria-label="Quarters">
      <div className="mx-auto max-w-[1400px] px-5">
        <div className="flex items-end gap-1 overflow-x-auto scrollbar-thin">
          <Link
            href={`/company/${ticker}`}
            className={`tab ${active === 'summary' ? 'tab-active' : ''}`}
            aria-current={active === 'summary' ? 'page' : undefined}
          >
            Summary
          </Link>

          {quarters.map((q) => {
            const key = `${q.fiscalYear}-${q.fiscalQuarter}`;
            const isActive = active === key;

            return (
              <Link
                key={q.callId}
                href={`/company/${ticker}/q/${key}`}
                className={`tab ${isActive ? 'tab-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                {q.label}
                {!q.analyzed && (
                  <span
                    className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-caution align-middle"
                    title="Not yet analyzed"
                    aria-label="Not yet analyzed"
                  />
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
