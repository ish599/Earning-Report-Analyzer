import Link from 'next/link';
import { SearchBar } from './SearchBar';
import { Stat } from './ui/Panel';
import { formatCompact, formatCurrency, formatDate, formatPercentPoints, directionClass, EM_DASH } from '@/lib/format';
import type { CompanyProfile } from '@/lib/types';

/**
 * Identity and market strip at the top of a company page.
 *
 * Search stays present here rather than only on the landing page: moving
 * between names is the most common action in this workflow.
 */
export function CompanyHeader({ company }: { company: CompanyProfile }) {
  const changeClass = directionClass(company.changePercent);

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto max-w-[1400px] px-5">
        <div className="flex items-center justify-between gap-6 border-b border-line py-2.5">
          <Link href="/" className="text-sm font-semibold tracking-tight text-ink">
            Earnings Intelligence
          </Link>
          <div className="w-full max-w-md">
            <SearchBar />
          </div>
          <Link
            href="/methodology"
            className="shrink-0 text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Methodology
          </Link>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 py-4">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2.5">
              <h1 className="truncate text-xl font-semibold tracking-tight text-ink">
                {company.companyName}
              </h1>
              <span className="font-mono text-sm font-medium text-ink-muted">
                {company.ticker}
              </span>
              {company.exchange && (
                <span className="chip chip-neutral">{company.exchange}</span>
              )}
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              {[company.sector, company.industry].filter(Boolean).join(' · ') || EM_DASH}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            <Stat
              label="Price"
              value={formatCurrency(company.price, company.currency ?? 'USD')}
            />
            <Stat
              label="Change"
              value={formatPercentPoints(company.changePercent)}
              valueClassName={changeClass}
              hint={
                company.change != null
                  ? formatCurrency(company.change, company.currency ?? 'USD')
                  : undefined
              }
            />
            <Stat label="Market cap" value={formatCompact(company.marketCap, 'USD')} />
            <Stat label="Next earnings" value={formatDate(company.nextEarningsDate)} />
          </div>
        </div>
      </div>
    </header>
  );
}
